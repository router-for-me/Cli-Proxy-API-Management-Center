import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { type UsageTimeRange } from '@/utils/usage';
import { getAdaptiveChartPeriod } from '../chartPeriod';

const CHART_LINES_STORAGE_KEY = 'cli-proxy-usage-chart-lines-v1';
const TIME_RANGE_STORAGE_KEY = 'cli-proxy-usage-time-range-v1';
const DEFAULT_CHART_LINES = ['all'];
const DEFAULT_TIME_RANGE: UsageTimeRange = '3h';
export const MAX_USAGE_CHART_LINES = 5;

const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: UsageTimeRange; labelKey: string }> = [
  { value: 'all', labelKey: 'usage_stats.range_all' },
  { value: '3h', labelKey: 'usage_stats.range_3h' },
  { value: '6h', labelKey: 'usage_stats.range_6h' },
  { value: '12h', labelKey: 'usage_stats.range_12h' },
  { value: '24h', labelKey: 'usage_stats.range_24h' },
  { value: '7d', labelKey: 'usage_stats.range_7d' },
];

const HOUR_WINDOW_BY_TIME_RANGE: Record<Exclude<UsageTimeRange, 'all'>, number> = {
  '3h': 3,
  '6h': 6,
  '12h': 12,
  '24h': 24,
  '7d': 7 * 24,
};

const isUsageTimeRange = (value: unknown): value is UsageTimeRange =>
  value === '3h' ||
  value === '6h' ||
  value === '12h' ||
  value === '24h' ||
  value === '7d' ||
  value === 'all';

const normalizeChartLines = (value: unknown, maxLines: number): string[] => {
  if (!Array.isArray(value)) {
    return DEFAULT_CHART_LINES;
  }

  const filtered = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxLines);

  return filtered.length ? filtered : DEFAULT_CHART_LINES;
};

const loadChartLines = (maxLines: number): string[] => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_CHART_LINES;
    }

    const raw = localStorage.getItem(CHART_LINES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_CHART_LINES;
    }

    return normalizeChartLines(JSON.parse(raw), maxLines);
  } catch {
    return DEFAULT_CHART_LINES;
  }
};

const loadTimeRange = (): UsageTimeRange => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_TIME_RANGE;
    }

    const raw = localStorage.getItem(TIME_RANGE_STORAGE_KEY);
    return isUsageTimeRange(raw) ? raw : DEFAULT_TIME_RANGE;
  } catch {
    return DEFAULT_TIME_RANGE;
  }
};

const persistUsageViewValue = (key: string, value: string) => {
  try {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors.
  }
};

export function useUsageViewState(maxLines = MAX_USAGE_CHART_LINES) {
  const { t } = useTranslation();
  const [chartLines, setChartLines] = useState<string[]>(() => loadChartLines(maxLines));
  const [timeRange, setTimeRange] = useState<UsageTimeRange>(loadTimeRange);
  const deferredChartLines = useDeferredValue(chartLines);
  const deferredTimeRange = useDeferredValue(timeRange);
  const hourWindowHours =
    deferredTimeRange === 'all' ? undefined : HOUR_WINDOW_BY_TIME_RANGE[deferredTimeRange];

  const timeRangeOptions = useMemo(
    () =>
      TIME_RANGE_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
      })),
    [t]
  );

  const selectedRangeLabel = useMemo(
    () =>
      timeRangeOptions.find((option) => option.value === timeRange)?.label ??
      t('usage_stats.range_all'),
    [t, timeRange, timeRangeOptions]
  );

  const handleChartLinesChange = useCallback(
    (lines: string[]) => {
      startTransition(() => {
        setChartLines(normalizeChartLines(lines, maxLines));
      });
    },
    [maxLines]
  );

  const handleTimeRangeChange = useCallback((value: string) => {
    if (!isUsageTimeRange(value)) {
      return;
    }

    startTransition(() => {
      setTimeRange(value);
    });
  }, []);

  useEffect(() => {
    persistUsageViewValue(CHART_LINES_STORAGE_KEY, JSON.stringify(chartLines));
  }, [chartLines]);

  useEffect(() => {
    persistUsageViewValue(TIME_RANGE_STORAGE_KEY, timeRange);
  }, [timeRange]);

  return {
    chartLines,
    deferredChartLines,
    timeRange,
    deferredTimeRange,
    timeRangeOptions,
    selectedRangeLabel,
    hourWindowHours,
    preferredChartPeriod: getAdaptiveChartPeriod(hourWindowHours),
    handleChartLinesChange,
    handleTimeRangeChange,
  };
}
