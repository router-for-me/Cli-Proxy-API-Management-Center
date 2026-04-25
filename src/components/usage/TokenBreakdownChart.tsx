import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartData, ChartOptions } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import {
  buildHourlyTokenBreakdown,
  buildDailyTokenBreakdown,
  type TokenCategory
} from '@/utils/usage';
import { buildChartOptions, getHourChartMinWidth } from '@/utils/usage/chartConfig';
import type { UsagePayload } from './hooks/useUsageData';
import styles from '@/pages/UsagePage.module.scss';

const TOKEN_COLORS: Record<TokenCategory, string> = {
  input: '#8CC21F',
  output: '#FA6450',
  cached: '#F5ED58',
  reasoning: '#00ABA5'
};

const CATEGORIES: TokenCategory[] = ['input', 'output', 'cached', 'reasoning'];

function formatTokens(num: number): string {
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toString();
}

export interface TokenBreakdownChartProps {
  usage: UsagePayload | null;
  loading: boolean;
  isDark: boolean;
  isMobile: boolean;
  hourWindowHours?: number;
}

export function TokenBreakdownChart({
  usage,
  loading,
  isDark,
  isMobile,
  hourWindowHours
}: TokenBreakdownChartProps) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<'hour' | 'day'>('hour');

  const { chartData, chartOptions } = useMemo(() => {
    const series =
      period === 'hour'
        ? buildHourlyTokenBreakdown(usage, hourWindowHours)
        : buildDailyTokenBreakdown(usage);
    const categoryLabels: Record<TokenCategory, string> = {
      input: t('usage_stats.input_tokens'),
      output: t('usage_stats.output_tokens'),
      cached: t('usage_stats.cached_tokens'),
      reasoning: t('usage_stats.reasoning_tokens')
    };

    const categoryTotals: Record<TokenCategory, number> = {
      input: 0,
      output: 0,
      cached: 0,
      reasoning: 0
    };

    CATEGORIES.forEach((cat) => {
      categoryTotals[cat] = series.dataByCategory[cat].reduce(
        (sum, val) => sum + (Number(val) || 0),
        0,
      );
    });

    const data: ChartData<'bar'> = {
      labels: series.labels,
      datasets: CATEGORIES.map((cat) => ({
        label: categoryLabels[cat],
        categoryId: cat,
        data: series.dataByCategory[cat],
        backgroundColor: TOKEN_COLORS[cat],
        borderColor: isDark ? '#0f172a' : '#ffffff',
        borderWidth: 1,
        borderSkipped: false,
        grouped: false,
        // Higher order is drawn earlier by Chart.js, so larger series stay behind smaller ones.
        order: categoryTotals[cat],
        categoryPercentage: 0.78,
        barPercentage: 0.82
      }))
    };

    const baseOptions = buildChartOptions({ period, labels: series.labels, isDark, isMobile }) as ChartOptions<'bar'>;
    const options: ChartOptions<'bar'> = {
      ...baseOptions,
      scales: {
        ...baseOptions.scales,
        y: {
          ...baseOptions.scales?.y,
          stacked: false
        },
        x: {
          ...baseOptions.scales?.x,
          stacked: false
        }
      },
      plugins: {
        ...baseOptions.plugins,
        tooltip: {
          ...baseOptions.plugins?.tooltip,
          itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
          callbacks: {
            ...baseOptions.plugins?.tooltip?.callbacks,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            label: function (context: any) {
              const val = Number(context.raw) || 0;
              const cat = context.dataset.categoryId;
              let text = `${context.dataset.label}: ${formatTokens(val)}`;
              
              if (cat === 'cached') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const inputDs = context.chart.data.datasets.find((ds: any) => ds.categoryId === 'input');
                const inputVal = inputDs ? (Number(inputDs.data[context.dataIndex]) || 0) : 0;
                if (inputVal > 0) {
                  const perc = ((val / inputVal) * 100).toFixed(2);
                  text += ` (${perc}%)`;
                }
              }
              return text;
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            footer: function (tooltipItems: any[]) {
              let total = 0;
              const dataIndex = tooltipItems[0].dataIndex;
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              tooltipItems[0].chart.data.datasets.forEach((ds: any) => {
                total += Number(ds.data[dataIndex]) || 0;
              });
              return `Total: ${formatTokens(total)}`;
            }
          }
        }
      }
    };

    return { chartData: data, chartOptions: options };
  }, [usage, period, isDark, isMobile, hourWindowHours, t]);
  const labels = chartData.labels ?? [];

  return (
    <Card
      title={t('usage_stats.token_breakdown')}
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
      ) : labels.length > 0 ? (
        <div className={styles.chartWrapper}>
          <div className={styles.chartLegend} aria-label="Chart legend">
            {chartData.datasets.map((dataset, index) => (
              <div
                key={`${dataset.label}-${index}`}
                className={styles.legendItem}
                title={dataset.label}
              >
                <span className={styles.legendDot} style={{ backgroundColor: TOKEN_COLORS[CATEGORIES[index]] }} />
                <span className={styles.legendLabel}>{dataset.label}</span>
              </div>
            ))}
          </div>
          <div className={styles.chartArea}>
            <div className={styles.chartScroller}>
              <div
                className={styles.chartCanvas}
                style={
                  period === 'hour'
                    ? { minWidth: getHourChartMinWidth(labels.length, isMobile) }
                    : undefined
                }
              >
                <Bar data={chartData} options={chartOptions} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
