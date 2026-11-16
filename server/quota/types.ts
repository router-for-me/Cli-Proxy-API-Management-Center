import type { PoolProviderId, PoolWindow } from '../../src/domain/quotaPool/types';

export interface StoredAccount {
  id: string;
  instanceId?: string;
  /** Current `${instanceId}:${provider}:${digest}` identity, even when `id` is a migrated legacy one. */
  sourceAccountId?: string;
  provider: PoolProviderId;
  name: string;
  email: string | null;
  disabled: boolean;
  retired: boolean;
  /** When the account left its inventory; absent while active. Its rows are purged after 24 h. */
  retiredAtMs?: number;
  lastSeenAtMs: number;
  lastErrorAtMs: number | null;
  /** Latest plan the provider reported, e.g. "promax" or "default_claude_max_20x". */
  plan?: string;
  planObservedAtMs?: number;
  /** Earliest stored sample; null when it has none yet. Before it the account was not in the pool. */
  firstSampleAtMs?: number | null;
}

export const QUOTA_PROVIDERS: readonly PoolProviderId[] = Object.freeze(['claude', 'codex']);

/** Stored in place of a retired account's file name; its email is cleared. */
export const RETIRED_ACCOUNT_NAME = 'retired';
/** Retired accounts that were not deleted by name keep their (anonymous) rows this long. */
export const RETIRED_GRACE_MS = 24 * 60 * 60 * 1000;

/** Accounts that changed membership in one inventory write; ids only, never names. */
export interface InventoryChange {
  added: string[];
  removed: string[];
  purged: string[];
}

export interface QuotaSourceView {
  instanceId: string;
  sourceLabel: string;
}

export interface QuotaSample {
  accountId: string;
  window: PoolWindow;
  observedAtMs: number;
  remainingPercent: number | null;
  resetAtMs: number | null;
  periodHours: number | null;
}

/** What the collector held for one account at a moment: every usage window plus reset counts. */
export interface ResetReading {
  observedAtMs: number;
  windows: { id: string; remainingPercent: number | null; resetAtMs: number | null }[];
  resets: { available: number; usable: number; blocker: string | null } | null;
}

/** `pending` is a claim being sent; `unknown` one that may have been sent and never got an answer. */
export interface ResetEvent {
  id: number;
  accountId: string;
  provider: PoolProviderId;
  /** Claude: session, weekly, fable or full. Codex: its credit kind, `codex_rate_limits`. */
  kind: string;
  grantId: string | null;
  clientRequestId: string;
  outcome: string;
  requestedAtMs: number;
  settledAtMs: number | null;
  /** Whether the hub's routing cooldown was cleared after a spent reset; null when not tried. */
  cooldownCleared: boolean | null;
  before: ResetReading | null;
  after: ResetReading | null;
}

export { HOUR_MS, DAY_MS } from '../../src/utils/time/durations';
export const STALE_MS = 15 * 60_000;
export const MIN_RATE_SPAN_MS = 10 * 60_000;
export const REFRESH_INTERVAL_MS = 5 * 60_000;
// Anthropic's usage endpoint answers bursts with 429; polls under 90 s apart failed 25% of the time.
export const MANUAL_REFRESH_INTERVAL_MS = 4 * 60_000;
