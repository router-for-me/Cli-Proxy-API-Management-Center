/**
 * Per-provider quota summaries for the page header tiles.
 *
 * Read-only: derives from the store slices the sections already populate, so it
 * adds no fetching, no lifecycle and no extra requests.
 *
 * NOTE ON POLARITY — providers disagree, and getting this wrong silently shows
 * 93% where 7% is meant:
 *   claude / codex  store USED percent          -> remaining = 100 - used
 *   antigravity     stores REMAINING as 0..1    -> remaining = fraction * 100
 *   kimi            stores raw used/limit counts-> remaining = (limit-used)/limit
 *   xai             has no per-limit array at all (rows are synthesized in its
 *                   renderer from billing scalars) -> reported as unknown
 */

import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  KimiQuotaState,
} from '@/types';

export type QuotaProviderKey = 'claude' | 'antigravity' | 'codex' | 'kimi' | 'xai';

/** Credential input for summarizeProvider: `name` is the auth-file key used to
 *  index the store slice, `label` the human display name the caller resolves. */
export interface QuotaSummaryCredential {
  name: string;
  label: string;
}

export interface QuotaAccountSummary {
  name: string;
  label: string;
  /** Lowest remaining percentage for this credential; null when not loaded. */
  remaining: number | null;
}

export interface QuotaProviderSummary {
  provider: QuotaProviderKey;
  /** Credentials configured for this provider (independent of whether quota loaded). */
  total: number;
  /** Credentials whose quota has actually been fetched. */
  loaded: number;
  /** Lowest remaining percentage across loaded credentials; null when unknown. */
  worstRemaining: number | null;
  /** Credentials sitting under the at-risk threshold. */
  atRisk: number;
  /** Every configured credential, worst remaining first, not-yet-loaded last. */
  accounts: QuotaAccountSummary[];
  /** Soonest upcoming reset across loaded credentials; null when unknowable. */
  nextResetLabel: string | null;
}

export const AT_RISK_THRESHOLD = 30;

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

const fromUsed = (used: unknown): number | null =>
  typeof used === 'number' && Number.isFinite(used) ? clampPercent(100 - used) : null;

/** Lowest remaining percentage for one credential, or null if it can't be derived. */
function worstOfClaude(state: ClaudeQuotaState): number | null {
  return minOf(state.windows?.map((w) => fromUsed(w.usedPercent)));
}

function worstOfCodex(state: CodexQuotaState): number | null {
  return minOf(state.windows?.map((w) => fromUsed(w.usedPercent)));
}

function worstOfAntigravity(state: AntigravityQuotaState): number | null {
  const values = (state.groups ?? []).flatMap((group) =>
    (group.buckets ?? []).map((bucket) =>
      typeof bucket.remainingFraction === 'number' && Number.isFinite(bucket.remainingFraction)
        ? clampPercent(bucket.remainingFraction * 100)
        : null
    )
  );
  return minOf(values);
}

function worstOfKimi(state: KimiQuotaState): number | null {
  const values = (state.rows ?? []).map((row) => {
    if (row.limit > 0) return clampPercent(Math.round(((row.limit - row.used) / row.limit) * 100));
    return row.used > 0 ? 0 : null;
  });
  return minOf(values);
}

function minOf(values: (number | null)[] | undefined): number | null {
  const known = (values ?? []).filter((v): v is number => v !== null);
  return known.length ? Math.min(...known) : null;
}

type AnyQuotaState = { status?: string } & Record<string, unknown>;

/** Extract the lowest remaining percentage for a single credential's quota state. */
export function worstRemainingFor(
  provider: QuotaProviderKey,
  state: AnyQuotaState | undefined
): number | null {
  if (!state || state.status !== 'success') return null;
  switch (provider) {
    case 'claude':
      return worstOfClaude(state as unknown as ClaudeQuotaState);
    case 'codex':
      return worstOfCodex(state as unknown as CodexQuotaState);
    case 'antigravity':
      return worstOfAntigravity(state as unknown as AntigravityQuotaState);
    case 'kimi':
      return worstOfKimi(state as unknown as KimiQuotaState);
    // xAI keeps no per-limit array — synthesized in its renderer from billing
    // scalars, and `paid-health` mode carries no quota at all. Report unknown
    // rather than invent a number.
    case 'xai':
    default:
      return null;
  }
}

