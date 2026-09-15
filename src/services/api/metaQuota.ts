import type { MetaQuotaData, MetaQuotaWindow } from '@/types';

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const parseFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseUsedPercent = (value: unknown): number | null => {
  const percent = parseFiniteNumber(value);
  return percent === null ? null : Math.min(100, Math.max(0, percent));
};

const parsePositiveNumber = (value: unknown): number | undefined => {
  const parsed = parseFiniteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : undefined;
};

const parseWindow = (
  id: MetaQuotaWindow['id'],
  value: unknown,
  includeDuration: boolean
): MetaQuotaWindow => {
  const raw = asRecord(value);
  const resetAt = parsePositiveNumber(raw.resets_at);
  const durationMinutes = includeDuration
    ? parsePositiveNumber(raw.window_duration_mins)
    : undefined;

  return {
    id,
    usedPercent: parseUsedPercent(raw.used_percent),
    ...(resetAt === undefined ? {} : { resetAt }),
    ...(durationMinutes === undefined ? {} : { durationMinutes }),
  };
};

/**
 * Parse only fields used by the quota UI. The upstream response may also carry
 * api_key and PII; retaining the source object (or spreading it) here is forbidden.
 */
export function parseMetaQuotaPayload(payload: unknown): MetaQuotaData {
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = null;
    }
  }

  const root = asRecord(payload);
  const usage = asRecord(root.subs_usage);
  const explicitPlan = typeof root.subs_tier_name === 'string' ? root.subs_tier_name.trim() : '';
  const usagePlan = typeof usage.tier === 'string' ? usage.tier.trim() : '';
  const planName = explicitPlan || usagePlan;

  return {
    ...(planName ? { planName } : {}),
    ...(typeof root.is_subs_active === 'boolean'
      ? { isSubscriptionActive: root.is_subs_active }
      : {}),
    windows: [
      parseWindow('window', usage.window, true),
      parseWindow('weekly', usage.weekly, false),
    ],
  };
}

export const hasMetaQuotaData = (quota: MetaQuotaData): boolean =>
  quota.planName !== undefined ||
  quota.isSubscriptionActive !== undefined ||
  quota.windows.some(
    (window) =>
      window.usedPercent !== null ||
      window.resetAt !== undefined ||
      window.durationMinutes !== undefined
  );
