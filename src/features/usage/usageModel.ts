/**
 * Pure helpers behind the API key usage page: period slots in server local time,
 * stable model → color slots, trend buckets and totals. No React here so it stays testable.
 */
import type {
  ApiKeyModelUsage,
  ApiKeyPolicyUsage,
  ApiKeyStatsWindow,
} from '@/services/api/apiKeyPolicyUsage';

export type UsageMetric = 'tokens' | 'requests' | 'cost';
/** Metrics a trend can be built for; `failed` feeds the error-rate sparkline. */
export type TrendMetric = UsageMetric | 'failed';

/** Categorical series slots available for models; the rest fold into "other". */
export const SERIES_SLOTS = 7;
export const OTHER_SERIES = '__other__';
/** Days shown in the trend chart for the all-time period. */
export const TOTAL_TREND_DAYS = 30;

export interface ServerCalendar {
  /** Server-local today, `YYYY-MM-DD`. */
  today: string;
  weekStart: string;
  monthStart: string;
  /** Exclusive end of the current month, `YYYY-MM-DD`. */
  monthEnd: string;
  /** Server-local current hour, `YYYY-MM-DDTHH`, or null when the offset is unknown. */
  nowHour: string | null;
}

export interface TrendSlot {
  key: string;
  /** Short axis label. */
  label: string;
  /** Longer label for tooltips. */
  title: string;
  /** Series id → metric value. */
  values: Map<string, number>;
  total: number;
  /** Slots after the server's current time; drawn empty, not as zero usage. */
  future: boolean;
}

export interface UsageTotals {
  requests: number;
  failed: number;
  tokens: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cost: number;
  /** Requests refused by key policies; not part of `requests`. */
  rejected: number;
}

const DAY_MS = 86_400_000;

const toUtc = (date: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date: string, days: number): string => {
  const ms = toUtc(date);
  return ms === null ? date : fromUtc(ms + days * DAY_MS);
};

const addMonths = (date: string, months: number): string => {
  const ms = toUtc(date);
  if (ms === null) return date;
  const d = new Date(ms);
  return fromUtc(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
};

/**
 * Derives the server's calendar from the window reset times the backend reports, so
 * charts follow server local time even when the browser sits in another time zone.
 */
export function serverCalendar(
  entries: ApiKeyPolicyUsage[],
  nowMs: number = Date.now()
): ServerCalendar | null {
  for (const entry of entries) {
    const { day, week, month } = entry.usage;
    if (!day.resetAt || !week.resetAt || !month.resetAt) continue;
    const today = addDays(day.resetAt.slice(0, 10), -1);
    const monthEnd = month.resetAt.slice(0, 10);
    return {
      today,
      weekStart: addDays(week.resetAt.slice(0, 10), -7),
      monthStart: addMonths(monthEnd, -1),
      monthEnd,
      nowHour: serverHour(day.resetAt, nowMs),
    };
  }
  return null;
}

/** Server-local `YYYY-MM-DDTHH` for nowMs, using the UTC offset of an RFC 3339 timestamp. */
function serverHour(rfc3339: string, nowMs: number): string | null {
  const match = /(Z|([+-])(\d{2}):(\d{2}))$/.exec(rfc3339);
  if (!match) return null;
  const offsetMin =
    match[1] === 'Z' ? 0 : (match[2] === '-' ? -1 : 1) * (Number(match[3]) * 60 + Number(match[4]));
  return new Date(nowMs + offsetMin * 60_000).toISOString().slice(0, 13);
}

/** Folds a model into its series id: its own name inside the slots, else "other". */
export function seriesOf(model: string, slots: Map<string, number>): string {
  return slots.has(model) ? model : OTHER_SERIES;
}

/**
 * Assigns color slots by all-time token use across every key, so a model keeps its
 * color whichever key or period is selected (color follows the entity, not its rank).
 */
export function modelColorSlots(entries: ApiKeyPolicyUsage[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    for (const row of entry.usage.total.models) {
      totals.set(row.model, (totals.get(row.model) ?? 0) + row.tokens + row.requests * 1e-6);
    }
    // Models seen only in history (e.g. before the total window existed).
    for (const bucket of entry.daily) {
      for (const row of bucket.models) {
        if (!totals.has(row.model)) totals.set(row.model, row.tokens * 1e-3);
      }
    }
  }
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const slots = new Map<string, number>();
  ranked.slice(0, SERIES_SLOTS).forEach(([model], index) => slots.set(model, index));
  return slots;
}

export const metricValue = (row: ApiKeyModelUsage, metric: TrendMetric): number => {
  switch (metric) {
    case 'tokens':
      return row.tokens;
    case 'requests':
      return row.requests;
    case 'failed':
      return row.failed;
    default:
      return row.cost;
  }
};

const pad2 = (n: number) => String(n).padStart(2, '0');

interface SlotSpec {
  key: string;
  label: string;
  title: string;
  future: boolean;
}

function slotSpecs(period: ApiKeyStatsWindow, cal: ServerCalendar, locale: string): SlotSpec[] {
  const dayTitle = (date: string) => {
    const ms = toUtc(date);
    if (ms === null) return date;
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    }).format(new Date(ms));
  };
  const dayLabel = (date: string, withWeekday: boolean) => {
    const ms = toUtc(date);
    if (ms === null) return date;
    return new Intl.DateTimeFormat(
      locale,
      withWeekday
        ? { weekday: 'short', timeZone: 'UTC' }
        : { day: 'numeric', month: 'numeric', timeZone: 'UTC' }
    ).format(new Date(ms));
  };

  if (period === 'day') {
    return Array.from({ length: 24 }, (_, hour) => {
      const key = `${cal.today}T${pad2(hour)}`;
      return {
        key,
        label: `${pad2(hour)}`,
        title: `${dayTitle(cal.today)} ${pad2(hour)}:00–${pad2(hour + 1 === 24 ? 0 : hour + 1)}:00`,
        future: cal.nowHour !== null && key > cal.nowHour,
      };
    });
  }

  let start: string;
  let count: number;
  if (period === 'week') {
    start = cal.weekStart;
    count = 7;
  } else if (period === 'month') {
    start = cal.monthStart;
    count = Math.round(((toUtc(cal.monthEnd) ?? 0) - (toUtc(cal.monthStart) ?? 0)) / DAY_MS);
  } else {
    start = addDays(cal.today, -(TOTAL_TREND_DAYS - 1));
    count = TOTAL_TREND_DAYS;
  }
  return Array.from({ length: Math.max(count, 0) }, (_, i) => {
    const key = addDays(start, i);
    return {
      key,
      label: dayLabel(key, period === 'week'),
      title: dayTitle(key),
      future: key > cal.today,
    };
  });
}

