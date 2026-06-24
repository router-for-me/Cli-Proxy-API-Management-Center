/**
 * Builder functions for constructing quota data structures.
 */

import type {
  AntigravityQuotaBucket,
  AntigravityQuotaGroup,
  AntigravityQuotaSummaryPayload,
  KimiUsagePayload,
  KimiUsageDetail,
  KimiLimitItem,
  KimiLimitWindow,
  KimiQuotaRow,
} from '@/types';
import { normalizeQuotaFraction, normalizeStringValue } from './parsers';

const ANTIGRAVITY_BUCKET_WINDOW_ORDER = new Map<string, number>([
  ['5h', 0],
  ['five-hour', 0],
  ['five_hour', 0],
  ['weekly', 1],
  ['week', 1],
]);

function toStableId(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function getAntigravityWindowOrder(bucket: AntigravityQuotaBucket): number {
  const window = bucket.window?.toLowerCase();
  if (!window) return Number.MAX_SAFE_INTEGER;
  return ANTIGRAVITY_BUCKET_WINDOW_ORDER.get(window) ?? Number.MAX_SAFE_INTEGER;
}

export function buildAntigravityQuotaGroups(
  payload: AntigravityQuotaSummaryPayload
): AntigravityQuotaGroup[] {
  const groups = Array.isArray(payload.groups) ? payload.groups : [];

  return groups
    .map((group, groupIndex): AntigravityQuotaGroup | null => {
      const label =
        normalizeStringValue(group.displayName ?? group.display_name) ??
        `Quota Group ${groupIndex + 1}`;
      const groupId = toStableId(label, `quota-group-${groupIndex + 1}`);
      const buckets = Array.isArray(group.buckets) ? group.buckets : [];
      const parsedBuckets = buckets
        .map((bucket, bucketIndex): AntigravityQuotaBucket | null => {
          const remainingFraction = normalizeQuotaFraction(
            bucket.remainingFraction ?? bucket.remaining_fraction
          );
          if (remainingFraction === null) return null;

          const window = normalizeStringValue(bucket.window) ?? undefined;
          const rawId =
            normalizeStringValue(bucket.bucketId ?? bucket.bucket_id) ??
            `${groupId}-${window ?? `bucket-${bucketIndex + 1}`}`;
          const label = normalizeStringValue(bucket.displayName ?? bucket.display_name) ?? rawId;

          return {
            id: rawId,
            label,
            window,
            remainingFraction,
            resetTime: normalizeStringValue(bucket.resetTime ?? bucket.reset_time) ?? undefined,
            description: normalizeStringValue(bucket.description) ?? undefined,
          };
        })
        .filter((bucket): bucket is AntigravityQuotaBucket => bucket !== null)
        .sort((a, b) => {
          const orderDiff = getAntigravityWindowOrder(a) - getAntigravityWindowOrder(b);
          if (orderDiff !== 0) return orderDiff;
          return a.label.localeCompare(b.label);
        });

      if (parsedBuckets.length === 0) return null;

      return {
        id: groupId,
        label,
        description: normalizeStringValue(group.description) ?? undefined,
        buckets: parsedBuckets,
      };
    })
    .filter((group): group is AntigravityQuotaGroup => group !== null);
}

function toInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? Math.floor(parsed) : null;
  }
  return null;
}

type KimiRowLabel = Pick<KimiQuotaRow, 'label' | 'labelKey' | 'labelParams'>;

function kimiResetHint(data: Record<string, unknown>): string | undefined {
  const absoluteKeys = ['reset_at', 'resetAt', 'reset_time', 'resetTime'];
  for (const key of absoluteKeys) {
    const raw = data[key];
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const truncated = raw.replace(/(\.\d{6})\d+/, '$1');
        const date = new Date(truncated);
        if (Number.isNaN(date.getTime())) continue;
        const now = Date.now();
        const delta = date.getTime() - now;
        if (delta <= 0) return undefined;
        const totalMinutes = Math.floor(delta / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
        if (hours > 0) return `${hours}h`;
        if (minutes > 0) return `${minutes}m`;
        return '<1m';
      } catch {
        continue;
      }
    }
  }

  const relativeKeys = ['reset_in', 'resetIn', 'ttl'];
  for (const key of relativeKeys) {
    const raw = toInt(data[key]);
    if (raw !== null && raw > 0) {
      const hours = Math.floor(raw / 3600);
      const minutes = Math.floor((raw % 3600) / 60);
      if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
      if (hours > 0) return `${hours}h`;
      if (minutes > 0) return `${minutes}m`;
      return '<1m';
    }
  }

  return undefined;
}

