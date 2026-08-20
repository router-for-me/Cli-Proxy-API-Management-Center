/**
 * Cursor quota data layer helpers.
 *
 * Cursor reports a subscription allowance in cents against a monthly billing
 * cycle, plus a per-model spend breakdown for the same period. Three reads on
 * `aiserver.v1.DashboardService` cover it; everything here is pure parsing over
 * their payloads so the shapes stay testable without a network.
 */

import type {
  CursorAggregatedUsage,
  CursorCurrentPeriodUsage,
  CursorModelSpend,
  CursorPlanInfo,
  CursorQuotaSummary,
} from '@/types';

/** Cursor's account plane. Inference lives elsewhere and is not read here. */
const CURSOR_DASHBOARD = 'https://api2.cursor.sh/aiserver.v1.DashboardService';

export const CURSOR_PLAN_INFO_URL = `${CURSOR_DASHBOARD}/GetPlanInfo`;
export const CURSOR_PERIOD_USAGE_URL = `${CURSOR_DASHBOARD}/GetCurrentPeriodUsage`;
export const CURSOR_AGGREGATED_USAGE_URL = `${CURSOR_DASHBOARD}/GetAggregatedUsageEvents`;

export const CURSOR_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
};

/** How many models the card lists before it stops. */
export const CURSOR_MODEL_ROW_LIMIT = 6;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Cursor sends every 64-bit field as a decimal string, so a plain `Number()`
 * on a missing key would yield NaN and render as a real zero. Absent stays
 * absent.
 */
export const parseCursorNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

export const parseCursorPayload = <T>(body: unknown): T | null => {
  if (body && typeof body === 'object') return body as T;
  if (typeof body !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object' ? (parsed as T) : null;
  } catch {
    return null;
  }
};

/** Cents to a displayable amount. Cursor counts in whole cents. */
export const formatCursorCents = (cents: number | null): string => {
  if (cents === null) return '--';
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const sortBySpend = (models: CursorModelSpend[]): CursorModelSpend[] =>
  [...models].sort((left, right) => right.cents - left.cents || left.model.localeCompare(right.model));

/**
 * The per-model breakdown, costliest first.
 *
 * Rows with no cost are dropped rather than listed at zero: a model that was
 * loaded but never billed says nothing about where the allowance went.
 */
export function buildCursorModelRows(usage: CursorAggregatedUsage | null): CursorModelSpend[] {
  const aggregations = usage?.aggregations ?? [];
  const rows = aggregations
    .map((row): CursorModelSpend | null => {
      const model = typeof row?.modelIntent === 'string' ? row.modelIntent.trim() : '';
      if (model === '') return null;
      const cents = parseCursorNumber(row?.totalCents) ?? 0;
      if (cents <= 0) return null;
      return {
        model,
        cents,
        inputTokens: parseCursorNumber(row?.inputTokens) ?? 0,
        outputTokens: parseCursorNumber(row?.outputTokens) ?? 0,
        cacheReadTokens: parseCursorNumber(row?.cacheReadTokens) ?? 0,
        cacheWriteTokens: parseCursorNumber(row?.cacheWriteTokens) ?? 0,
      };
    })
    .filter((row): row is CursorModelSpend => row !== null);

  return sortBySpend(rows).slice(0, CURSOR_MODEL_ROW_LIMIT);
}

/**
 * One card's worth of state, assembled from the three reads.
 *
 * `limit` is the plan's included allowance and `used` what has been drawn from
 * it, both in cents, so the meter reads the same way as every other provider's:
 * remaining capacity, not money spent. The billing cycle end is the instant the
 * allowance returns, which is what makes this a quota window rather than an
 * invoice.
 */
export function buildCursorQuotaSummary(
  plan: CursorPlanInfo | null,
  period: CursorCurrentPeriodUsage | null,
  usage: CursorAggregatedUsage | null
): CursorQuotaSummary {
  const planUsage = period?.planUsage;

  const limitCents = parseCursorNumber(planUsage?.limit) ?? parseCursorNumber(plan?.planInfo?.includedAmountCents);
  const usedCents = parseCursorNumber(planUsage?.totalSpend);
  const remainingCents = parseCursorNumber(planUsage?.remaining);

  const cycleStartMs =
    parseCursorNumber(period?.billingCycleStart) ?? null;
  const cycleEndMs =
    parseCursorNumber(period?.billingCycleEnd) ?? parseCursorNumber(plan?.planInfo?.billingCycleEnd);

  const periodHours =
    cycleStartMs !== null && cycleEndMs !== null && cycleEndMs > cycleStartMs
      ? (cycleEndMs - cycleStartMs) / HOUR_MS
      : null;

  const remainingPercent =
    limitCents !== null && limitCents > 0 && usedCents !== null
      ? Math.max(0, Math.min(100, ((limitCents - usedCents) / limitCents) * 100))
      : null;

  return {
    planName: typeof plan?.planInfo?.planName === 'string' ? plan.planInfo.planName : null,
    planPrice: typeof plan?.planInfo?.price === 'string' ? plan.planInfo.price : null,
    spendLimitType:
      typeof period?.spendLimitUsage?.limitType === 'string' ? period.spendLimitUsage.limitType : null,
    limitCents,
    usedCents,
    remainingCents,
    remainingPercent,
    autoPercentUsed: parseCursorNumber(planUsage?.autoPercentUsed),
    apiPercentUsed: parseCursorNumber(planUsage?.apiPercentUsed),
    cycleStartMs,
    cycleEndMs,
    periodHours,
    models: buildCursorModelRows(usage),
    totalSpendCents: parseCursorNumber(usage?.totalCostCents),
  };
}
