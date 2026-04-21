import { useEffect, useMemo, useState } from 'react';
import type { ChartOptions } from 'chart.js';
import { buildChartData, type ChartData } from '@/utils/usage';
import { buildChartOptions } from '@/utils/usage/chartConfig';
import type { UsagePayload } from './useUsageData';

export interface UseChartDataOptions {
  usage: UsagePayload | null;
  chartLines: string[];
  isDark: boolean;
  isMobile: boolean;
  hourWindowHours?: number;
  preferredPeriod?: 'hour' | 'day';
  allModelsLabel?: string;
}

export interface UseChartDataReturn {
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
    ),
  };
};

export function useChartData({
  usage,
  chartLines,
  isDark,
  isMobile,
  hourWindowHours,
  preferredPeriod = 'day',
  allModelsLabel,
}: UseChartDataOptions): UseChartDataReturn {
  const [requestsPeriod, setRequestsPeriod] = useState<'hour' | 'day'>(preferredPeriod);
  const [tokensPeriod, setTokensPeriod] = useState<'hour' | 'day'>(preferredPeriod);

  useEffect(() => {
    setRequestsPeriod(preferredPeriod);
    setTokensPeriod(preferredPeriod);
  }, [preferredPeriod]);

  const requestsChartData = useMemo(() => {
    if (!usage) {
      return { labels: [], datasets: [] };
    }

    const chartData = buildChartData(usage, requestsPeriod, 'requests', chartLines, {
      hourWindowHours,
    });
    return relabelAllModels(chartData, allModelsLabel);
  }, [allModelsLabel, chartLines, hourWindowHours, requestsPeriod, usage]);

  const tokensChartData = useMemo(() => {
    if (!usage) {
      return { labels: [], datasets: [] };
    }

    const chartData = buildChartData(usage, tokensPeriod, 'tokens', chartLines, {
      hourWindowHours,
    });
    return relabelAllModels(chartData, allModelsLabel);
  }, [allModelsLabel, chartLines, hourWindowHours, tokensPeriod, usage]);

  const requestsChartOptions = useMemo(
    () =>
      buildChartOptions({
        period: requestsPeriod,
        labels: requestsChartData.labels,
        isDark,
        isMobile,
      }),
    [requestsPeriod, requestsChartData.labels, isDark, isMobile]
  );

  const tokensChartOptions = useMemo(
    () =>
      buildChartOptions({
        period: tokensPeriod,
        labels: tokensChartData.labels,
        isDark,
        isMobile,
      }),
    [tokensPeriod, tokensChartData.labels, isDark, isMobile]
  );

  return {
    requestsPeriod,
    setRequestsPeriod,
    tokensPeriod,
    setTokensPeriod,
    requestsChartData,
    tokensChartData,
    requestsChartOptions,
    tokensChartOptions,
  };
}
