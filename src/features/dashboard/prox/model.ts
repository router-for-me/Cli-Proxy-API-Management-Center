/**
 * Dashboard model (fork): the traffic timeline and one row per account, built
 * from the credentials list, inline API-key usage and recorded quota history.
 *
 * React-free so it can be unit-tested.
 */

import type { QuotaHistory, QuotaHistoryAccount } from '@/services/api/quotaHistory';
import type { AuthFileItem } from '@/types/authFile';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { normalizeRecentRequestBuckets, type RecentRequestBucket } from '@/utils/recentRequests';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import { parseTimestampMs } from '@/utils/timestamp';

/** The backend keeps 20 buckets of 10 minutes, aligned to the Unix epoch. */
export const BUCKET_MS = 10 * 60 * 1000;

/** Mirrors the backend rule: a weekly reset less than 36 hours away is routed first. */
export const WEEKLY_RESET_STRATEGIES = ['weekly-reset-weighted-round-robin', 'weekly-reset-wrr'];
const PRIORITY_WINDOW_MS = 36 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

// ---------------------------------------------------------------- traffic

export type TrafficSource = { provider: string; buckets: RecentRequestBucket[] };

export type TrafficPoint = {
  /** Bucket start, epoch ms. */
  start: number;
  success: number;
  failed: number;
  total: number;
  byProvider: Record<string, number>;
};

export type Traffic = {
  points: TrafficPoint[];
  /** Providers with traffic, largest first: the stacking and legend order. */
  providers: string[];
  success: number;
  failed: number;
  total: number;
  /** 0..100, null without requests. */
  successRate: number | null;
};

const providerId = (value: unknown): string => {
  const id = String(value ?? '')
    .trim()
    .toLowerCase();
  return id && id !== 'empty' ? id : 'unknown';
};

export const credentialProvider = (file: AuthFileItem): string =>
  providerId(file.type ?? file.provider);

/**
 * Sums every source into one timeline. Sources are aligned on their newest
 * bucket, which is the current 10 minutes as of `serverNowMs`.
 */
export function buildTraffic(sources: TrafficSource[], serverNowMs: number): Traffic {
  const series = sources
    .map((source) => ({ ...source, buckets: normalizeRecentRequestBuckets(source.buckets) }))
    .filter((source) => source.buckets.length > 0);
  const length = Math.max(0, ...series.map((source) => source.buckets.length));
  const lastStart = Math.floor(serverNowMs / BUCKET_MS) * BUCKET_MS;
  const points: TrafficPoint[] = Array.from({ length }, (_, index) => ({
    start: lastStart - (length - 1 - index) * BUCKET_MS,
    success: 0,
    failed: 0,
    total: 0,
    byProvider: {},
  }));

  const providerTotals = new Map<string, number>();
  series.forEach((source) => {
    const offset = length - source.buckets.length;
    source.buckets.forEach((bucket, index) => {
      const point = points[offset + index];
      const count = bucket.success + bucket.failed;
      point.success += bucket.success;
      point.failed += bucket.failed;
      point.total += count;
      point.byProvider[source.provider] = (point.byProvider[source.provider] ?? 0) + count;
      providerTotals.set(source.provider, (providerTotals.get(source.provider) ?? 0) + count);
    });
  });

  const success = points.reduce((sum, point) => sum + point.success, 0);
  const failed = points.reduce((sum, point) => sum + point.failed, 0);
  const total = success + failed;
  const providers = [...providerTotals.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([provider]) => provider);

  return {
    points,
    providers,
    success,
    failed,
    total,
    successRate: total > 0 ? (success / total) * 100 : null,
  };
}

// ---------------------------------------------------------------- accounts

export type QuotaReading = {
  /** Used share of the window, 0..100. */
  used: number;
  resetAt: number | null;
  observedAt: number;
};

export type AccountStatus = 'serving' | 'cooling' | 'unavailable' | 'disabled' | 'error';

