import { apiClient } from './client';
import { apiCallApi, type ApiCallRequest, type ApiCallResult } from './apiCall';
import { CLAUDE_REQUEST_HEADERS, CLAUDE_USAGE_URL } from '@/utils/quota/constants';

export const CLAUDE_USAGE_CACHE_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;
type UsageKind = 'quota' | 'grants';
type UsageRead = { response: ApiCallResult; observedAt: string };
type Backoff =
  { kind: 'open' } | { kind: 'blocked'; until: number; failures: number; response: ApiCallResult };
type AccountReads = {
  files: Set<string>;
  cache: Map<UsageKind, { read: UsageRead; expiresAt: number }>;
  inFlight: Map<UsageKind, Promise<UsageRead>>;
  backoff: Backoff;
};

const defaultDependencies = {
  revision: () => apiClient.getConnectionRevision(),
  now: () => Date.now(),
  random: () => Math.random(),
  request: (request: ApiCallRequest) => apiCallApi.request(request, { timeout: 12000 }),
};

function retryAfterMs(response: ApiCallResult, now: number): number {
  const value = Object.entries(response.header).find(
    ([name]) => name.toLowerCase() === 'retry-after'
  )?.[1]?.[0];
  if (!value?.trim()) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

/** Display reads share per-account throttling. Reset-spending preflights use fresh API calls. */
export function createClaudeUsageReader(deps = defaultDependencies) {
  let revision = deps.revision();
  const accounts = new Map<string, AccountReads>();
  const syncSession = () => {
    if (revision !== deps.revision()) {
      revision = deps.revision();
      accounts.clear();
    }
    return revision;
  };
  return {
    clear(names?: string[]) {
      if (!names) accounts.clear();
      else {
        for (const [index, account] of accounts) {
          if (names.some((name) => account.files.has(name))) accounts.delete(index);
        }
      }
    },
    invalidate(authIndex: string) {
      syncSession();
      accounts.delete(authIndex);
    },
    read(authIndex: string, kind: UsageKind, fileName?: string): Promise<UsageRead> {
      const session = syncSession();
      let account = accounts.get(authIndex);
      if (!account) {
        account = {
          files: new Set(),
          cache: new Map(),
          inFlight: new Map(),
          backoff: { kind: 'open' },
        };
        accounts.set(authIndex, account);
      }
      const owner = account;
      if (fileName) owner.files.add(fileName);
      const now = deps.now();
      const cached = owner.cache.get(kind);
      if (cached && cached.expiresAt > now) return Promise.resolve(cached.read);
      if (owner.backoff.kind === 'blocked' && owner.backoff.until > now) {
        return Promise.resolve({
          response: owner.backoff.response,
          observedAt: new Date(now).toISOString(),
        });
      }
      const pending = owner.inFlight.get(kind);
      if (pending) return pending;
      const current = () => deps.revision() === session && accounts.get(authIndex) === owner;
      const request = deps
        .request({
          authIndex,
          method: 'GET',
          url:
            kind === 'quota' ? CLAUDE_USAGE_URL : `${CLAUDE_USAGE_URL}?cedar_ember=1&skip_spend=1`,
          header: { ...CLAUDE_REQUEST_HEADERS, Accept: 'application/json' },
        })
        .then((response) => {
          if (!current()) throw new Error('Claude usage observation invalidated');
          const observed = deps.now();
          const read = { response, observedAt: new Date(observed).toISOString() };
          if (response.statusCode === 429) {
            const failures = owner.backoff.kind === 'blocked' ? owner.backoff.failures + 1 : 1;
            const delay = Math.min(
              MAX_BACKOFF_MS,
              CLAUDE_USAGE_CACHE_MS * 2 ** Math.min(10, failures - 1)
            );
            owner.backoff = {
              kind: 'blocked',
              failures,
              until:
                observed +
                Math.max(delay * (1 + deps.random() * 0.1), retryAfterMs(response, observed)),
              response,
            };
          } else if (response.statusCode >= 200 && response.statusCode < 300) {
            // A parallel success must not erase a rate limit from the other usage variant.
            if (owner.backoff.kind !== 'blocked' || owner.backoff.until <= observed) {
              owner.backoff = { kind: 'open' };
            }
            owner.cache.set(kind, { read, expiresAt: observed + CLAUDE_USAGE_CACHE_MS });
          }
          return read;
        })
        .finally(() => {
          if (current() && owner.inFlight.get(kind) === request) owner.inFlight.delete(kind);
        });
      owner.inFlight.set(kind, request);
      return request;
    },
  };
}

export const claudeUsageReader = createClaudeUsageReader();
