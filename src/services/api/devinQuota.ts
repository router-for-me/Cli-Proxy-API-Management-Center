import type { AuthFileItem, DevinQuotaData, DevinQuotaWindow } from '@/types';

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const parsePercent = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d+(?:\.\d+)?\s*%?$/.test(text)) return null;
  const percent = Number(text.replace(/\s*%$/, ''));
  return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : null;
};

/** Backend uses RFC3339; reject empty values and Go's zero time. */
const parseInstant = (value: unknown): number | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? ms : null;
};

/**
 * v7.3.0 auth-files quota.signals is a string map. Read only this observation,
 * never metadata, account, the list's observed_at, or scheduler cooldowns.
 */
export function readDevinQuotaSnapshot(file: AuthFileItem): DevinQuotaData {
  const quota = asRecord(file.quota);
  const signals = asRecord(quota.signals);
  const windows: DevinQuotaWindow[] = (['daily', 'weekly'] as const).map((id) => ({
    id,
    remainingPercent: parsePercent(signals[`${id}_quota_remaining_percent`]),
    resetAtMs: parseInstant(signals[`${id}_quota_reset_at`]),
    // Periods describe the named windows, not inferred reset instants.
    periodHours: id === 'daily' ? 24 : 168,
  }));
  return {
    windows,
    observedAtMs: parseInstant(quota.observed_at),
    plan: typeof signals.plan === 'string' ? signals.plan.trim() || null : null,
    planStartMs: parseInstant(signals.plan_start),
    planEndMs: parseInstant(signals.plan_end),
  };
}

export const hasDevinQuotaObservation = (quota: DevinQuotaData): boolean =>
  quota.windows.some((window) => window.remainingPercent !== null || window.resetAtMs !== null);
