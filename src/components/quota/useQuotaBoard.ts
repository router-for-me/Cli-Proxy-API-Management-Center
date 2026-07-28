/**
 * Board-wide quota state: one flat list of credentials, dispatched per file to
 * the right provider config and store slice.
 *
 * This replaces the per-provider `QuotaSection` orchestration. The important
 * property is that it does *not* normalize the five provider data shapes —
 * every card is still rendered by its own `config.renderQuotaItems` over raw
 * provider state. All this hook does is answer, for a given file: which config,
 * which slice entry, and which refresh.
 *
 * Two constraints shape the implementation and are easy to get wrong:
 *
 *   1. `useQuotaLoader` is a hook, so it cannot be called in a loop over the
 *      provider list. It is called five times, literally, in fixed order.
 *   2. The store-pruning effect must stay *per provider*. A single pass over a
 *      flat mixed list would see only (say) the Claude files and rewrite every
 *      other slice to `{}` — silently wiping four providers' loaded quota.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
  useQuotaStore,
} from '@/stores';
import type { AuthFileItem } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import type { QuotaStatusState } from './QuotaCard';
import {
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  KIMI_CONFIG,
  XAI_CONFIG,
} from './quotaConfigs';
import type { QuotaConfig } from './quotaConfigs';
import type { QuotaProviderKey } from './quotaSummary';
import { useQuotaLoader } from './useQuotaLoader';

/**
 * The configs are heterogeneous in their state/data type parameters. The board
 * never inspects provider state — it only hands a config and its matching state
 * straight back to `QuotaCard`, which re-establishes the pairing. So the board
 * holds them opaquely.
 */
type AnyQuotaConfig = QuotaConfig<QuotaStatusState, unknown>;

type QuotaUpdater<T> = T | ((prev: T) => T);
type QuotaSetter = (updater: QuotaUpdater<Record<string, QuotaStatusState>>) => void;

/** Display order of providers on the board and in the summary tiles. */
export const QUOTA_PROVIDER_ORDER: readonly QuotaProviderKey[] = [
  'claude',
  'antigravity',
  'codex',
  'xai',
  'kimi',
] as const;

const CONFIGS: Record<QuotaProviderKey, AnyQuotaConfig> = {
  claude: CLAUDE_CONFIG as unknown as AnyQuotaConfig,
  antigravity: ANTIGRAVITY_CONFIG as unknown as AnyQuotaConfig,
  codex: CODEX_CONFIG as unknown as AnyQuotaConfig,
  xai: XAI_CONFIG as unknown as AnyQuotaConfig,
  kimi: KIMI_CONFIG as unknown as AnyQuotaConfig,
};

/** A credential paired with the provider that owns it. */
export interface QuotaBoardEntry {
  file: AuthFileItem;
  provider: QuotaProviderKey;
  config: AnyQuotaConfig;
  quota: QuotaStatusState | undefined;
}

interface UseQuotaBoardOptions {
  files: AuthFileItem[];
  /** True while the auth-file list itself is loading. */
  filesLoading: boolean;
  /** True when the connection is down — suppresses all fetching. */
  disabled: boolean;
}

export interface QuotaBoard {
  /** Every credential some provider claims, in provider display order. */
  entries: QuotaBoardEntry[];
  /** Credentials grouped by provider — for the summary tiles. */
  filesByProvider: Record<QuotaProviderKey, AuthFileItem[]>;
  /** True while any provider is fetching. */
  refreshing: boolean;
  /**
   * Refresh a single credential, addressed by name.
   *
   * Name-keyed rather than entry-keyed on purpose: entry objects are rebuilt
   * whenever *any* provider's slice changes, so a callback closing over one
   * would change identity constantly and defeat the cards' memoization.
   */
  refreshFile: (name: string) => Promise<void>;
  /** Refresh every credential, bounded by the shared fetch gate. */
  refreshAll: () => void;
  /** Reset a Codex credential's rate limit, behind a confirmation. */
  resetFile: (name: string) => void;
  /** Credential currently mid-reset, if any. */
  resettingName: string | null;
}