export type AccountRow = {
  key: string;
  provider: string;
  /** Email or label; masked by the view. */
  name: string;
  status: AccountStatus;
  /** When a cooldown or unavailability ends, epoch ms. */
  statusUntil: number | null;
  success: number;
  failed: number;
  total: number;
  fiveHour: QuotaReading | null;
  weekly: QuotaReading | null;
  /** Routed first by the weekly-reset strategy. */
  priority: boolean;
};

type Signals = Record<string, string>;

const readSignals = (quota: unknown): { signals: Signals; observedAt: number } | null => {
  if (!quota || typeof quota !== 'object') return null;
  const record = quota as { signals?: unknown; observed_at?: unknown };
  if (!record.signals || typeof record.signals !== 'object') return null;
  const signals: Signals = {};
  Object.entries(record.signals as Record<string, unknown>).forEach(([key, value]) => {
    if (typeof value === 'string' || typeof value === 'number') {
      signals[key.toLowerCase()] = String(value);
    }
  });
  const observedAt = parseTimestampMs(record.observed_at);
  return { signals, observedAt: Number.isFinite(observedAt) ? observedAt : 0 };
};

const num = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const epochSeconds = (value: string | undefined): number | null => {
  const seconds = num(value);
  return seconds !== null && seconds > 0 ? seconds * 1000 : null;
};

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

/**
 * Quota windows from the rate-limit headers the backend keeps per credential
 * (refreshed by every request through the proxy).
 */
export function signalReadings(
  provider: string,
  quota: unknown
): { fiveHour: QuotaReading | null; weekly: QuotaReading | null } {
  const parsed = readSignals(quota);
  if (!parsed) return { fiveHour: null, weekly: null };
  const { signals, observedAt } = parsed;

  if (provider === 'claude') {
    const read = (window: '5h' | '7d'): QuotaReading | null => {
      const utilization = num(signals[`anthropic-ratelimit-unified-${window}-utilization`]);
      if (utilization === null) return null;
      return {
        used: clampPercent(utilization * 100),
        resetAt: epochSeconds(signals[`anthropic-ratelimit-unified-${window}-reset`]),
        observedAt,
      };
    };
    return { fiveHour: read('5h'), weekly: read('7d') };
  }

  if (provider === 'codex') {
    // Image-generation responses describe their own limit, not the plan's quota.
    if ((signals['x-codex-active-limit'] ?? '').toLowerCase().startsWith('imagegen')) {
      return { fiveHour: null, weekly: null };
    }
    const windows: Record<number, QuotaReading> = {};
    (['primary', 'secondary'] as const).forEach((slot) => {
      const minutes = num(signals[`x-codex-${slot}-window-minutes`]);
      const used = num(signals[`x-codex-${slot}-used-percent`]);
      if (!minutes || used === null) return;
      const after = num(signals[`x-codex-${slot}-reset-after-seconds`]);
      windows[minutes] = {
        used: clampPercent(used),
        resetAt:
          epochSeconds(signals[`x-codex-${slot}-reset-at`]) ??
          (after !== null && observedAt ? observedAt + after * 1000 : null),
        observedAt,
      };
    });
    return { fiveHour: windows[300] ?? null, weekly: windows[10080] ?? null };
  }

  return { fiveHour: null, weekly: null };
}

/** The newest recorded sample of a history window. */
const historyReading = (
  account: QuotaHistoryAccount | undefined,
  windowId: string
): QuotaReading | null => {
  const points = account?.windows.find((window) => window.id === windowId)?.points;
  const latest = points?.[points.length - 1];
  return latest ? { used: latest.used, resetAt: latest.resetAt, observedAt: latest.t } : null;
};

const newest = (a: QuotaReading | null, b: QuotaReading | null): QuotaReading | null => {
  if (!a) return b;
  if (!b) return a;
  return b.observedAt > a.observedAt ? b : a;
};

/**
 * A reading whose reset has passed is empty again. A weekly window keeps its
 * cadence; a 5-hour window starts on the next request, so its reset is unknown.
 */
