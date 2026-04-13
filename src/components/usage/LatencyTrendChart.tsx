import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ScriptableContext } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  buildHourlyLatencySeries,
  buildDailyLatencySeries,
  formatLatencyMs
} from '@/utils/usage';
import { buildChartOptions, getHourChartMinWidth } from '@/utils/usage/chartConfig';
import type { UsagePayload } from './hooks/useUsageData';
import styles from '@/pages/UsagePage.module.scss';

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

export function LatencyTrendChart({
  usage,
  loading,
  isDark,
  isMobile,
  hourWindowHours
}: LatencyTrendChartProps) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<'hour' | 'day'>('hour');

  const { chartData, chartOptions, hasData, summary } = useMemo(() => {
    if (!usage) {
      return {
        chartData: { labels: [], datasets: [] },
        chartOptions: {},
        hasData: false,
        summary: { latest: 0, peak: 0, average: 0 }
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
          spanGaps: false
        }
      ]
    };

    const baseOptions = buildChartOptions({ period, labels: series.labels, isDark, isMobile });
    const options = {
      ...baseOptions,
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales?.y,
          ticks: {
            ...(baseOptions.scales?.y && 'ticks' in baseOptions.scales.y ? baseOptions.scales.y.ticks : {}),
            callback: (value: string | number) => formatLatencyMs(Number(value))
          }
        }
      }
    };

    return {
      chartData: data,
      chartOptions: options,
      hasData: series.hasData,
      summary: { latest, peak, average }
    };
  }, [hourWindowHours, isDark, isMobile, period, t, usage]);

  const summaryItems = [
    { label: t('usage_stats.chart_latest'), value: formatLatencyMs(summary.latest) },
    { label: t('usage_stats.chart_peak'), value: formatLatencyMs(summary.peak) },
    { label: t('usage_stats.avg_latency'), value: formatLatencyMs(summary.average) }
  ];

  return (
    <Card
      className={`${styles.chartCard} ${styles.secondaryChartCard}`}
      title={t('usage_stats.latency_trend')}
      extra={
        <div className={styles.periodButtons}>
          <Button
            variant={period === 'hour' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPeriod('hour')}
          >
            {t('usage_stats.by_hour')}
          </Button>
          <Button
            variant={period === 'day' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPeriod('day')}
          >
            {t('usage_stats.by_day')}
          </Button>
        </div>
      }
    >
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : !hasData ? (
        <div className={styles.hint}>{t('usage_stats.latency_no_data')}</div>
      ) : (
        <div className={styles.chartWrapper}>
          <div className={styles.chartSummaryRow}>
            {summaryItems.map((item) => (
              <div key={item.label} className={styles.chartSummaryPill}>
                <span className={styles.chartSummaryLabel}>{item.label}</span>
                <span className={styles.chartSummaryValue}>{item.value}</span>
              </div>
            ))}
          </div>
          <div className={styles.chartArea}>
            <div className={styles.chartScroller}>
              <div
                className={styles.chartCanvas}
                style={
                  period === 'hour'
                    ? { minWidth: getHourChartMinWidth(chartData.labels.length, isMobile) }
                    : undefined
                }
              >
                <Line data={chartData} options={chartOptions} />
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
