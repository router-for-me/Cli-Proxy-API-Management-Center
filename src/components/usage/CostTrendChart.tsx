import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScriptableContext } from 'chart.js';
import { formatUsd, type ModelPrice } from '@/utils/usage';
import { buildAggregateCostTrend } from '@/utils/usageAggregate';
import { buildChartOptions } from '@/utils/usage/chartConfig';
import { getAdaptiveAnalysisChartPeriod } from './chartPeriod';
import { UsageChartPanel } from './UsageChartPanel';
import type { UsageAggregateWindow } from '@/types/usageAggregate';

export interface CostTrendChartProps {
  window: UsageAggregateWindow | null;
  loading: boolean;
  isDark: boolean;
  isMobile: boolean;
  modelPrices: Record<string, ModelPrice>;
  hourWindowHours?: number;
}

const COST_COLOR = '#f59e0b';
const COST_BG = 'rgba(245, 158, 11, 0.15)';

function buildGradient(ctx: ScriptableContext<'line'>) {
  const chart = ctx.chart;
  const area = chart.chartArea;
  if (!area) return COST_BG;
  const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, 'rgba(245, 158, 11, 0.28)');
  gradient.addColorStop(0.6, 'rgba(245, 158, 11, 0.12)');
  gradient.addColorStop(1, 'rgba(245, 158, 11, 0.02)');
  return gradient;
}

export const CostTrendChart = memo(function CostTrendChart({
  window,
  loading,
  isDark,
  isMobile,
  modelPrices,
  hourWindowHours,
}: CostTrendChartProps) {
  const { t } = useTranslation();
  const preferredPeriod = getAdaptiveAnalysisChartPeriod(hourWindowHours);
  const [period, setPeriod] = useState<'hour' | 'day'>(preferredPeriod);
  const hasPrices = Object.keys(modelPrices).length > 0;

  useEffect(() => {
    setPeriod(preferredPeriod);
  }, [preferredPeriod]);

  const { chartData, chartOptions, hasData, summaryItems } = useMemo(() => {
    if (!hasPrices || !window) {
      return {
        chartData: { labels: [], datasets: [] },
        chartOptions: {},
        hasData: false,
        summaryItems: []
      };
    }

    const series = buildAggregateCostTrend(window, modelPrices, period);

    const data = {
      labels: series.labels,
      datasets: [
        {
          label: t('usage_stats.total_cost'),
          data: series.data,
          borderColor: COST_COLOR,
          backgroundColor: buildGradient,
          pointBackgroundColor: COST_COLOR,
          pointBorderColor: COST_COLOR,
          fill: true,
          tension: 0.35,
        },
      ],
    };

    const baseOptions = buildChartOptions({ period, labels: series.labels, isDark, isMobile });
    const options = {
      ...baseOptions,
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales?.y,
          ticks: {
            ...(baseOptions.scales?.y && 'ticks' in baseOptions.scales.y
              ? baseOptions.scales.y.ticks
              : {}),
            callback: (value: string | number) => formatUsd(Number(value)),
          },
        },
      },
    };

    const latest = series.data.length ? series.data[series.data.length - 1] : 0;
    const peak = series.data.length ? Math.max(...series.data) : 0;

    return {
      chartData: data,
      chartOptions: options,
      hasData: series.hasData,
      summaryItems: [
        { label: t('usage_stats.chart_latest'), value: formatUsd(latest) },
        { label: t('usage_stats.chart_peak'), value: formatUsd(peak) },
        { label: t('usage_stats.chart_points'), value: series.labels.length.toString() }
      ]
    };
  }, [window, period, isDark, isMobile, modelPrices, hasPrices, t]);

  const emptyText = !hasPrices ? t('usage_stats.cost_need_price') : t('usage_stats.cost_no_data');

  return (
    <UsageChartPanel
      title={t('usage_stats.cost_trend')}
      period={period}
      onPeriodChange={setPeriod}
      chartData={chartData}
      chartOptions={chartOptions}
      loading={loading}
      isMobile={isMobile}
      emptyText={emptyText}
      summaryItems={summaryItems}
      tone="warning"
      hasData={hasPrices && hasData}
    />
  );
});

CostTrendChart.displayName = 'CostTrendChart';