/**
 * Reset labels from formatQuotaResetTime / formatUnixSeconds are zero-padded
 * "MM/DD, HH:MM", so lexical order equals chronological order within a year.
 * Labels in any other shape (other locales, "-") are skipped rather than
 * mis-ordered; with none left the reset is reported unknown.
 *
 * KNOWN LIMIT — across a year boundary this picks the wrong label: "12/31" sorts
 * after "01/02", so a January reset wins over a December one. Not worth fixing
 * here: the quota window types (ClaudeQuotaWindow / CodexQuotaWindow) keep only
 * the formatted string, so a correct comparison needs the raw reset timestamp
 * threaded through the parsers first. Until then this is a once-a-year cosmetic
 * mis-pick on a secondary label, and the per-card rows remain correct.
 */
const WINDOW_RESET_PATTERN = /^\d{2}\/\d{2}, \d{2}:\d{2}$/;

function soonestWindowReset(states: AnyQuotaState[]): string | null {
  const labels = states.flatMap((state) => {
    const windows = (state as { windows?: { resetLabel?: unknown }[] }).windows ?? [];
    return windows
      .map((w) => w.resetLabel)
      .filter((l): l is string => typeof l === 'string' && WINDOW_RESET_PATTERN.test(l));
  });
  return labels.length ? labels.reduce((min, l) => (l < min ? l : min)) : null;
}

/** Parse a kimi resetHint ("3h 20m", "7h", "45m", "<1m") into minutes. */
function kimiHintMinutes(hint: string): number | null {
  if (hint === '<1m') return 0;
  const match = /^(?:(\d+)h)?\s*(?:(\d+)m)?$/.exec(hint);
  if (!match || (match[1] === undefined && match[2] === undefined)) return null;
  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}

function soonestKimiReset(states: AnyQuotaState[]): string | null {
  let best: { minutes: number; hint: string } | null = null;
  for (const state of states) {
    const rows = (state as { rows?: { resetHint?: unknown }[] }).rows ?? [];
    for (const row of rows) {
      if (typeof row.resetHint !== 'string') continue;
      const minutes = kimiHintMinutes(row.resetHint);
      if (minutes === null) continue;
      if (!best || minutes < best.minutes) best = { minutes, hint: row.resetHint };
    }
  }
  return best ? best.hint : null;
}

function nextResetLabelFor(provider: QuotaProviderKey, states: AnyQuotaState[]): string | null {
  switch (provider) {
    case 'claude':
    case 'codex':
      return soonestWindowReset(states);
    case 'kimi':
      return soonestKimiReset(states);
    // Antigravity reset labels depend on live nowMs + serverTimeOffsetMs, so a
    // string precomputed here would go stale; xAI exposes no reset data. Report
    // unknown rather than invent a value.
    case 'antigravity':
    case 'xai':
    default:
      return null;
  }
}

export function summarizeProvider(
  provider: QuotaProviderKey,
  credentials: QuotaSummaryCredential[],
  slice: Record<string, AnyQuotaState> | undefined
): QuotaProviderSummary {
  let loaded = 0;
  let atRisk = 0;
  const values: number[] = [];
  const accounts: QuotaAccountSummary[] = [];
  const loadedStates: AnyQuotaState[] = [];

  for (const { name, label } of credentials) {
    const state = slice?.[name];
    if (state?.status === 'success') loadedStates.push(state);
    const worst = worstRemainingFor(provider, state);
    accounts.push({ name, label, remaining: worst });
    if (worst === null) continue;
    loaded += 1;
    values.push(worst);
    if (worst < AT_RISK_THRESHOLD) atRisk += 1;
  }

  // Worst account first so the mini list leads with what needs attention;
  // sort() is stable, so unloaded accounts keep their configured order at the end.
  accounts.sort((a, b) => {
    if (a.remaining === null) return b.remaining === null ? 0 : 1;
    if (b.remaining === null) return -1;
    return a.remaining - b.remaining;
  });

  return {
    provider,
    total: credentials.length,
    loaded,
    worstRemaining: values.length ? Math.min(...values) : null,
    atRisk,
    accounts,
    nextResetLabel: nextResetLabelFor(provider, loadedStates),
  };
}
