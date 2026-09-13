import type { AuthFileItem, DevinQuotaData } from '@/types';
import type { AuthFileLookup } from '@/services/api/authFiles';
import { hasDevinQuotaObservation, readDevinQuotaSnapshot } from '@/services/api/devinQuota';
import { normalizeAuthIndex } from '@/utils/authIndex';

export type DevinQuotaErrorCode =
  'missing_identity' | 'stale_request' | 'file_not_found' | 'empty_data' | 'refresh_unconfirmed';

export class DevinQuotaError extends Error {
  constructor(public readonly code: DevinQuotaErrorCode) {
    super(code);
    this.name = 'DevinQuotaError';
  }
}

export interface DevinRequestGeneration {
  session: number;
  file: number;
}

interface DevinQuotaDependencies {
  refresh: (target: AuthFileLookup) => Promise<void>;
  list: (target: AuthFileLookup) => Promise<{ files: AuthFileItem[] }>;
  generation: (name: string) => DevinRequestGeneration;
}

/**
 * Share in-flight work between card/page/batch entry points. Limit upstream calls
 * to three at once. Every queued job and the POST → GET boundary recheck both
 * session and file generations, so old jobs cannot run against a new connection.
 */
export function createDevinQuotaFetcher(deps: DevinQuotaDependencies) {
  const inFlight = new Map<string, Promise<DevinQuotaData>>();
  const lastObserved = new Map<string, { key: string; atMs: number }>();
  let observationSession: number | undefined;
  const pools = new Map<number, { queue: Array<() => void>; active: number }>();

  const getPool = (session: number) => {
    const existing = pools.get(session);
    if (existing) return existing;
    const pool = { queue: [] as Array<() => void>, active: 0 };
    pools.set(session, pool);
    return pool;
  };

  const runNext = (session: number) => {
    const pool = pools.get(session);
    if (!pool) return;
    while (pool.active < 3 && pool.queue.length > 0) {
      pool.active += 1;
      pool.queue.shift()!();
    }
    if (pool.active === 0 && pool.queue.length === 0) pools.delete(session);
  };

  return (file: AuthFileItem): Promise<DevinQuotaData> => {
    const name = file.name.trim();
    const authIndex = normalizeAuthIndex(file.authIndex ?? file.auth_index);
    if (!name || !authIndex) return Promise.reject(new DevinQuotaError('missing_identity'));
    const target = { name, authIndex };
    const generation = deps.generation(name);
    if (observationSession !== generation.session) {
      lastObserved.clear();
      observationSession = generation.session;
    }
    const identityKey = JSON.stringify([name, authIndex]);
    const key = JSON.stringify([generation.session, generation.file, name, authIndex]);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const assertCurrent = () => {
      const current = deps.generation(name);
      if (current.session !== generation.session || current.file !== generation.file) {
        throw new DevinQuotaError('stale_request');
      }
    };
    const latest = lastObserved.get(identityKey);
    const previous = Math.max(
      readDevinQuotaSnapshot(file).observedAtMs ?? 0,
      latest?.key === key ? latest.atMs : 0
    );
    const pool = getPool(generation.session);
    const request = new Promise<DevinQuotaData>((resolve, reject) => {
      pool.queue.push(() => {
        const execute = async () => {
          assertCurrent();
          await deps.refresh(target);
          assertCurrent();
          const response = await deps.list(target);
          assertCurrent();
          const freshFile = response.files.find(
            (entry) =>
              entry.name === name &&
              normalizeAuthIndex(entry.authIndex ?? entry.auth_index) === authIndex &&
              String(entry.provider ?? entry.type)
                .trim()
                .toLowerCase() === 'devin'
          );
          if (!freshFile) throw new DevinQuotaError('file_not_found');
          const quota = readDevinQuotaSnapshot(freshFile);
          if (!hasDevinQuotaObservation(quota)) throw new DevinQuotaError('empty_data');
          // issue #429 guarantees quota.signals, but its response contract does not
          // guarantee quota.observed_at. Use freshness checks when both observations
          // exist; otherwise the successful synchronous POST → GET is authoritative.
          if (previous > 0 && quota.observedAtMs !== null && quota.observedAtMs <= previous) {
            throw new DevinQuotaError('refresh_unconfirmed');
          }
          if (quota.observedAtMs !== null) {
            lastObserved.set(identityKey, { key, atMs: quota.observedAtMs });
          }
          return quota;
        };
        const finish = () => {
          inFlight.delete(key);
          pool.active -= 1;
          runNext(generation.session);
        };
        void execute().then(
          (quota) => {
            finish();
            resolve(quota);
          },
          (error: unknown) => {
            finish();
            reject(error);
          }
        );
      });
    });
    inFlight.set(key, request);
    runNext(generation.session);
    return request;
  };
}
