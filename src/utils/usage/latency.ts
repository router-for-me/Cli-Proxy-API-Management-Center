import i18n from '@/i18n';

export const LATENCY_SOURCE_FIELD = 'latency_ms';
export const LATENCY_SOURCE_UNIT = 'ms';

export interface LatencyStats {
  averageMs: number | null;
  totalMs: number | null;
  sampleCount: number;
}

export interface DurationFormatOptions {
  maxUnits?: number;
  invalidText?: string;
  secondDecimals?: number | 'auto';
  locale?: string;
}

export interface LatencyAccumulator {
  totalMs: number;
  sampleCount: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeDurationMaxUnits = (value: number | undefined): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 2;
  }
  return Math.min(Math.floor(parsed), 4);
};

const resolveSecondDecimalPlaces = (
  seconds: number,
  secondDecimals: number | 'auto' | undefined
): number => {
  if (secondDecimals === 'auto' || secondDecimals === undefined) {
    return seconds < 10 ? 2 : 1;
  }

  const parsed = Math.floor(Number(secondDecimals));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return seconds < 10 ? 2 : 1;
  }
  return Math.min(parsed, 3);
};

const resolveDurationLocale = (locale?: string): string | undefined =>
  locale?.trim() || i18n.resolvedLanguage || i18n.language || undefined;

const formatDurationNumber = (
  value: number,
  locale: string | undefined,
  options: Intl.NumberFormatOptions = {}
): string => {
  try {
    return new Intl.NumberFormat(locale, {
      useGrouping: false,
      ...options,
    }).format(value);
  } catch {
    return String(value);
  }
};

const getDurationUnitLabel = (unit: 'd' | 'h' | 'm' | 's' | 'ms'): string =>
  i18n.t(`usage_stats.duration_unit_${unit}`, { defaultValue: unit });

const formatDurationPart = (
  value: number,
  unit: 'd' | 'h' | 'm' | 's' | 'ms',
  locale: string | undefined,
  options: Intl.NumberFormatOptions = {}
): string => `${formatDurationNumber(value, locale, options)}${getDurationUnitLabel(unit)}`;

/**
 * 从后端字段 latency_ms 提取耗时，并按毫秒解释。
 */
export function extractLatencyMs(detail: unknown): number | null {
  const record = isRecord(detail) ? detail : null;
  const rawValue = record?.[LATENCY_SOURCE_FIELD];
  if (
    rawValue === null ||
    rawValue === undefined ||
    (typeof rawValue === 'string' && rawValue.trim() === '')
  ) {
    return null;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

export const createLatencyAccumulator = (): LatencyAccumulator => ({
  totalMs: 0,
  sampleCount: 0,
});

export const addLatencySample = (
  accumulator: LatencyAccumulator,
  latencyMs: number | null | undefined
): void => {
  if (latencyMs === null || latencyMs === undefined) {
    return;
  }

  const parsed = Number(latencyMs);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return;
  }

  accumulator.totalMs += parsed;
  accumulator.sampleCount += 1;
};

export const finalizeLatencyStats = (accumulator: LatencyAccumulator): LatencyStats => ({
  averageMs: accumulator.sampleCount > 0 ? accumulator.totalMs / accumulator.sampleCount : null,
  totalMs: accumulator.sampleCount > 0 ? accumulator.totalMs : null,
  sampleCount: accumulator.sampleCount,
});

/**
 * 从明细列表计算耗时统计
 */
export function calculateLatencyStatsFromDetails(details: Iterable<unknown>): LatencyStats {
  const accumulator = createLatencyAccumulator();
  for (const detail of details) {
    addLatencySample(accumulator, extractLatencyMs(detail));
  }
  return finalizeLatencyStats(accumulator);
}

/**
 * 按当前语言格式化耗时显示。
 */
export function formatDurationMs(
  value: number | null | undefined,
  options: DurationFormatOptions = {}
): string {
  const invalidText = options.invalidText ?? '--';
  if (value === null || value === undefined) {
    return invalidText;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return invalidText;
  }

  const locale = resolveDurationLocale(options.locale);

  if (parsed < 1000) {
    return formatDurationPart(Math.round(parsed), 'ms', locale);
  }

  const seconds = parsed / 1000;
  if (seconds < 60) {
    const secondDecimalPlaces = resolveSecondDecimalPlaces(seconds, options.secondDecimals);
    return formatDurationPart(seconds, 's', locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: secondDecimalPlaces,
    });
  }

  const totalSeconds = Math.floor(seconds);
  let remainingSeconds = totalSeconds;
  const days = Math.floor(remainingSeconds / 86_400);
  remainingSeconds -= days * 86_400;
  const hours = Math.floor(remainingSeconds / 3_600);
  remainingSeconds -= hours * 3_600;
  const minutes = Math.floor(remainingSeconds / 60);
  remainingSeconds -= minutes * 60;

  const parts = [
    { unit: 'd' as const, value: days },
    { unit: 'h' as const, value: hours },
    { unit: 'm' as const, value: minutes },
    { unit: 's' as const, value: remainingSeconds },
  ].filter((part) => part.value > 0);

  if (!parts.length) {
    return formatDurationPart(0, 's', locale);
  }

  return parts
    .slice(0, normalizeDurationMaxUnits(options.maxUnits))
    .map((part, index) =>
      formatDurationPart(part.value, part.unit, locale, {
        minimumIntegerDigits: index > 0 && (part.unit === 'm' || part.unit === 's') ? 2 : 1,
        maximumFractionDigits: 0,
      })
    )
    .join(' ');
}
