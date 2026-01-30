import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useThemeStore } from '@/stores';
import type { KeyUsageStat, TimePeriodFilter } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

// Register Chart.js components
ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip, Legend, Filler
);

const CHART_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'
];

export interface KeyUsageChartsProps {
  keyUsageStats: KeyUsageStat[];
  loading: boolean;
  period: TimePeriodFilter;
  onPeriodChange: (period: TimePeriodFilter) => void;
}

export function KeyUsageCharts({ keyUsageStats, loading, period, onPeriodChange }: KeyUsageChartsProps) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = resolvedTheme === 'dark';

  const chartData = useMemo(() => {
    const labels = keyUsageStats.map(s => s.displayName);
    const requests = keyUsageStats.map(s => s.totalRequests);
    const tokens = keyUsageStats.map(s => s.totalTokens);
    const colors = keyUsageStats.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

    return { labels, requests, tokens, colors };
  }, [keyUsageStats]);

  const lineOptions = useMemo(() => {
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(17, 24, 39, 0.06)';
    const tickColor = isDark ? 'rgba(255, 255, 255, 0.72)' : 'rgba(17, 24, 39, 0.72)';
    const tooltipBg = isDark ? 'rgba(17, 24, 39, 0.92)' : 'rgba(255, 255, 255, 0.98)';

    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: isDark ? '#fff' : '#111827',
          bodyColor: isDark ? 'rgba(255,255,255,0.86)' : '#374151',
          borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(17,24,39,0.1)',
          borderWidth: 1
        }
      },
      scales: {
        x: {
          grid: { color: gridColor },
          ticks: { color: tickColor }
        },
        y: {
          beginAtZero: true,
          grid: { color: gridColor },
          ticks: { color: tickColor }
        }
      }
    };
  }, [isDark]);

  const requestsLineData = {
    labels: chartData.labels,
    datasets: [{
      label: t('usage_stats.key_requests'),
      data: chartData.requests,
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59, 130, 246, 0.15)',
      pointBackgroundColor: chartData.colors,
      pointBorderColor: chartData.colors,
      pointRadius: 5,
      pointHoverRadius: 7,
      fill: true,
      tension: 0.35
    }]
  };

  const tokensLineData = {
    labels: chartData.labels,
    datasets: [{
      label: t('usage_stats.key_tokens'),
      data: chartData.tokens,
      borderColor: '#22c55e',
      backgroundColor: 'rgba(34, 197, 94, 0.15)',
      pointBackgroundColor: chartData.colors,
      pointBorderColor: chartData.colors,
      pointRadius: 5,
      pointHoverRadius: 7,
      fill: true,
      tension: 0.35
    }]
  };

  const hasData = keyUsageStats.length > 0;

  const periodButtons = (
    <div className={styles.periodButtons}>
      <Button
        size="sm"
        variant={period === 'hour' ? 'primary' : 'secondary'}
        onClick={() => onPeriodChange('hour')}
      >
        {t('usage_stats.by_hour')}
      </Button>
      <Button
        size="sm"
        variant={period === 'day' ? 'primary' : 'secondary'}
        onClick={() => onPeriodChange('day')}
      >
        {t('usage_stats.by_day')}
      </Button>
    </div>
  );

  const legendItems = keyUsageStats.map((stat, index) => (
    <div
      key={stat.source}
      className={styles.legendItem}
      title={stat.displayName}
    >
      <span
        className={styles.legendDot}
        style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
      />
      <span className={styles.legendLabel}>{stat.displayName}</span>
    </div>
  ));

  return (
    <div className={styles.detailsGrid}>
      {/* Requests Chart Card */}
      <Card title={t('usage_stats.key_requests_chart')} extra={periodButtons}>
        {loading ? (
          <div className={styles.hint}>{t('common.loading')}</div>
        ) : hasData ? (
          <div className={styles.chartWrapper}>
            <div className={styles.chartLegend} aria-label="Chart legend">
              {legendItems}
            </div>
            <div className={styles.chartArea}>
              <div className={styles.chartScroller}>
                <div className={styles.chartCanvas}>
                  <Line data={requestsLineData} options={lineOptions} />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.hint}>{t('usage_stats.no_data')}</div>
        )}
      </Card>

      {/* Tokens Chart Card */}
      <Card title={t('usage_stats.key_tokens_chart')} extra={periodButtons}>
        {loading ? (
          <div className={styles.hint}>{t('common.loading')}</div>
        ) : hasData ? (
          <div className={styles.chartWrapper}>
            <div className={styles.chartLegend} aria-label="Chart legend">
              {legendItems}
            </div>
            <div className={styles.chartArea}>
              <div className={styles.chartScroller}>
                <div className={styles.chartCanvas}>
                  <Line data={tokensLineData} options={lineOptions} />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.hint}>{t('usage_stats.no_data')}</div>
        )}
      </Card>
    </div>
  );
}
