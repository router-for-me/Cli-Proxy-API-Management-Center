import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  formatCompactNumber,
  type TokenCategory
} from '@/utils/usage';
import { buildAggregateTokenBreakdown } from '@/utils/usageAggregate';
import { buildChartOptions } from '@/utils/usage/chartConfig';
import { getAdaptiveAnalysisChartPeriod } from './chartPeriod';
import { UsageChartPanel } from './UsageChartPanel';
import type { UsageAggregateWindow } from '@/types/usageAggregate';

const TOKEN_COLORS: Record<TokenCategory, { border: string; bg: string }> = {
  input: { border: '#8b8680', bg: 'rgba(139, 134, 128, 0.25)' },
  output: { border: '#22c55e', bg: 'rgba(34, 197, 94, 0.25)' },
  cached: { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.25)' },
  reasoning: { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.25)' },
};

const CATEGORIES: TokenCategory[] = ['input', 'output', 'cached', 'reasoning'];

export interface TokenBreakdownChartProps {
  window: UsageAggregateWindow | null;
  loading: boolean;
  isDark: boolean;
  isMobile: boolean;
  hourWindowHours?: number;
}

export const TokenBreakdownChart = memo(function TokenBreakdownChart({
  window,
  loading,
  isDark,
  isMobile,
  hourWindowHours,
}: TokenBreakdownChartProps) {
  const { t } = useTranslation();
  const preferredPeriod = getAdaptiveAnalysisChartPeriod(hourWindowHours);
  const [period, setPeriod] = useState<'hour' | 'day'>(preferredPeriod);

  useEffect(() => {
    setPeriod(preferredPeriod);
  }, [preferredPeriod]);

  const { chartData, chartOptions, hasData, summaryItems } = useMemo(() => {
    const series = buildAggregateTokenBreakdown(window, period);
    const categoryLabels: Record<TokenCategory, string> = {
      input: t('usage_stats.input_tokens'),
      output: t('usage_stats.output_tokens'),
      cached: t('usage_stats.cached_tokens'),
      reasoning: t('usage_stats.reasoning_tokens'),
    };

    const data = {
      labels: series.labels,
      datasets: CATEGORIES.map((cat) => ({
        label: categoryLabels[cat],
        data: series.dataByCategory[cat],
        borderColor: TOKEN_COLORS[cat].border,
        backgroundColor: TOKEN_COLORS[cat].bg,
        pointBackgroundColor: TOKEN_COLORS[cat].border,
        pointBorderColor: TOKEN_COLORS[cat].border,
        fill: true,
        tension: 0.35,
      })),
    };

    const baseOptions = buildChartOptions({ period, labels: series.labels, isDark, isMobile });
    const options = {
      ...baseOptions,
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales?.y,
          stacked: true,
        },
        x: {
          ...baseOptions.scales?.x,
          stacked: true,
        },
      },
    };

    const totals = CATEGORIES.reduce(
      (acc, category) => ({
        ...acc,
        [category]: series.dataByCategory[category].reduce((sum, value) => sum + value, 0),
      }),
      { input: 0, output: 0, cached: 0, reasoning: 0 } as Record<TokenCategory, number>
    );

    return {
      chartData: data,
      chartOptions: options,
      hasData: series.hasData,
      summaryItems: [
        { label: t('usage_stats.input_tokens'), value: formatCompactNumber(totals.input) },
        { label: t('usage_stats.output_tokens'), value: formatCompactNumber(totals.output) },
        { label: t('usage_stats.cached_tokens'), value: formatCompactNumber(totals.cached) },
      ]
    };
  }, [isDark, isMobile, period, t, window]);

  return (
    <UsageChartPanel
      title={t('usage_stats.token_breakdown')}
      period={period}
      onPeriodChange={setPeriod}
      chartData={chartData}
      chartOptions={chartOptions}
      loading={loading}
      isMobile={isMobile}
      emptyText={t('usage_stats.no_data')}
      summaryItems={summaryItems}
      tone="violet"
      hasData={hasData}
    />
  );
});

TokenBreakdownChart.displayName = 'TokenBreakdownChart';
