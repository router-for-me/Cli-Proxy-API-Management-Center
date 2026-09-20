import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildSmoothPath, computeNiceScale, formatTokenCount } from './logic';
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

// Colors aligned with sub2api TokenUsageTrend.vue reference
const CHART_COLORS = {
  input: '#3b82f6', // blue
  output: '#10b981', // green
  cacheCreation: '#f59e0b', // amber
  cacheRead: '#06b6d4', // cyan
  cacheHitRate: '#8b5cf6', // purple
  requests: '#10b981', // green
};

const GRID_Y_TICKS = [5, 23, 41, 59, 77, 95];
const PERCENT_TICKS = [100, 80, 60, 40, 20, 0];

export function UsageTrendChart({ buckets, metric, step }: UsageTrendChartProps) {
  const { t, i18n } = useTranslation();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const chartId = useId().replace(/:/g, '');

  // Reset active index when buckets change or step changes
  useEffect(() => {
    setActiveIndex(null);
  }, [buckets, step, metric]);

  // Handle escape key to close tooltip
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveIndex(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Compute scaled points, nice scales, and smooth curves
  const {
    activeScale,
    uncachedInputPoints,
    outputPoints,
    cacheReadPoints,
    cacheWritePoints,
    hitRatePoints,
    requestPoints,
    uncachedPath,
    outputPath,
    cacheReadPath,
    cacheWritePath,
    hitRatePath,
    requestPath,
    requestAreaPath,
  } = useMemo(() => {
    if (buckets.length === 0) {
      return {
        activeScale: computeNiceScale(1, 5),
        uncachedInputPoints: [],
        outputPoints: [],
        cacheReadPoints: [],
        cacheWritePoints: [],
        hitRatePoints: [],
        requestPoints: [],
        uncachedPath: '',
        outputPath: '',
        cacheReadPath: '',
        cacheWritePath: '',
        hitRatePath: '',
        requestPath: '',
        requestAreaPath: '',
      };
    }

    const allTokenValues = buckets.flatMap((b) => [
      b.uncached_input_tokens ?? 0,
      (b.non_reasoning_output_tokens ?? 0) + (b.reasoning_tokens ?? 0),
      b.cache_read_tokens ?? 0,
      b.cache_write_tokens ?? 0,
    ]);
    const rawTokenMax = Math.max(1, ...allTokenValues);
    const tokenScale = computeNiceScale(rawTokenMax, 5);

    const allRequests = buckets.map((b) => b.records ?? 0);
    const rawRequestMax = Math.max(1, ...allRequests);
    const requestScale = computeNiceScale(rawRequestMax, 5, true);

    const currentScale = metric === 'tokens' ? tokenScale : requestScale;
    const currentMax = currentScale.max;

    const n = buckets.length;
    const getX = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
    const getY = (val: number) => 95 - (Math.max(0, val) / currentMax) * 90;

    const uncachedPts: { x: number; y: number }[] = [];
    const outPts: { x: number; y: number }[] = [];
    const cReadPts: { x: number; y: number }[] = [];
    const cWritePts: { x: number; y: number }[] = [];
    const hitPts: ({ x: number; y: number } | null)[] = [];
    const reqPts: { x: number; y: number }[] = [];

    buckets.forEach((b, i) => {
      const x = getX(i);
      const uncached = b.uncached_input_tokens ?? 0;
      const out = (b.non_reasoning_output_tokens ?? 0) + (b.reasoning_tokens ?? 0);
      const cRead = b.cache_read_tokens ?? 0;
      const cWrite = b.cache_write_tokens ?? 0;

      uncachedPts.push({ x, y: getY(uncached) });
      outPts.push({ x, y: getY(out) });
      cReadPts.push({ x, y: getY(cRead) });
      cWritePts.push({ x, y: getY(cWrite) });

      // Cache hit rate: sum(cache_read) / sum(uncached_input + cache_read)
      const denom = uncached + cRead;
      if (denom > 0) {
        const rate = (cRead / denom) * 100;
        hitPts.push({ x, y: 95 - (Math.min(100, Math.max(0, rate)) / 100) * 90 });
      } else {
        hitPts.push(null);
      }

      const req = b.records ?? 0;
      reqPts.push({ x, y: getY(req) });
    });

    const uPath = buildSmoothPath(uncachedPts, 0.35, 5, 95);
    const oPath = buildSmoothPath(outPts, 0.35, 5, 95);
    const crPath = buildSmoothPath(cReadPts, 0.35, 5, 95);
    const cwPath = buildSmoothPath(cWritePts, 0.35, 5, 95);
    const hrPath = buildSmoothPath(hitPts, 0.35, 5, 95);
    const rPath = buildSmoothPath(reqPts, 0.35, 5, 95);
    const rArea = rPath ? `${rPath} L 100,95 L 0,95 Z` : '';

    return {
      activeScale: currentScale,
      uncachedInputPoints: uncachedPts,
      outputPoints: outPts,
      cacheReadPoints: cReadPts,
      cacheWritePoints: cWritePts,
      hitRatePoints: hitPts,
      requestPoints: reqPts,
      uncachedPath: uPath,
      outputPath: oPath,
      cacheReadPath: crPath,
      cacheWritePath: cwPath,
      hitRatePath: hrPath,
      requestPath: rPath,
      requestAreaPath: rArea,
    };
  }, [buckets, metric]);

  if (buckets.length === 0) {
    return <div className={styles.emptyChart}>{t('usage.no_data')}</div>;
  }

  const activeBucket = activeIndex === null ? null : buckets[activeIndex];

  // Tooltip calculations
  let tooltipContent: React.ReactNode = null;
  if (activeBucket && activeIndex !== null) {
    const outTotal =
      (activeBucket.non_reasoning_output_tokens ?? 0) +
      (activeBucket.reasoning_tokens ?? 0);
    const hitDenom =
      (activeBucket.uncached_input_tokens ?? 0) +
      (activeBucket.cache_read_tokens ?? 0);
    const hitRate =
      hitDenom > 0
        ? ((activeBucket.cache_read_tokens ?? 0) / hitDenom) * 100
        : null;

    if (metric === 'tokens') {
      tooltipContent = (
        <>
          <div className={styles.tooltipHeader}>
            <strong>{labelFor(activeBucket.timestamp, step, i18n.language)}</strong>
            <span
              className={styles.tooltipTotal}
              title={`${activeBucket.total_tokens.toLocaleString()} tokens`}
            >
              {formatTokenCount(activeBucket.total_tokens)} {t('usage.tokens')}
            </span>
          </div>
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipDot} style={{ background: CHART_COLORS.input }} />
            <span>{t('usage.series_uncached_input')}:</span>
            <strong title={`${activeBucket.uncached_input_tokens.toLocaleString()} tokens`}>
              {formatTokenCount(activeBucket.uncached_input_tokens)}
            </strong>
          </div>
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipDot} style={{ background: CHART_COLORS.output }} />
            <span>{t('usage.series_output')}:</span>
            <strong title={`${outTotal.toLocaleString()} tokens`}>
              {formatTokenCount(outTotal)}
            </strong>
          </div>
          {activeBucket.reasoning_tokens > 0 && (
            <div className={styles.tooltipSubRow}>
              <span>↳ {t('usage.reasoning_subset')}:</span>
              <span title={`${activeBucket.reasoning_tokens.toLocaleString()} tokens`}>
                {formatTokenCount(activeBucket.reasoning_tokens)}
              </span>
            </div>
          )}
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipDot} style={{ background: CHART_COLORS.cacheCreation }} />
            <span>{t('usage.series_cache_write')}:</span>
            <strong title={`${activeBucket.cache_write_tokens.toLocaleString()} tokens`}>
              {formatTokenCount(activeBucket.cache_write_tokens)}
            </strong>
          </div>
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipDot} style={{ background: CHART_COLORS.cacheRead }} />
            <span>{t('usage.series_cache_read')}:</span>
            <strong title={`${activeBucket.cache_read_tokens.toLocaleString()} tokens`}>
              {formatTokenCount(activeBucket.cache_read_tokens)}
            </strong>
          </div>
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipDot} style={{ background: CHART_COLORS.cacheHitRate }} />
            <span>{t('usage.series_hit_rate')}:</span>
            <strong>{hitRate !== null ? `${hitRate.toFixed(1)}%` : t('usage.no_samples')}</strong>
          </div>
        </>
      );
    } else {
      tooltipContent = (
        <>
          <div className={styles.tooltipHeader}>
            <strong>{labelFor(activeBucket.timestamp, step, i18n.language)}</strong>
            <span className={styles.tooltipTotal}>
              {activeBucket.records.toLocaleString()} {t('usage.requests')}
            </span>
          </div>
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipDot} style={{ background: CHART_COLORS.requests }} />
            <span>{t('usage.requests')}:</span>
            <strong>{activeBucket.records.toLocaleString()}</strong>
          </div>
          <div className={styles.tooltipRow}>
            <span>{t('usage.error_rate')}:</span>
            <strong>
              {activeBucket.records > 0
                ? `${((activeBucket.failures / activeBucket.records) * 100).toFixed(1)}%`
                : '0%'}
            </strong>
          </div>
          <div className={styles.tooltipRow}>
            <span>{t('usage.total_tokens')}:</span>
            <strong title={`${activeBucket.total_tokens.toLocaleString()} tokens`}>
              {formatTokenCount(activeBucket.total_tokens)}
            </strong>
          </div>
        </>
      );
    }
  }

  // Clamped tooltip left position (15% to 85%) to prevent overflowing viewport edges
  const tooltipLeft =
    activeIndex === null
      ? 50
      : Math.max(15, Math.min(85, ((activeIndex + 0.5) / buckets.length) * 100));

  return (
    <div className={styles.chartWrap}>
      {/* Legend */}
      <div className={styles.chartLegend}>
        {metric === 'tokens' ? (
          <>
            <div className={styles.chartLegendItem}>
              <span className={styles.legendDot} style={{ background: CHART_COLORS.input }} />
              <span>{t('usage.series_uncached_input')}</span>
            </div>
            <div className={styles.chartLegendItem}>
              <span className={styles.legendDot} style={{ background: CHART_COLORS.output }} />
              <span>{t('usage.series_output')}</span>
            </div>
            <div className={styles.chartLegendItem}>
              <span className={styles.legendDot} style={{ background: CHART_COLORS.cacheCreation }} />
              <span>{t('usage.series_cache_write')}</span>
            </div>
            <div className={styles.chartLegendItem}>
              <span className={styles.legendDot} style={{ background: CHART_COLORS.cacheRead }} />
              <span>{t('usage.series_cache_read')}</span>
            </div>
            <div className={styles.chartLegendItem}>
              <span className={styles.legendDashedDot} />
              <span>{t('usage.series_hit_rate')} (0-100%)</span>
            </div>
          </>
        ) : (
          <div className={styles.chartLegendItem}>
            <span className={styles.legendDot} style={{ background: CHART_COLORS.requests }} />
            <span>{t('usage.requests')}</span>
          </div>
        )}
      </div>

      {/* Main Chart Area with Left Y-Axis, SVG Plot, and Right Y-Axis */}
      <div className={styles.chartMainArea}>
        {/* Left Y-Axis */}
        <div className={styles.axisYLeft} aria-hidden="true">
          {activeScale.ticks.map((tick, i) => (
            <span key={i} className={styles.axisLabel}>
              {formatTokenCount(tick)}
            </span>
          ))}
        </div>

        {/* Plot Area */}
        <div className={styles.chartPlot} role="img" aria-label={t('usage.chart_label')}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={`${chartId}-req`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Horizontal Grid lines matching the 6 ticks */}
            {GRID_Y_TICKS.map((y) => (
              <line key={y} x1="0" x2="100" y1={y} y2={y} className={styles.chartGridline} />
            ))}

            {/* Vertical Grid lines matching timestamps */}
            {buckets.map((_, i) => {
              const n = buckets.length;
              const x = n <= 1 ? 50 : (i / (n - 1)) * 100;
              return (
                <line
                  key={`vgrid-${i}`}
                  x1={x}
                  x2={x}
                  y1={5}
                  y2={95}
                  className={styles.chartGridline}
                />
              );
            })}

            {metric === 'tokens' ? (
              <>
                {/* Four token series with smooth cubic Bezier splines */}
                <path
                  d={uncachedPath}
                  className={styles.chartLine}
                  style={{ stroke: CHART_COLORS.input }}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={outputPath}
                  className={styles.chartLine}
                  style={{ stroke: CHART_COLORS.output }}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={cacheWritePath}
                  className={styles.chartLine}
                  style={{ stroke: CHART_COLORS.cacheCreation }}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={cacheReadPath}
                  className={styles.chartLine}
                  style={{ stroke: CHART_COLORS.cacheRead }}
                  vectorEffect="non-scaling-stroke"
                />

                {/* Cache hit rate dashed spline */}
                {hitRatePath && (
                  <path
                    d={hitRatePath}
                    className={styles.chartHitRateLine}
                    style={{ stroke: CHART_COLORS.cacheHitRate }}
                    vectorEffect="non-scaling-stroke"
                  />
                )}

                {/* Dots on data points */}
                {uncachedInputPoints.map((pt, i) => (
                  <circle
                    key={`dot-uncached-${i}`}
                    cx={pt.x}
                    cy={pt.y}
                    r={activeIndex === i ? 2.5 : 1.3}
                    fill={CHART_COLORS.input}
                    stroke="var(--bg-primary)"
                    strokeWidth={0.5}
                    className={styles.chartPointDot}
                  />
                ))}
                {outputPoints.map((pt, i) => (
                  <circle
                    key={`dot-output-${i}`}
                    cx={pt.x}
                    cy={pt.y}
                    r={activeIndex === i ? 2.5 : 1.3}
                    fill={CHART_COLORS.output}
                    stroke="var(--bg-primary)"
                    strokeWidth={0.5}
                    className={styles.chartPointDot}
                  />
                ))}
                {cacheWritePoints.map((pt, i) => (
                  <circle
                    key={`dot-cachewrite-${i}`}
                    cx={pt.x}
                    cy={pt.y}
                    r={activeIndex === i ? 2.5 : 1.3}
                    fill={CHART_COLORS.cacheCreation}
                    stroke="var(--bg-primary)"
                    strokeWidth={0.5}
                    className={styles.chartPointDot}
                  />
                ))}
                {cacheReadPoints.map((pt, i) => (
                  <circle
                    key={`dot-cacheread-${i}`}
                    cx={pt.x}
                    cy={pt.y}
                    r={activeIndex === i ? 2.5 : 1.3}
                    fill={CHART_COLORS.cacheRead}
                    stroke="var(--bg-primary)"
                    strokeWidth={0.5}
                    className={styles.chartPointDot}
                  />
                ))}
                {hitRatePoints.map((pt, i) =>
                  pt ? (
                    <circle
                      key={`dot-hitrate-${i}`}
                      cx={pt.x}
                      cy={pt.y}
                      r={activeIndex === i ? 2.5 : 1.3}
                      fill={CHART_COLORS.cacheHitRate}
                      stroke="var(--bg-primary)"
                      strokeWidth={0.5}
                      className={styles.chartPointDot}
                    />
                  ) : null
                )}
              </>
            ) : (
              <>
                <path d={requestAreaPath} fill={`url(#${chartId}-req)`} />
                <path
                  d={requestPath}
                  className={styles.chartLine}
                  style={{ stroke: CHART_COLORS.requests }}
                  vectorEffect="non-scaling-stroke"
                />
                {requestPoints.map((pt, i) => (
                  <circle
                    key={`dot-req-${i}`}
                    cx={pt.x}
                    cy={pt.y}
                    r={activeIndex === i ? 2.5 : 1.3}
                    fill={CHART_COLORS.requests}
                    stroke="var(--bg-primary)"
                    strokeWidth={0.5}
                    className={styles.chartPointDot}
                  />
                ))}
              </>
            )}
          </svg>

          {/* Hotspots for hover / click / focus */}
          <div className={styles.chartHotspots} onMouseLeave={() => setActiveIndex(null)}>
            {buckets.map((bucket, index) => (
              <button
                key={bucket.timestamp}
                className={styles.chartHotspot}
                type="button"
                aria-label={`${labelFor(bucket.timestamp, step, i18n.language)}: ${formatTokenCount(bucket.total_tokens)}`}
                onMouseEnter={() => setActiveIndex(index)}
                onFocus={() => setActiveIndex(index)}
                onClick={() => setActiveIndex((current) => (current === index ? null : index))}
              />
            ))}
          </div>

          {/* Tooltip */}
          {activeBucket && activeIndex !== null && (
            <div
              className={styles.chartTooltip}
              style={{ left: `${tooltipLeft}%` }}
              role="status"
            >
              {tooltipContent}
            </div>
          )}
        </div>

        {/* Right Y-Axis (0-100% for tokens metric) */}
        {metric === 'tokens' ? (
          <div className={styles.axisYRight} aria-hidden="true">
            {PERCENT_TICKS.map((rate) => (
              <span key={rate} className={styles.axisLabel}>
                {rate}%
              </span>
            ))}
          </div>
        ) : (
          <div className={styles.axisYRightPlaceholder} aria-hidden="true" />
        )}
      </div>

      {/* Bottom X-Axis */}
      <div className={styles.chartAxisBottom} aria-hidden="true">
        <div className={styles.axisBottomSpacerLeft} />
        <div className={styles.axisBottomLabels}>
          <span>{labelFor(buckets[0].timestamp, step, i18n.language)}</span>
          {buckets.length > 2 && (
            <span>{labelFor(buckets[Math.floor((buckets.length - 1) / 2)].timestamp, step, i18n.language)}</span>
          )}
          {buckets.length > 1 && (
            <span>{labelFor(buckets[buckets.length - 1].timestamp, step, i18n.language)}</span>
          )}
        </div>
        <div className={styles.axisBottomSpacerRight} />
      </div>
    </div>
  );
}