export function useQuotaBoard({
  files,
  filesLoading,
  disabled,
}: UseQuotaBoardOptions): QuotaBoard {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  /* --- one loader per provider: called unconditionally, in fixed order ----- */
  const claude = useQuotaLoader(CLAUDE_CONFIG);
  const antigravity = useQuotaLoader(ANTIGRAVITY_CONFIG);
  const codex = useQuotaLoader(CODEX_CONFIG);
  const xai = useQuotaLoader(XAI_CONFIG);
  const kimi = useQuotaLoader(KIMI_CONFIG);

  /* Depend on the loader *fields* rather than the returned objects: each hook
   * returns a fresh object literal every render, so memoizing on the objects
   * would rebuild on every render. The fields are stable. */
  const slices = useMemo(
    () =>
      ({
        claude: claude.quota,
        antigravity: antigravity.quota,
        codex: codex.quota,
        xai: xai.quota,
        kimi: kimi.quota,
      }) as Record<QuotaProviderKey, Record<string, QuotaStatusState>>,
    [claude.quota, antigravity.quota, codex.quota, xai.quota, kimi.quota]
  );

  const load = useMemo(
    () => ({
      claude: claude.loadQuota,
      antigravity: antigravity.loadQuota,
      codex: codex.loadQuota,
      xai: xai.loadQuota,
      kimi: kimi.loadQuota,
    }),
    [claude.loadQuota, antigravity.loadQuota, codex.loadQuota, xai.loadQuota, kimi.loadQuota]
  );

  /* --- store setters, for single-credential writes ------------------------ */
  const setClaude = useQuotaStore((s) => s.setClaudeQuota);
  const setAntigravity = useQuotaStore((s) => s.setAntigravityQuota);
  const setCodex = useQuotaStore((s) => s.setCodexQuota);
  const setXai = useQuotaStore((s) => s.setXaiQuota);
  const setKimi = useQuotaStore((s) => s.setKimiQuota);

  const setters = useMemo(
    () =>
      ({
        claude: setClaude,
        antigravity: setAntigravity,
        codex: setCodex,
        xai: setXai,
        kimi: setKimi,
      }) as Record<QuotaProviderKey, QuotaSetter>,
    [setClaude, setAntigravity, setCodex, setXai, setKimi]
  );

  /* --- per-provider credential lists -------------------------------------- */
  const filesByProvider = useMemo(() => {
    const grouped = {} as Record<QuotaProviderKey, AuthFileItem[]>;
    for (const provider of QUOTA_PROVIDER_ORDER) {
      grouped[provider] = files.filter((file) => CONFIGS[provider].filterFn(file));
    }
    return grouped;
  }, [files]);

  /* --- the flat, ordered board -------------------------------------------- */
  const entries = useMemo(
    () =>
      QUOTA_PROVIDER_ORDER.flatMap((provider) =>
        filesByProvider[provider].map((file) => ({
          file,
          provider,
          config: CONFIGS[provider],
          quota: slices[provider][file.name],
        }))
      ),
    [filesByProvider, slices]
  );

  /* --- pruning: five separate effects, deliberately ------------------------
   * Each drops store entries for credentials that no longer exist, scoped to
   * its own slice. Collapsing these into one pass over `entries` would make
   * every pass rewrite all five slices from a single provider's view — which
   * wipes the other four. */
  usePruneSlice(filesByProvider.claude, filesLoading, setters.claude);
  usePruneSlice(filesByProvider.antigravity, filesLoading, setters.antigravity);
  usePruneSlice(filesByProvider.codex, filesLoading, setters.codex);
  usePruneSlice(filesByProvider.xai, filesLoading, setters.xai);
  usePruneSlice(filesByProvider.kimi, filesLoading, setters.kimi);

  /* --- refresh ------------------------------------------------------------- */
  const [loadingProviders, setLoadingProviders] = useState<Record<string, boolean>>({});

  const setProviderLoading = useCallback((provider: QuotaProviderKey, value: boolean) => {
    setLoadingProviders((prev) => (prev[provider] === value ? prev : { ...prev, [provider]: value }));
  }, []);

  const refreshAll = useCallback(() => {
    if (disabled) return;
    for (const provider of QUOTA_PROVIDER_ORDER) {
      const targets = filesByProvider[provider].filter((file) => !file.disabled);
      if (targets.length === 0) continue;
      // Each loader guards against overlapping runs of its own; the shared gate
      // in utils/quota/concurrency caps in-flight requests across all five.
      void load[provider](targets, (value) => setProviderLoading(provider, value));
    }
  }, [disabled, filesByProvider, load, setProviderLoading]);

  /* Entry objects are rebuilt whenever any slice changes. The callbacks below
   * read the *current* entries through this ref instead of closing over them,
   * so their identities stay stable and the memoized cards actually skip.
   *
   * Written in an effect rather than during render: a render can be thrown away
   * under concurrent rendering, and a ref mutated there would keep the stale
   * value. Every reader is an event handler, which runs after commit. */
  const entriesRef = useRef<QuotaBoardEntry[]>(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const lookup = useCallback(
    (name: string) => entriesRef.current.find((entry) => entry.file.name === name),
    []
  );

  const refreshFile = useCallback(
    async (name: string) => {
      const entry = lookup(name);
      if (!entry) return;
      const { file, provider, config, quota } = entry;
      if (disabled || file.disabled) return;
      if (quota?.status === 'loading') return;

      const setQuota = setters[provider];
      const cacheGeneration = captureQuotaCacheGeneration();

      setQuota((prev) => ({ ...prev, [file.name]: config.buildLoadingState() }));

      try {
        const data = await config.fetchQuota(file, t);
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          setQuota((prev) => ({ ...prev, [file.name]: config.buildSuccessState(data) }));
          showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          setQuota((prev) => ({ ...prev, [file.name]: config.buildErrorState(message, status) }));
          showNotification(
            t('auth_files.quota_refresh_failed', { name: file.name, message }),
            'error'
          );
        });
      }
    },
    [disabled, lookup, setters, showNotification, t]
  );

  /* --- reset (Codex rate-limit credits) ------------------------------------ */
  const [resettingName, setResettingName] = useState<string | null>(null);
  const resettingRef = useRef<string | null>(null);
  useEffect(() => {
    resettingRef.current = resettingName;
  }, [resettingName]);

  const resetFile = useCallback(
    (name: string) => {
      const entry = lookup(name);
      if (!entry) return;
      const { file, provider, config, quota } = entry;
      const resetQuota = config.resetQuota;
      if (!resetQuota) return;
      if (disabled || file.disabled) return;
      if (quota?.status === 'loading') return;
      if (resettingRef.current === file.name) return;

      const setQuota = setters[provider];

      showConfirmation({
        title: t('codex_quota.reset_confirm_title'),
        message: t('codex_quota.reset_confirm_message', { name: file.name }),
        confirmText: t('codex_quota.reset_confirm_button'),
        variant: 'primary',
        onConfirm: async () => {
          const cacheGeneration = captureQuotaCacheGeneration();
          setResettingName(file.name);
          try {
            const data = await resetQuota(file, t);
            commitIfQuotaCacheCurrent(cacheGeneration, () => {
              setQuota((prev) => ({ ...prev, [file.name]: config.buildSuccessState(data) }));
              showNotification(t('codex_quota.reset_success', { name: file.name }), 'success');
            });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('common.unknown_error');
            commitIfQuotaCacheCurrent(cacheGeneration, () => {
              showNotification(
                t('codex_quota.reset_failed', { name: file.name, message }),
                'error'
              );
            });
          } finally {
            setResettingName((current) => (current === file.name ? null : current));
          }
        },
      });
    },
    [disabled, lookup, setters, showConfirmation, showNotification, t]
  );

  return {
    entries,
    filesByProvider,
    refreshing: Object.values(loadingProviders).some(Boolean),
    refreshFile,
    refreshAll,
    resetFile,
    resettingName,
  };
}

