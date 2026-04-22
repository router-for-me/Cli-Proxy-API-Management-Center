import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScriptableContext } from 'chart.js';
import { buildHourlyLatencySeries, buildDailyLatencySeries, formatLatencyMs } from '@/utils/usage';
import { buildChartOptions } from '@/utils/usage/chartConfig';
import type { UsagePayload } from './hooks/useUsageData';
import { getAdaptiveAnalysisChartPeriod } from './chartPeriod';
import { UsageChartPanel } from './UsageChartPanel';

export interface LatencyTrendChartProps {
  usage: UsagePayload | null;
  loading: boolean;
  isDark: boolean;
  isMobile: boolean;
  hourWindowHours?: number;
}

const LATENCY_COLOR = '#0f766e';
const LATENCY_BG = 'rgba(15, 118, 110, 0.16)';
const isNonNegativeNumber = (value: number | null): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

function buildGradient(ctx: ScriptableContext<'line'>) {
  const chart = ctx.chart;
  const area = chart.chartArea;
  if (!area) return LATENCY_BG;
  const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, 'rgba(15, 118, 110, 0.3)');
  gradient.addColorStop(0.6, 'rgba(15, 118, 110, 0.12)');
  gradient.addColorStop(1, 'rgba(15, 118, 110, 0.02)');
  return gradient;
}

export const LatencyTrendChart = memo(function LatencyTrendChart({
  usage,
  loading,
  isDark,
  isMobile,
  hourWindowHours,
}: LatencyTrendChartProps) {
  const { t } = useTranslation();
  const preferredPeriod = getAdaptiveAnalysisChartPeriod(hourWindowHours);
  const [period, setPeriod] = useState<'hour' | 'day'>(preferredPeriod);

  useEffect(() => {
    setPeriod(preferredPeriod);
  }, [preferredPeriod]);

  const { chartData, chartOptions, hasData, summary } = useMemo(() => {
    if (!usage) {
      return {
        chartData: { labels: [], datasets: [] },
        chartOptions: {},
        hasData: false,
        summary: { latest: 0, peak: 0, average: 0 },
      };
    }

    const series =
      period === 'hour'
        ? buildHourlyLatencySeries(usage, hourWindowHours)
        : buildDailyLatencySeries(usage);
    const values = series.data.filter(isNonNegativeNumber);
    const latest = values.length ? values[values.length - 1] : 0;
    const peak = values.length ? Math.max(...values) : 0;
    const average = values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : 0;

    const data = {
      labels: series.labels,
      datasets: [
        {
          label: t('usage_stats.avg_latency'),
          data: series.data,
          borderColor: LATENCY_COLOR,
          backgroundColor: buildGradient,
          pointBackgroundColor: LATENCY_COLOR,
          pointBorderColor: LATENCY_COLOR,
          fill: true,
          tension: 0.35,
          spanGaps: true,
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
            callback: (value: string | number) => formatLatencyMs(Number(value)),
          },
        },
      },
    };

    return {
      chartData: data,
      chartOptions: options,
      hasData: series.hasData,
      summary: { latest, peak, average },
    };
  }, [hourWindowHours, isDark, isMobile, period, t, usage]);

  const summaryItems = [
    { label: t('usage_stats.chart_latest'), value: formatLatencyMs(summary.latest) },
    { label: t('usage_stats.chart_peak'), value: formatLatencyMs(summary.peak) },
    { label: t('usage_stats.avg_latency'), value: formatLatencyMs(summary.average) },
  ];

  return (
    <UsageChartPanel
      title={t('usage_stats.latency_trend')}
      period={period}
      onPeriodChange={setPeriod}
      chartData={chartData}
      chartOptions={chartOptions}
      loading={loading}
      isMobile={isMobile}
      emptyText={t('usage_stats.latency_no_data')}
      summaryItems={summaryItems}
      tone="success"
      hasData={hasData}
    />
  );
});

LatencyTrendChart.displayName = 'LatencyTrendChart';
