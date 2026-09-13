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
  const queue: Array<() => void> = [];
  let active = 0;

  const runNext = () => {
    while (active < 3 && queue.length > 0) {
      active += 1;
      queue.shift()!();
    }
  };

  return (file: AuthFileItem): Promise<DevinQuotaData> => {
    const name = file.name.trim();
    const authIndex = normalizeAuthIndex(file.authIndex ?? file.auth_index);
    if (!name || !authIndex) return Promise.reject(new DevinQuotaError('missing_identity'));
    const target = { name, authIndex };
    const generation = deps.generation(name);
    const key = JSON.stringify([generation.session, generation.file, name, authIndex]);
    const existing = inFlight.get(key);
    if (existing) return existing;

    const assertCurrent = () => {
      const current = deps.generation(name);
      if (current.session !== generation.session || current.file !== generation.file) {
        throw new DevinQuotaError('stale_request');
      }
    };
    const previous = readDevinQuotaSnapshot(file).observedAtMs;
    const request = new Promise<DevinQuotaData>((resolve, reject) => {
      queue.push(() => {
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
          if (
            quota.observedAtMs === null ||
            (previous !== null && quota.observedAtMs <= previous)
          ) {
            // The backend can return 200 without making an upstream request.
            throw new DevinQuotaError('refresh_unconfirmed');
          }
          return quota;
        };
        void execute()
          .then(resolve, reject)
          .finally(() => {
            inFlight.delete(key);
            active -= 1;
            runNext();
          });
      });
    });
    inFlight.set(key, request);
    runNext();
    return request;
  };
}
