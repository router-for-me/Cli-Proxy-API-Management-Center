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

export function summarizeProvider(
  provider: QuotaProviderKey,
  credentialNames: string[],
  slice: Record<string, AnyQuotaState> | undefined
): QuotaProviderSummary {
  let loaded = 0;
  let atRisk = 0;
  const values: number[] = [];

  for (const name of credentialNames) {
    const worst = worstRemainingFor(provider, slice?.[name]);
    if (worst === null) continue;
    loaded += 1;
    values.push(worst);
    if (worst < AT_RISK_THRESHOLD) atRisk += 1;
  }

  return {
    provider,
    total: credentialNames.length,
    loaded,
    worstRemaining: values.length ? Math.min(...values) : null,
    atRisk,
  };
}
