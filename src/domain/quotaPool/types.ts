import type { AccountBilling } from '../accountBilling';
/** Public contract for the server-owned quota history and forecast domain. */
export type PoolProviderId = 'claude' | 'codex';
export type PoolWindow = 'weekly' | 'five-hour';
export type PoolForecastState =
  | 'ready'
  | 'collecting'
  | 'partial'
  | 'stale'
  | 'no-accounts'
  /** Every eligible account answered and has no limit in this window, so there is nothing to total. */
  | 'no-limit';
export interface PoolPoint {
  atMs: number;
  remainingPoints: number | null;
  burnPointsPerHour: number | null;
  drainPointsPerHour: number | null;
}
export interface PoolReset {
  atMs: number;
  gainPoints: number;
}
export interface PoolAccount {
  id: string;
  /** Source-qualified credential identity (`${instanceId}:${provider}:${digest}`); null when unattributed. */
  sourceAccountId: string | null;
  label: string;
  /** Masked address or name, always present, so accounts can be told apart. */
  identifier?: string;
  /** Claude Ultra answered with other limits but no five-hour one: that limit does not exist for it. */
  noFiveHourLimit?: boolean;
  email?: string;
  disabled: boolean;
  /** `no-limit`: the provider answered and the account has no limit in this window (Ultra, 5-hour). */
  status: 'ok' | 'stale' | 'error' | 'disabled' | 'missing-window' | 'no-limit';
  observedAtMs: number | null;
  remainingPercent: number | null;
  resetAtMs: number | null;
  burnPointsPerHour: number | null;
  emptyAtMs: number | null;
  /** Subscription weight; capacityPoints is 100 per base plan (Claude Pro / ChatGPT Plus). */
  plan: { label: string | null; capacityPoints: number; known: boolean };
  /** Latest reading of every limit the provider reports (5-hour, weekly, per-model weekly…). */
  windows: AccountQuotaWindow[];
  /** Latest reset (Claude grant / Codex credit) reading; null when none has been read yet. */
  resets: AccountResets | null;
  billing: AccountBilling | null;
}
/** Why resets this account holds can't be spent now. `ineligible:<reason>` keeps Claude's reason. */
export type AccountResetBlocker =
  'not_limited' | 'cooldown' | 'paused' | 'not_applicable' | `ineligible:${string}`;
export interface AccountResets {
  /** Resets the account holds. */
  available: number;
  /** Resets that could be spent right now (0..available). */
  usable: number;
  /** Set when usable is 0 and the provider says why; null when nothing blocks or nothing is held. */
  blocker: AccountResetBlocker | null;
  /** Earliest expiry among held resets, if the provider gives one. */
  nextExpiryAtMs: number | null;
  /**
   * Expiry of each held reset whose expiry is known, soonest first, one entry per reset. A use
   * spends the first. Absent when the reading carried no per-reset detail.
   */
  expiries?: number[];
  /**
   * Claude only: what each reset in `expiries` refills, in the same order (a Fable reset only
   * returns what Fable used). Absent when the provider doesn't say or nothing is dated.
   */
  kinds?: AccountResetKind[];
  observedAtMs: number;
}
/**
 * What a Claude reset refills, as Claude Code names it: a 5-hour, weekly, Fable (returns only
 * what Fable models used to the weekly limit) or full reset.
 */
export type AccountResetKind = 'session' | 'weekly' | 'fable' | 'full';
export interface AccountQuotaWindow {
  id: string;
  labelKey: string;
  labelParams?: Record<string, string | number>;
  remainingPercent: number | null;
  resetAtMs: number | null;
  /** Window length in hours; absent on readings that predate it. */
  periodHours?: number | null;
}
export interface QuotaPool {
  instanceId?: string;
  sourceLabel?: string;
  provider: PoolProviderId;
  accountCount: number;
  eligibleCount: number;
  loadedCount: number;
  capacityPoints: number;
  remainingPoints: number | null;
  burnPointsPerHour: number | null;
  drainPointsPerHour: number | null;
  forecastState: PoolForecastState;
  firstEmptyAtMs: number | null;
  poolEmptyAtMs: number | null;
  nextResetAtMs: number | null;
  nextResetGainPoints: number | null;
  recorded: PoolPoint[];
  projected: PoolPoint[];
  resets: PoolReset[];
  accounts: PoolAccount[];
}
/** Shared trace contract; combined totals have no provider identity or credential inventory. */
export type PoolTrace = Pick<
  QuotaPool,
  | 'capacityPoints'
  | 'remainingPoints'
  | 'burnPointsPerHour'
  | 'drainPointsPerHour'
  | 'forecastState'
  | 'recorded'
  | 'projected'
  | 'resets'
  | 'poolEmptyAtMs'
>;
export type PoolLayer = PoolTrace & Pick<QuotaPool, 'provider' | 'instanceId' | 'sourceLabel'>;
export interface CombinedPoolResult {
  /** Provider contributions on the same history/event timeline; contains no account metadata. */
  layers?: PoolLayer[];
  series: PoolTrace | null;
  unavailableReason: 'no-accounts' | 'ambiguous-sources' | null;
}
export interface PoolDashboard {
  nowMs: number;
  fromMs: number;
  toMs: number;
  window: PoolWindow;
  lookbackHours: 1 | 3 | 6;
  multiplier: 0 | 0.5 | 1 | 2;
  historyStartedAtMs: number | null;
  /** Membership version of the credential inventory this pool was built from. */
  inventoryVersion?: string;
  lastRefreshAtMs: number | null;
  nextRefreshAtMs: number;
  refreshing: boolean;
  issues: {
    instanceId?: string;
    sourceLabel?: string;
    provider: PoolProviderId;
    code: 'inventory-unavailable' | 'quota-unavailable';
  }[];
  /** Occurrences across sources are never interpreted as independent allowances. */
  combinations?: {
    provider: PoolProviderId;
    reason: 'cross-source-combination-unverified';
    occurrenceCount: number;
    capacityPoints: null;
    remainingPoints: null;
    burnPointsPerHour: null;
    drainPointsPerHour: null;
    firstEmptyAtMs: null;
    poolEmptyAtMs: null;
    recorded: [];
    projected: [];
  }[];
  unresolvedHistoryAccountCount?: number;
  pools: QuotaPool[];
  /** Optional during a UI/history-service rolling upgrade. */
  combined?: Record<PoolProviderId | 'all', CombinedPoolResult>;
}
