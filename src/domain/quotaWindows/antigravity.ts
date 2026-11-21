import type { AntigravityQuotaSummaryPayload } from '@/types';
import { buildAntigravityQuotaGroups } from '@/utils/quota/builders';

export interface AntigravityQuotaWindow {
  id: string;
  label: string;
  labelKey: string;
  usedPercent: number;
  resetAtMs: number | null;
  periodHours: number | null;
}

/** The Gemini group's buckets are the account's pooled windows (user direction, 21 Nov 2026). */
const GEMINI_POOL_IDS: Readonly<Record<string, 'five-hour' | 'weekly'>> = {
  'gemini-5h': 'five-hour',
  'gemini-weekly': 'weekly',
};
const POOL_LABEL_KEYS = {
  'five-hour': 'antigravity_quota.five_hour_limit',
  weekly: 'antigravity_quota.weekly_limit',
} as const;
const THIRD_PARTY_LABEL_KEYS: Readonly<Record<string, string>> = {
  '3p-5h': 'antigravity_quota.claude_gpt_five_hour_limit',
  '3p-weekly': 'antigravity_quota.claude_gpt_weekly_limit',
};

/**
 * Antigravity's `retrieveUserQuotaSummary` as quota windows for the history collector. The Gemini
 * group's 5-hour and weekly buckets become the `five-hour` and `weekly` windows; every other
 * bucket keeps its own id (lane `model`, `lanes.ts`), so it is shown but never pooled. An unknown
 * group's bucket keeps its upstream name as its label.
 */
export function buildAntigravityQuotaWindows(
  payload: AntigravityQuotaSummaryPayload
): AntigravityQuotaWindow[] {
  return buildAntigravityQuotaGroups(payload).flatMap((group) =>
    group.buckets.map((bucket) => {
      const pooled = GEMINI_POOL_IDS[bucket.id];
      return {
        id: pooled ?? bucket.id,
        label: `${group.label} · ${bucket.label}`,
        labelKey: pooled
          ? POOL_LABEL_KEYS[pooled]
          : (THIRD_PARTY_LABEL_KEYS[bucket.id] ?? `${group.label} · ${bucket.label}`),
        usedPercent: (1 - bucket.remainingFraction) * 100,
        resetAtMs: bucket.resetAtMs ?? null,
        periodHours: bucket.periodHours ?? null,
      };
    })
  );
}
