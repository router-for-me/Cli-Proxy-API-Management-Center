import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartData } from '@/utils/usage';
import type { ChartOptions } from 'chart.js';
import {
  UsageChartPanel,
  type UsageChartSummaryItem,
  type UsageChartTone,
} from './UsageChartPanel';

export interface UsageChartProps {
  title: string;
  period: 'hour' | 'day';
  onPeriodChange: (period: 'hour' | 'day') => void;
  chartData: ChartData;
  chartOptions: ChartOptions<'line'>;
  loading: boolean;
  isMobile: boolean;
  emptyText: string;
  tone?: UsageChartTone;
}

export const UsageChart = memo(function UsageChart({
  title,
  period,
  onPeriodChange,
  chartData,
  chartOptions,
  loading,
  isMobile,
  emptyText,
  tone = 'neutral',
}: UsageChartProps) {
  const { t } = useTranslation();
  const summaryItems: UsageChartSummaryItem[] = [
    { label: t('usage_stats.chart_series'), value: chartData.datasets.length.toString() },
    { label: t('usage_stats.chart_points'), value: chartData.labels.length.toString() },
    {
      label: t('usage_stats.chart_view'),
      value: period === 'hour' ? t('usage_stats.by_hour') : t('usage_stats.by_day'),
    },
  ];

  return (
    <UsageChartPanel
      title={title}
      period={period}
      onPeriodChange={onPeriodChange}
      chartData={chartData}
      chartOptions={chartOptions}
      loading={loading}
      isMobile={isMobile}
      emptyText={emptyText}
      summaryItems={summaryItems}
      tone={tone}
    />
  );
});

UsageChart.displayName = 'UsageChart';
