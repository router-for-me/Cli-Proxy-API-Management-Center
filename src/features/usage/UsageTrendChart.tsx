import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatTokenCount, metricValue } from './logic';
import type { UsageBucket, UsageMetric } from './types';
import styles from './UsagePage.module.scss';

interface UsageTrendChartProps {
  buckets: UsageBucket[];
  metric: UsageMetric;
  step: 'hour' | 'day';
}

const labelFor = (timestamp: string, step: 'hour' | 'day', locale: string) => {
  const date = new Date(timestamp);
  return step === 'hour'
    ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
};

export function UsageTrendChart({ buckets, metric, step }: UsageTrendChartProps) {
  const { t, i18n } = useTranslation();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, '');
  const values = useMemo(() => buckets.map((bucket) => metricValue(bucket, metric)), [buckets, metric]);
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => {
    const x = buckets.length <= 1 ? 50 : (index / (buckets.length - 1)) * 100;
    const y = 36 - (value / max) * 32;
    return `${x},${y}`;
  });
  const linePath = points.length > 0 ? `M ${points.join(' L ')}` : '';
  const areaPath = points.length > 0 ? `${linePath} L 100,40 L 0,40 Z` : '';
  const activeBucket = activeIndex === null ? null : buckets[activeIndex];

  if (buckets.length === 0) {
    return <div className={styles.emptyChart}>{t('usage.no_data')}</div>;
  }

  return (
    <div className={styles.chartWrap}>
      <div className={styles.chartPlot} role="img" aria-label={t('usage.chart_label')}>
        <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--viz-success)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--viz-success)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[4, 12, 20, 28, 36].map((y) => (
            <line key={y} x1="0" x2="100" y1={y} y2={y} className={styles.chartGridline} />
          ))}
          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path d={linePath} className={styles.chartLine} vectorEffect="non-scaling-stroke" />
        </svg>
        <div className={styles.chartHotspots} onMouseLeave={() => setActiveIndex(null)}>
          {buckets.map((bucket, index) => (
            <button
              key={bucket.timestamp}
              className={styles.chartHotspot}
              type="button"
              aria-label={`${labelFor(bucket.timestamp, step, i18n.language)}: ${formatTokenCount(values[index])}`}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onClick={() => setActiveIndex((current) => (current === index ? null : index))}
            />
          ))}
        </div>
        {activeBucket && activeIndex !== null && (
          <div
            className={styles.chartTooltip}
            style={{ left: `${((activeIndex + 0.5) / buckets.length) * 100}%` }}
            role="status"
          >
            <strong>
              {labelFor(activeBucket.timestamp, step, i18n.language)}
            </strong>
            <span>{formatTokenCount(values[activeIndex])}</span>
          </div>
        )}
      </div>
      <div className={styles.chartAxis} aria-hidden="true">
        <span>{labelFor(buckets[0].timestamp, step, i18n.language)}</span>
        <span>{labelFor(buckets[Math.floor((buckets.length - 1) / 2)].timestamp, step, i18n.language)}</span>
        <span>{labelFor(buckets[buckets.length - 1].timestamp, step, i18n.language)}</span>
      </div>
    </div>
  );
}