/** Builds stacked trend slots (series = models folded to the color slots). */
export function buildTrend(
  entries: ApiKeyPolicyUsage[],
  period: ApiKeyStatsWindow,
  cal: ServerCalendar,
  slots: Map<string, number>,
  metric: TrendMetric,
  locale: string
): TrendSlot[] {
  const specs = slotSpecs(period, cal, locale);
  const byKey = new Map<string, TrendSlot>(
    specs.map((spec) => [
      spec.key,
      {
        key: spec.key,
        label: spec.label,
        title: spec.title,
        values: new Map(),
        total: 0,
        future: spec.future,
      },
    ])
  );
  const hourly = period === 'day';
  for (const entry of entries) {
    for (const bucket of hourly ? entry.hourly : entry.daily) {
      const slot = byKey.get(bucket.time);
      if (!slot) continue;
      for (const row of bucket.models) {
        const value = metricValue(row, metric);
        if (value <= 0) continue;
        const series = seriesOf(row.model, slots);
        slot.values.set(series, (slot.values.get(series) ?? 0) + value);
        slot.total += value;
      }
    }
  }
  return specs.map((spec) => byKey.get(spec.key)!);
}

/** Sums model rows of the given keys for one window. */
export function sumTotals(entries: ApiKeyPolicyUsage[], window: ApiKeyStatsWindow): UsageTotals {
  const totals: UsageTotals = {
    requests: 0,
    failed: 0,
    tokens: 0,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cost: 0,
    rejected: 0,
  };
  for (const entry of entries) {
    const usage = entry.usage[window];
    totals.requests += usage.requests;
    totals.failed += usage.failed;
    totals.tokens += usage.tokens;
    totals.cost += usage.cost;
    totals.rejected += usage.rejected;
    for (const row of usage.models) {
      totals.inputTokens += row.inputTokens;
      totals.cachedTokens += row.cachedTokens;
      totals.outputTokens += row.outputTokens;
      totals.reasoningTokens += row.reasoningTokens;
    }
  }
  return totals;
}

export interface ShareRow {
  id: string;
  label: string;
  value: number;
  share: number;
}

/** Turns values into share rows, largest first, dropping zeros. */
export function toShareRows(
  items: Array<{ id: string; label: string; value: number }>
): ShareRow[] {
  const total = items.reduce((sum, item) => sum + Math.max(item.value, 0), 0);
  return items
    .filter((item) => item.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .map((item) => ({ ...item, share: total > 0 ? item.value / total : 0 }));
}

/** Assigns color slots to client keys by all-time token use, mirroring modelColorSlots. */
export function keyColorSlots(entries: ApiKeyPolicyUsage[]): Map<string, number> {
  const ranked = [...entries].sort(
    (a, b) =>
      b.usage.total.tokens - a.usage.total.tokens ||
      b.usage.total.requests - a.usage.total.requests ||
      a.key.localeCompare(b.key)
  );
  const slots = new Map<string, number>();
  ranked.slice(0, SERIES_SLOTS).forEach((entry, index) => slots.set(entry.key, index));
  return slots;
}

/** Per-slot totals of a trend, for sparklines; future slots are left out. */
export const trendPoints = (slots: TrendSlot[]): number[] =>
  slots.filter((slot) => !slot.future).map((slot) => slot.total);
