import { useCallback, useMemo } from 'react';
import { buildAggregateSparklines } from '@/utils/usageAggregate';
import type { UsageAggregateWindow } from '@/types/usageAggregate';
import type { SparklineBundle } from './useSparklines';

export interface UseUsageAggregateSparklinesOptions {
  window: UsageAggregateWindow | null;
  loading: boolean;
}

export interface UseUsageAggregateSparklinesReturn {
  requestsSparkline: SparklineBundle | null;
  tokensSparkline: SparklineBundle | null;
  rpmSparkline: SparklineBundle | null;
  tpmSparkline: SparklineBundle | null;
  costSparkline: SparklineBundle | null;
}

export function useUsageAggregateSparklines({
  window,
  loading
}: UseUsageAggregateSparklinesOptions): UseUsageAggregateSparklinesReturn {
  const sparklineSeries = useMemo(() => buildAggregateSparklines(window), [window]);

  const buildSparkline = useCallback(
    (
      series: { labels: string[]; data: number[] },
      color: string,
      backgroundColor: string
    ): SparklineBundle | null => {
      if (loading || !series.data.length || !series.data.some((value) => value > 0)) {
        return null;
      }

      return {
        data: {
          labels: series.labels,
          datasets: [
            {
              data: series.data,
              borderColor: color,
              backgroundColor,
              fill: true,
              tension: 0.45,
              pointRadius: 0,
              borderWidth: 2
            }
          ]
        }
      };
    },
    [loading]
  );

  const requestsSparkline = useMemo(
    () =>
      buildSparkline(
        { labels: sparklineSeries.labels, data: sparklineSeries.requests },
        '#8b8680',
        'rgba(139, 134, 128, 0.18)'
      ),
    [buildSparkline, sparklineSeries.labels, sparklineSeries.requests]
  );

  const tokensSparkline = useMemo(
    () =>
      buildSparkline(
        { labels: sparklineSeries.labels, data: sparklineSeries.tokens },
        '#8b5cf6',
        'rgba(139, 92, 246, 0.18)'
      ),
    [buildSparkline, sparklineSeries.labels, sparklineSeries.tokens]
  );

  const rpmSparkline = useMemo(
    () =>
      buildSparkline(
        { labels: sparklineSeries.labels, data: sparklineSeries.requests },
        '#22c55e',
        'rgba(34, 197, 94, 0.18)'
      ),
    [buildSparkline, sparklineSeries.labels, sparklineSeries.requests]
  );

  const tpmSparkline = useMemo(
    () =>
      buildSparkline(
        { labels: sparklineSeries.labels, data: sparklineSeries.tokens },
        '#f97316',
        'rgba(249, 115, 22, 0.18)'
      ),
    [buildSparkline, sparklineSeries.labels, sparklineSeries.tokens]
  );

  const costSparkline = useMemo(
    () =>
      buildSparkline(
        { labels: sparklineSeries.labels, data: sparklineSeries.tokens },
        '#f59e0b',
        'rgba(245, 158, 11, 0.18)'
      ),
    [buildSparkline, sparklineSeries.labels, sparklineSeries.tokens]
  );

  return {
    requestsSparkline,
    tokensSparkline,
    rpmSparkline,
    tpmSparkline,
    costSparkline
  };
}
