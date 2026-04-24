import { useEffect, useMemo, useState } from 'react';
import type { ChartOptions } from 'chart.js';
import { buildChartOptions } from '@/utils/usage/chartConfig';
import { buildAggregateChartData } from '@/utils/usageAggregate';
import type { ChartData } from '@/utils/usage';
import type { UsageAggregateWindow } from '@/types/usageAggregate';

export interface UseUsageAggregateChartDataOptions {
  window: UsageAggregateWindow | null;
  chartLines: string[];
  isDark: boolean;
  isMobile: boolean;
  preferredPeriod?: 'hour' | 'day';
  allModelsLabel?: string;
}

export interface UseUsageAggregateChartDataReturn {
  requestsPeriod: 'hour' | 'day';
  setRequestsPeriod: (period: 'hour' | 'day') => void;
  tokensPeriod: 'hour' | 'day';
  setTokensPeriod: (period: 'hour' | 'day') => void;
  requestsChartData: ChartData;
  tokensChartData: ChartData;
  requestsChartOptions: ChartOptions<'line'>;
  tokensChartOptions: ChartOptions<'line'>;
}

const relabelAllModels = (chartData: ChartData, allModelsLabel?: string): ChartData => {
  if (!allModelsLabel) {
    return chartData;
  }

  return {
    ...chartData,
    datasets: chartData.datasets.map((dataset) =>
      dataset.label === 'All Models' ? { ...dataset, label: allModelsLabel } : dataset
    )
  };
};

export function useUsageAggregateChartData({
  window,
  chartLines,
  isDark,
  isMobile,
  preferredPeriod = 'day',
  allModelsLabel
}: UseUsageAggregateChartDataOptions): UseUsageAggregateChartDataReturn {
  const [requestsPeriod, setRequestsPeriod] = useState<'hour' | 'day'>(preferredPeriod);
  const [tokensPeriod, setTokensPeriod] = useState<'hour' | 'day'>(preferredPeriod);

  useEffect(() => {
    setRequestsPeriod(preferredPeriod);
    setTokensPeriod(preferredPeriod);
  }, [preferredPeriod]);

  const requestsChartData = useMemo(() => {
    const chartData = buildAggregateChartData(window, requestsPeriod, 'requests', chartLines);
    return relabelAllModels(chartData, allModelsLabel);
  }, [allModelsLabel, chartLines, requestsPeriod, window]);

  const tokensChartData = useMemo(() => {
    const chartData = buildAggregateChartData(window, tokensPeriod, 'tokens', chartLines);
    return relabelAllModels(chartData, allModelsLabel);
  }, [allModelsLabel, chartLines, tokensPeriod, window]);

  const requestsChartOptions = useMemo(
    () =>
      buildChartOptions({
        period: requestsPeriod,
        labels: requestsChartData.labels,
        isDark,
        isMobile
      }),
    [isDark, isMobile, requestsChartData.labels, requestsPeriod]
  );

  const tokensChartOptions = useMemo(
    () =>
      buildChartOptions({
        period: tokensPeriod,
        labels: tokensChartData.labels,
        isDark,
        isMobile
      }),
    [isDark, isMobile, tokensChartData.labels, tokensPeriod]
  );

  return {
    requestsPeriod,
    setRequestsPeriod,
    tokensPeriod,
    setTokensPeriod,
    requestsChartData,
    tokensChartData,
    requestsChartOptions,
    tokensChartOptions
  };
}
