/** Fork routing status. Rankings come from the backend, never from quota UI sorting. */
import type { AuthFileItem } from '@/types';
import { normalizeAuthIndex } from '@/utils/quota';

export const ROUTING_SNAPSHOT_TTL_MS = 90_000;
export const QUOTA_STRATEGY = 'soonest-reset-first';
export type RoutingTransport = 'http' | 'websocket';

export interface RoutingQuery {
  provider: string;
  model: string;
  transport: RoutingTransport;
}

export interface RoutingAccount {
  authIndex: string;
  priority: number;
  eligible: boolean;
  skippedReason: string;
  rank: number;
  quotaState: string;
  ageSeconds: number | null;
  window: { key: string; resetsAtMs: number; usedPercent: number } | null;
  refreshError: string;
}

/** A provider quota pool, for providers that meter model families separately. */
export interface RoutingPool {
  key: string;
  label: string;
}

export interface RoutingSnapshot extends RoutingQuery {
  strategy: string;
  generatedAtMs: number;
  receivedAtMs: number;
  nextAuthIndex: string | null;
  fallbackReason: string;
  sessionAffinity: boolean;
  /** The pool the backend ranked, chosen by the backend when the query names none. */
  pool: RoutingPool | null;
  accounts: RoutingAccount[];
}

export interface RoutingLoad {
  state: 'loading' | 'ready' | 'unsupported' | 'error';
  snapshot?: RoutingSnapshot;
}

export type RoutingLoads = Readonly<Record<string, RoutingLoad | undefined>>;

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid routing status');
  }
  return value as Record<string, unknown>;
};

const text = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('Invalid routing text');
  return value;
};

const integer = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error('Invalid routing integer');
  }
  return value;
};

const boolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('Invalid routing boolean');
  return value;
};

const instant = (value: unknown): number => {
  const at = Date.parse(text(value));
  if (!Number.isFinite(at)) throw new Error('Invalid routing instant');
  return at;
};

/** Older backends send neither field; a pool without a listed label shows its key. */
function routingPool(data: Record<string, unknown>): RoutingPool | null {
  if (data.pool == null || data.pool === '') return null;
  const key = text(data.pool);
  const listed = Array.isArray(data.pools)
    ? data.pools.map(record).find((pool) => pool.key === key)
    : undefined;
  return { key, label: listed && typeof listed.label === 'string' ? listed.label : key };
}

/** Reject mismatched contexts or invalid next-account claims instead of guessing. */
export function normalizeRoutingSnapshot(
  raw: unknown,
  query: RoutingQuery,
  receivedAtMs: number
): RoutingSnapshot {
  const data = record(raw);
  if (
    data.schema_version !== 1 ||
    data.prediction_scope !== 'new_session' ||
    data.provider !== query.provider ||
    data.model !== query.model ||
    data.transport !== query.transport ||
    !Array.isArray(data.accounts)
  ) {
    throw new Error('Unsupported routing status');
  }
  const seen = new Set<string>();
  const accounts = data.accounts.map((rawAccount): RoutingAccount => {
    const account = record(rawAccount);
    const authIndex = text(account.auth_index);
    if (!authIndex || seen.has(authIndex)) throw new Error('Invalid routing identity');
    seen.add(authIndex);
    const eligible = boolean(account.eligible);
    const rank = integer(account.rank);
    if (rank < 0 || (eligible ? rank === 0 : rank !== 0)) {
      throw new Error('Invalid routing rank');
    }
    let window: RoutingAccount['window'] = null;
    if (account.window != null) {
      const value = record(account.window);
      if (
        typeof value.used_percent !== 'number' ||
        !Number.isFinite(value.used_percent) ||
        value.used_percent < 0
      ) {
        throw new Error('Invalid routing usage');
      }
      window = {
        key: text(value.key),
        resetsAtMs: instant(value.resets_at),
        usedPercent: Math.min(100, value.used_percent),
      };
    }
    const ageSeconds = account.age_seconds == null ? null : integer(account.age_seconds);
    if (ageSeconds !== null && ageSeconds < 0) throw new Error('Invalid routing age');
    return {
      authIndex,
      priority: integer(account.priority),
      eligible,
      skippedReason: text(account.skipped_reason),
      rank,
      quotaState: text(account.quota_state),
      ageSeconds,
      window,
      refreshError: account.refresh_error == null ? '' : text(account.refresh_error),
    };
  });
  const nextAuthIndex = data.next_auth_index == null ? null : text(data.next_auth_index) || null;
  if (
    nextAuthIndex &&
    !accounts.some(
      (account) => account.authIndex === nextAuthIndex && account.eligible && account.rank === 1
    )
  ) {
    throw new Error('Invalid next routing account');
  }
  return {
    ...query,
    pool: routingPool(data),
    strategy: text(data.strategy),
    generatedAtMs: instant(data.generated_at),
    receivedAtMs,
    nextAuthIndex,
    fallbackReason: text(data.fallback_reason),
    sessionAffinity: boolean(data.session_affinity),
    accounts,
  };
}

export function currentRoutingSnapshot(
  load: RoutingLoad | undefined,
  nowMs: number
): RoutingSnapshot | null {
  if (load?.state !== 'ready' || !load.snapshot) return null;
  // The page uses the shared minute clock, whose last tick can predate this response.
  const age = Math.max(0, nowMs - load.snapshot.receivedAtMs);
  return age <= ROUTING_SNAPSHOT_TTL_MS ? load.snapshot : null;
}

/** Other strategies, plugin schedulers and Home cannot be predicted by this endpoint. */
export const hasRoutingPrediction = (snapshot: RoutingSnapshot): boolean =>
  snapshot.strategy === QUOTA_STRATEGY &&
  ['', 'quota_unavailable', 'no_eligible_accounts'].includes(snapshot.fallbackReason);

export function routingAccountFor(
  file: AuthFileItem,
  provider: string,
  loads: RoutingLoads,
  nowMs: number
): (RoutingAccount & { next: boolean; pool: RoutingPool | null }) | undefined {
  const snapshot = currentRoutingSnapshot(loads[provider], nowMs);
  if (!snapshot || !hasRoutingPrediction(snapshot)) return undefined;
  const index = normalizeAuthIndex(file.authIndex ?? file.auth_index);
  const account = snapshot.accounts.find((item) => item.authIndex === index);
  return account
    ? {
        ...account,
        ageSeconds:
          account.ageSeconds === null
            ? null
            : account.ageSeconds + Math.floor(Math.max(0, nowMs - snapshot.receivedAtMs) / 1000),
        next: account.authIndex === snapshot.nextAuthIndex,
        pool: snapshot.pool,
      }
    : undefined;
}

export const defaultRoutingQuery = (provider: string): RoutingQuery => ({
  provider,
  model: '',
  transport: provider === 'codex' ? 'websocket' : 'http',
});

export const routingReasonKey = (reason: string): string => {
  const known = [
    'quota_unavailable',
    'no_eligible_accounts',
    'strategy_not_predictable',
    'home_authoritative',
    'plugin_scheduler',
    'disabled',
    'model_unsupported',
    'unavailable',
    'cooldown',
    'quota_exhausted',
    'fresh',
    'missing',
    'stale',
    'malformed',
    'expired',
    'unsupported',
  ];
  return `pd_overview.reason_${known.includes(reason) ? reason : 'unknown'}`;
};