function kimiDurationToken(duration: number, rawTimeUnit: unknown): string {
  const unit = typeof rawTimeUnit === 'string' ? rawTimeUnit.trim().toUpperCase() : '';
  if (unit === 'SECONDS' || unit === 'SECOND') return `${duration}s`;
  if (!unit || unit === 'MINUTES' || unit === 'MINUTE') {
    return duration % 60 === 0 ? `${duration / 60}h` : `${duration}m`;
  }
  if (unit === 'HOURS' || unit === 'HOUR') return `${duration}h`;
  if (unit === 'DAYS' || unit === 'DAY') return `${duration}d`;
  return duration % 60 === 0 ? `${duration / 60}h` : `${duration}m`;
}

function kimiLimitLabel(
  item: KimiLimitItem,
  detail: KimiUsageDetail | KimiLimitItem,
  window: KimiLimitWindow,
  index: number
): KimiRowLabel {
  for (const key of ['name', 'title', 'scope'] as const) {
    const val = (item as Record<string, unknown>)[key] ?? (detail as Record<string, unknown>)[key];
    if (typeof val === 'string' && val.trim()) return { label: val.trim() };
  }

  const duration =
    toInt(window.duration) ??
    toInt((item as Record<string, unknown>).duration) ??
    toInt((detail as Record<string, unknown>).duration);
  const timeUnit =
    (window as Record<string, unknown>).timeUnit ??
    (item as Record<string, unknown>).timeUnit ??
    (detail as Record<string, unknown>).timeUnit;

  if (duration !== null && duration > 0) {
    return {
      labelKey: 'kimi_quota.limit_window',
      labelParams: {
        duration: kimiDurationToken(duration, timeUnit),
      },
    };
  }

  return {
    labelKey: 'kimi_quota.limit_index',
    labelParams: {
      index: index + 1,
    },
  };
}

function toKimiUsageRow(
  data: Record<string, unknown>,
  fallbackLabel: KimiRowLabel
): (KimiRowLabel & { used: number; limit: number; resetHint?: string }) | null {
  const limit = toInt(data.limit);
  let used = toInt(data.used);
  if (used === null) {
    const remaining = toInt(data.remaining);
    if (remaining !== null && limit !== null) {
      used = limit - remaining;
    }
  }
  if (used === null && limit === null) return null;
  const explicitLabel =
    (typeof data.name === 'string' && data.name.trim()) ||
    (typeof data.title === 'string' && data.title.trim());
  const label = explicitLabel ? { label: explicitLabel } : fallbackLabel;
  return {
    ...label,
    used: used ?? 0,
    limit: limit ?? 0,
    resetHint: kimiResetHint(data),
  };
}

export function buildKimiQuotaRows(payload: KimiUsagePayload): KimiQuotaRow[] {
  const rows: KimiQuotaRow[] = [];

  const usage = payload.usage;
  if (usage && typeof usage === 'object') {
    const summary = toKimiUsageRow(usage as Record<string, unknown>, {
      labelKey: 'kimi_quota.weekly_limit',
    });
    if (summary) {
      rows.push({ id: 'summary', ...summary });
    }
  }

  const limits = payload.limits;
  if (Array.isArray(limits)) {
    limits.forEach((item, idx) => {
      const detail = (item.detail && typeof item.detail === 'object' ? item.detail : item) as KimiUsageDetail | KimiLimitItem;
      const window = (item.window && typeof item.window === 'object' ? item.window : {}) as KimiLimitWindow;
      const fallbackLabel = kimiLimitLabel(item, detail, window, idx);
      const row = toKimiUsageRow(detail as Record<string, unknown>, fallbackLabel);
      if (row) {
        rows.push({ id: `limit-${idx}`, ...row });
      }
    });
  }

  return rows;
}
