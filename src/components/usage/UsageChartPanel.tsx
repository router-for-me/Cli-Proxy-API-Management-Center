import { memo, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ChartOptions } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { ChartData } from '@/utils/usage';
import { getHourChartMinWidth } from '@/utils/usage/chartConfig';
import styles from './UsageCharts.module.scss';

export type UsageChartTone = 'neutral' | 'success' | 'warning' | 'danger' | 'violet';

export interface UsageChartSummaryItem {
  label: string;
  value: string;
}

export interface UsageChartPanelProps {
  title: string;
  description?: string;
  period?: 'hour' | 'day';
  onPeriodChange?: (period: 'hour' | 'day') => void;
  chartData: ChartData;
  chartOptions: ChartOptions<'line'>;
  loading: boolean;
  isMobile: boolean;
  emptyText: string;
  summaryItems?: UsageChartSummaryItem[];
  tone?: UsageChartTone;
  className?: string;
  hasData?: boolean;
  footer?: ReactNode;
}

const toneClassMap: Record<UsageChartTone, string> = {
  neutral: styles.toneNeutral,
  success: styles.toneSuccess,
  warning: styles.toneWarning,
  danger: styles.toneDanger,
  violet: styles.toneViolet,
};

const resolveLegendLabel = (label: string, allModelsLabel: string) =>
  label === 'All Models' ? allModelsLabel : label;

export const UsageChartPanel = memo(function UsageChartPanel({
  title,
  description,
  period,
  onPeriodChange,
  chartData,
  chartOptions,
  loading,
  isMobile,
  emptyText,
  summaryItems = [],
  tone = 'neutral',
  className,
  hasData,
  footer,
}: UsageChartPanelProps) {
  const { t } = useTranslation();
  const legendItems = useMemo(
    () =>
      chartData.datasets.map((dataset) => ({
        label: resolveLegendLabel(dataset.label, t('usage_stats.chart_line_all')),
        color: dataset.borderColor,
      })),
    [chartData.datasets, t]
  );

  const showChart = (hasData ?? chartData.labels.length > 0) && chartData.labels.length > 0;
  const showLegend = legendItems.length > 1;
  const showPeriodToggle = period !== undefined && onPeriodChange !== undefined;
  const toneClassName = toneClassMap[tone];

  return (
    <Card
      className={[styles.panelCard, toneClassName, className].filter(Boolean).join(' ')}
      title={
        <div className={styles.panelHeading}>
          <span className={styles.panelTitle}>{title}</span>
          {description && <span className={styles.panelDescription}>{description}</span>}
        </div>
      }
      extra={
        showPeriodToggle ? (
          <div className={styles.periodButtons}>
            <Button
              variant={period === 'hour' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => onPeriodChange?.('hour')}
            >
              {t('usage_stats.by_hour')}
            </Button>
            <Button
              variant={period === 'day' ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => onPeriodChange?.('day')}
            >
              {t('usage_stats.by_day')}
            </Button>
          </div>
        ) : null
      }
    >
      {loading ? (
        <div className={styles.panelEmpty}>{t('common.loading')}</div>
      ) : !showChart ? (
        <div className={styles.panelEmpty}>{emptyText}</div>
      ) : (
        <div className={styles.panelShell}>
          {summaryItems.length > 0 && (
            <div className={styles.summaryRow}>
              {summaryItems.map((item) => (
                <div key={item.label} className={styles.summaryPill}>
                  <span className={styles.summaryLabel}>{item.label}</span>
                  <span className={styles.summaryValue}>{item.value}</span>
                </div>
              ))}
            </div>
          )}
          {showLegend && (
            <div className={styles.legend} aria-label="Chart legend">
              {legendItems.map((item) => (
                <div key={item.label} className={styles.legendItem} title={item.label}>
                  <span className={styles.legendDot} style={{ backgroundColor: item.color }} />
                  <span className={styles.legendLabel}>{item.label}</span>
                </div>
              ))}
            </div>
          )}
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
          {footer}
        </div>
      )}
    </Card>
  );
});

UsageChartPanel.displayName = 'UsageChartPanel';
