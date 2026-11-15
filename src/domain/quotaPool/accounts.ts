import type { AccountBilling } from '../accountBilling';
import type { ClaudeDollarWindow, ClaudeExtraUsage } from '../../types/quota';
import type { QuotaLane } from '../quotaWindows/lanes';
import type { AccountResets, PoolProviderId } from './types';

/**
 * Public contract of `GET /v1/accounts`: prox-history's per-account read model for Claude and
 * Codex accounts of the manifest sources. Pages read it instead of reading the hubs.
 */
export interface ServerAccountWindow {
  id: string;
  /** From `laneOf`: weekly and five-hour are the account-wide windows, every other limit its own. */
  lane: QuotaLane;
  labelKey: string;
  labelParams?: Record<string, string | number>;
  remainingPercent: number | null;
  resetAtMs: number | null;
  periodHours: number | null;
}

export interface ServerAccount {
  /** The stored account id (a migrated account keeps its legacy one). */
  id: string;
  /** `${instanceId}:${provider}:${sha256}`, which a browser builds from a source and auth index. */
  sourceAccountId: string | null;
  instanceId: string | null;
  provider: PoolProviderId;
  disabled: boolean;
  /**
   * `disabled` serves the last stored weekly/five-hour sample, aged by `observedAtMs`; the
   * collector never reads a disabled account. `stale`: no reading in the last 15 minutes.
   */
  status: 'ok' | 'stale' | 'error' | 'disabled';
  /** When the newest window reading was taken; null when the account has none yet. */
  observedAtMs: number | null;
  /** As /v1/pools: a default label and a masked identifier; `email` only with `reveal=true`. */
  label: string;
  identifier: string;
  email?: string;
  /** `type` is the provider's own plan id (e.g. `pro`), for the plan chip. */
  plan: { label: string | null; known: boolean; type: string | null };
  windows: ServerAccountWindow[];
  resets: AccountResets | null;
  billing: AccountBilling | null;
  /** Claude only, memory-only like billing: never stored, never pooled. */
  extraUsage?: ClaudeExtraUsage | null;
  dollarWindows?: ClaudeDollarWindow[];
}

export interface ServerAccounts {
  accounts: ServerAccount[];
  lastRefreshAtMs: number | null;
  /** When the next full collection is scheduled; the page-wide refresh answers with the same. */
  nextRefreshAtMs: number;
  refreshing: boolean;
}

/** `POST /v1/refresh {accountId}`: `retryAtMs` is set when the 20 s per-account floor skipped it. */
export interface AccountRefreshResult {
  refreshed: boolean;
  retryAtMs: number | null;
}
