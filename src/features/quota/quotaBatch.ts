/**
 * Batch quota reads for one source, React-free (useQuotaBatchLoader wraps it).
 *
 * - A batch requested while another runs waits for it and then runs; none is dropped. Cards the
 *   earlier batch just read are reused by the later one through the 60 s rule, so a queued
 *   refresh of the same cards costs nothing.
 * - Cards read successfully less than QUOTA_REUSE_WINDOW_MS ago are reused (quotaFreshness.ts).
 * - At most QUOTA_READ_CONCURRENCY reads are open at once, so a refresh never bursts a hub.
 * - cacheGeneration: after a reconnect or a file mutation, an old read never lands in the cache.
 * Each provider's results commit together as soon as that provider's reads finish.
 */
import type { TFunction } from 'i18next';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores/useQuotaStore';
import type { QuotaStore } from '@/stores/useQuotaStore';
import { getStatusFromError } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { QuotaFileEntry } from './logic';
import { getQuotaSetter, type QuotaAdapter, type QuotaCardState } from './providers';
import { beginLoading } from './quotaLoading';
import type { QuotaProviderType } from './providers/types';
import { enrichQuotaInBackground } from './quotaEnrichment';
import { splitQuotaTargets } from './quotaFreshness';

/** Open quota reads per source at once. */
export const QUOTA_READ_CONCURRENCY = 4;

export type QuotaBatchLoad = (
  targets: QuotaFileEntry[],
  /** Called once per target: after its provider's results commit, or at once when reused. */
  onSettled?: (ok: boolean) => void
) => Promise<void>;

export interface QuotaBatchDeps {
  adapters: Record<QuotaProviderType, QuotaAdapter>;
  store: QuotaStore;
  t: TFunction;
  /** False once the source session has gone; nothing is read or committed after that. */
  isCurrent: () => boolean;
  now?: () => number;
  onBusyChange?: (busy: boolean) => void;
}

type ReadResult =
  | { cacheKey: string; name: string; ok: true; data: unknown }
  | { cacheKey: string; name: string; ok: false; error: string; errorStatus?: number };

function limiter(limit: number) {
  let open = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (open >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    open += 1;
    try {
      return await task();
    } finally {
      open -= 1;
      waiting.shift()?.();
    }
  };
}

export function createQuotaBatchLoader(deps: QuotaBatchDeps): QuotaBatchLoad {
  const { adapters, store, t, isCurrent, now = Date.now, onBusyChange } = deps;
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;

  const run = async (targets: QuotaFileEntry[], onSettled?: (ok: boolean) => void) => {
    if (!isCurrent()) return;
    const unique = new Map<string, QuotaFileEntry>();
    targets.forEach((entry) => unique.set(getQuotaCacheKey(entry.file), entry));
    const { due, reused } = splitQuotaTargets(
      [...unique.values()],
      store.getState().fetchedAt,
      now()
    );
    reused.forEach(() => onSettled?.(true));
    if (due.length === 0) return;

    const cacheGeneration = captureQuotaCacheGeneration(undefined, store);
    const limit = limiter(QUOTA_READ_CONCURRENCY);
    const groups = new Map<QuotaProviderType, QuotaFileEntry[]>();
    due.forEach((entry) => groups.set(entry.type, [...(groups.get(entry.type) ?? []), entry]));

    await Promise.all(
      Array.from(groups.entries()).map(async ([type, entries]) => {
        const adapter = adapters[type];
        const setQuota = getQuotaSetter(adapter, store);
        let release = () => {};
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          release = beginLoading(
            adapter,
            store,
            entries.map(({ file }) => getQuotaCacheKey(file))
          );
        });

        const results = await Promise.all(
          entries.map(({ file }) =>
            limit(async (): Promise<ReadResult> => {
              const cacheKey = getQuotaCacheKey(file);
              if (!isCurrent()) {
                return { cacheKey, name: file.name, ok: false, error: t('common.unknown_error') };
              }
              try {
                return {
                  cacheKey,
                  name: file.name,
                  ok: true,
                  data: await adapter.fetchQuota(file, t),
                };
              } catch (err: unknown) {
                return {
                  cacheKey,
                  name: file.name,
                  ok: false,
                  error: err instanceof Error ? err.message : t('common.unknown_error'),
                  errorStatus: getStatusFromError(err),
                };
              }
            })
          )
        );
        if (!isCurrent()) return release();

        const committed = new Map<string, QuotaCardState>();
        setQuota((prev) => {
          const next = { ...prev };
          results.forEach((result) => {
            commitIfQuotaCacheCurrent(
              cacheGeneration,
              () => {
                next[result.cacheKey] = result.ok
                  ? adapter.buildSuccessState(result.data)
                  : adapter.buildErrorState(
                      result.error || t('common.unknown_error'),
                      result.errorStatus
                    );
                committed.set(result.cacheKey, next[result.cacheKey]);
              },
              result.name
            );
          });
          return next;
        });
        results.forEach((result) => onSettled?.(result.ok));
        results.forEach((result, index) => {
          const state = committed.get(result.cacheKey);
          if (result.ok && state) {
            void enrichQuotaInBackground(
              adapter,
              entries[index].file,
              result.data,
              state,
              t,
              store
            );
          }
        });
      })
    );
  };

  return (targets, onSettled) => {
    pending += 1;
    if (pending === 1) onBusyChange?.(true);
    const job = queue.then(() => run(targets, onSettled));
    queue = job.catch(() => undefined);
    return job.finally(() => {
      pending -= 1;
      if (pending === 0) onBusyChange?.(false);
    });
  };
}
