/**
 * Which quota lane a window id belongs to, for Claude and Codex.
 *
 * One decision shared by the history collector, the pool card and the /quota
 * timeline. The weekly and five-hour lanes are the account-wide windows; every
 * model-scoped, monthly or surface-scoped window has its own lane and is never
 * mistaken for them, even when it reports the same period.
 */

export type QuotaLane = 'weekly' | 'five-hour' | 'model' | 'monthly' | 'other';
export type PoolLane = 'weekly' | 'five-hour';
export type LaneProvider = 'claude' | 'codex';

const CLAUDE_LANES: Readonly<Record<string, QuotaLane>> = {
  'five-hour': 'five-hour',
  'seven-day': 'weekly',
  'seven-day-opus': 'model',
  'seven-day-sonnet': 'model',
  'seven-day-fable': 'model',
  // Scoped to a surface (OAuth apps, Cowork), not to the account.
  'seven-day-oauth-apps': 'other',
  'seven-day-cowork': 'other',
};

const CODEX_LANES: Readonly<Record<string, QuotaLane>> = {
  'five-hour': 'five-hour',
  weekly: 'weekly',
  monthly: 'monthly',
  'code-review-five-hour': 'model',
  'code-review-weekly': 'model',
  'code-review-monthly': 'model',
};

// Additional rate limits: `${limit-name}-${five-hour|weekly|monthly}-${index}`.
const CODEX_ADDITIONAL_LIMIT = /-(five-hour|weekly|monthly)-\d+$/;

export function laneOf(provider: LaneProvider, windowId: string): QuotaLane {
  if (provider === 'claude') return CLAUDE_LANES[windowId] ?? 'other';
  return CODEX_LANES[windowId] ?? (CODEX_ADDITIONAL_LIMIT.test(windowId) ? 'model' : 'other');
}

/** The one window id of `provider` that is its account-wide window for `lane`. */
export function poolWindowId(provider: LaneProvider, lane: PoolLane): string {
  if (lane === 'five-hour') return 'five-hour';
  return provider === 'claude' ? 'seven-day' : 'weekly';
}