/**
 * Keep only the entries whose credential still exists in `providerFiles`.
 *
 * Exported for tests: this is the operation that silently wipes data if it is
 * ever run against a mixed provider list, so it is worth pinning down directly.
 *
 * Returns `prev` unchanged when nothing was pruned, so the effect below cannot
 * drive a re-render loop. `next` is always a subset of `prev`'s keys, so equal
 * key counts implies an identical key set.
 */
export function pruneSliceToFiles(
  prev: Record<string, QuotaStatusState>,
  providerFiles: readonly AuthFileItem[]
): Record<string, QuotaStatusState> {
  if (providerFiles.length === 0) return Object.keys(prev).length === 0 ? prev : {};

  const next: Record<string, QuotaStatusState> = {};
  for (const file of providerFiles) {
    const cached = prev[file.name];
    if (cached) next[file.name] = cached;
  }
  return Object.keys(next).length === Object.keys(prev).length ? prev : next;
}

/**
 * Drop store entries whose credential no longer exists, scoped to one slice.
 *
 * Extracted so the five call sites read as five parallel statements rather than
 * a loop — the per-provider scoping is the whole point and should be visible at
 * the call site.
 */
function usePruneSlice(
  providerFiles: AuthFileItem[],
  filesLoading: boolean,
  setQuota: QuotaSetter
) {
  useEffect(() => {
    if (filesLoading) return;
    setQuota((prev) => pruneSliceToFiles(prev, providerFiles));
  }, [providerFiles, filesLoading, setQuota]);
}