const settle = (
  reading: QuotaReading | null,
  nowMs: number,
  periodMs: number | null
): QuotaReading | null => {
  if (!reading || reading.resetAt === null || reading.resetAt > nowMs) return reading;
  const resetAt = periodMs
    ? reading.resetAt + Math.ceil((nowMs - reading.resetAt + 1) / periodMs) * periodMs
    : null;
  return { used: 0, resetAt, observedAt: reading.observedAt };
};

const historyFor = (
  history: QuotaHistory | null,
  file: AuthFileItem,
  provider: string
): QuotaHistoryAccount | undefined => {
  if (!history) return undefined;
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  return history.accounts.find(
    (account) =>
      account.provider === provider &&
      ((authIndex !== null && account.authIndex === authIndex) || account.fileName === file.name)
  );
};

const statusOf = (
  file: AuthFileItem,
  nowMs: number
): { status: AccountStatus; until: number | null } => {
  if (file.disabled) return { status: 'disabled', until: null };
  const snapshot = file.cooldownSnapshot;
  const credentialCooldowns = (snapshot?.records ?? [])
    .filter((record) => record.scope === 'credential')
    .map((record) => snapshot!.receivedAtMs + record.remainingSeconds * 1000)
    .filter((until) => until > nowMs);
  if (credentialCooldowns.length > 0) {
    return { status: 'cooling', until: Math.max(...credentialCooldowns) };
  }
  if (file.unavailable) {
    const retry = parseTimestampMs(file['next_retry_after']);
    return {
      status: 'unavailable',
      until: Number.isFinite(retry) && retry > nowMs ? retry : null,
    };
  }
  if (String(file.status ?? '').toLowerCase() === 'error') return { status: 'error', until: null };
  return { status: 'serving', until: null };
};

const accountName = (file: AuthFileItem): string => {
  const email = typeof file.email === 'string' ? file.email.trim() : '';
  if (email) return email;
  const label = typeof file['label'] === 'string' ? (file['label'] as string).trim() : '';
  return label || file.name;
};

/** Rows for every credential, grouped by provider, soonest weekly reset first. */
export function buildAccountRows(
  files: AuthFileItem[],
  history: QuotaHistory | null,
  routingStrategy: string,
  nowMs: number
): AccountRow[] {
  const priorityRouting = WEEKLY_RESET_STRATEGIES.includes(routingStrategy.trim());
  const rows = files.map((file): AccountRow => {
    const provider = credentialProvider(file);
    const signals = signalReadings(provider, file['quota']);
    const recorded = historyFor(history, file, provider);
    const fiveHour = settle(
      newest(signals.fiveHour, historyReading(recorded, 'five_hour')),
      nowMs,
      null
    );
    const weekly = settle(
      newest(signals.weekly, historyReading(recorded, 'seven_day')),
      nowMs,
      WEEK_MS
    );
    const { status, until } = statusOf(file, nowMs);
    const buckets = normalizeRecentRequestBuckets(file.recentRequests ?? file.recent_requests);
    const success = buckets.reduce((sum, bucket) => sum + bucket.success, 0);
    const failed = buckets.reduce((sum, bucket) => sum + bucket.failed, 0);
    const weeklyReset = weekly?.resetAt ?? null;
    return {
      key: `${file.name}|${file.authIndex ?? ''}`,
      provider,
      name: accountName(file),
      status,
      statusUntil: until,
      success,
      failed,
      total: success + failed,
      fiveHour,
      weekly,
      priority:
        priorityRouting &&
        status === 'serving' &&
        weeklyReset !== null &&
        weeklyReset > nowMs &&
        weeklyReset - nowMs < PRIORITY_WINDOW_MS,
    };
  });

  const providerOrder = (provider: string) =>
    provider === 'claude' ? 0 : provider === 'codex' ? 1 : 2;
  return rows.sort(
    (a, b) =>
      providerOrder(a.provider) - providerOrder(b.provider) ||
      a.provider.localeCompare(b.provider) ||
      (a.weekly?.resetAt ?? Infinity) - (b.weekly?.resetAt ?? Infinity) ||
      a.name.localeCompare(b.name)
  );
}
