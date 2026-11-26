/**
 * Pool chart: every provider's pooled weekly quota on one chart, recorded and
 * projected, with each pool's headline numbers in a strip of tiles above it.
 * The tiles double as the legend and toggle their line.
 *
 * Lines show a share of each pool's capacity by default, so pools of different
 * sizes share one axis; the pooled scale plots summed percent instead.
 *
 * Hand-drawn SVG in pixel space (measured width), so text and strokes keep
 * their size at any card width. All numbers come from poolForecast.ts.
 */

import {
  useId,
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { getTypeLabel } from '@/features/authFiles/constants';
import type { QuotaProviderType } from '@/features/quota/providers/types';
import type { ResolvedTheme } from '@/types';
import { fableColor, formatCountdown, type OverviewProviderPool } from './model';
import {
  burnRate,
  drainAt,
  projectPool,
  recordedDrain,
  recordedSeries,
  seriesValuesAt,
  sumValues,
  type DrainStep,
  type PoolAccount,
  type Projection,
  type RecordedSeries,
  type RoutingMode,
  type SeriesPoint,
} from './poolForecast';
import { ProviderIcon } from './ProviderIcon';
import { niceCeil, remainingQuotaTicks } from './chartTicks';
import styles from './PoolChart.module.scss';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Forecast at least this far ahead, whatever the visible range. */
export const FORECAST_HORIZON_MS = 14 * DAY_MS;

export const CHART_MODES = ['remaining', 'drain'] as const;
export type ChartMode = (typeof CHART_MODES)[number];
export const CHART_SCALES = ['share', 'pooled'] as const;
export type ChartScale = (typeof CHART_SCALES)[number];
export const BURN_WINDOWS = [1, 3, 6] as const;
export type BurnWindow = (typeof BURN_WINDOWS)[number];
export const FUTURE_USAGE = ['current', 'week', 'half', 'double', 'none'] as const;
export type FutureUsage = (typeof FUTURE_USAGE)[number];

const HEIGHT = 270;
const MARGIN = { top: 30, right: 14, bottom: 32, left: 56 };
const MIN_JUMP_LABEL = 3;
/** Reset labels only fit when few lines are drawn; the tooltip covers the rest. */
const MAX_LABELLED_SERIES = 2;

/** Matching line and headline colors, with light and dark steps. */
const PROVIDER_COLORS: Partial<Record<QuotaProviderType, [string, string]>> = {
  claude: ['#d4693f', '#e07a52'],
  codex: ['#2a78d6', '#5598e7'],
  antigravity: ['#1baf7a', '#199e70'],
  kimi: ['#6250d6', '#9085e9'],
  xai: ['#52514e', '#c3c2b7'],
  devin: ['#008300', '#2fa82f'],
  meta: ['#256abf', '#3987e5'],
};
const FALLBACK_COLOR: [string, string] = ['#52514e', '#c3c2b7'];

const pick = ([light, dark]: [string, string], theme: ResolvedTheme) =>
  theme === 'dark' ? dark : light;

/** The pool chart's line color for a provider, shared with the quota-window timeline. */
export const providerChartColor = (provider: QuotaProviderType, theme: ResolvedTheme) =>
  pick(PROVIDER_COLORS[provider] ?? FALLBACK_COLOR, theme);

/** Series id for a pool's Fable allowance; the main series uses the provider id. */
const fableSeriesId = (provider: QuotaProviderType) => `${provider}:fable`;

const formatWhen = (ms: number, locale: string) =>
  new Date(ms).toLocaleString(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' });

const formatRate = (rate: number) => (rate < 10 ? rate.toFixed(1) : String(Math.round(rate)));

const usageFactor = (futureUsage: FutureUsage) =>
  futureUsage === 'half' ? 0.5 : futureUsage === 'double' ? 2 : 1;

function useElementWidth<T extends HTMLElement>() {
  const [width, setWidth] = useState(0);
  // The plot may mount only after quota loads. Observe each mounted element,
  // rather than running an effect before the plot exists.
  const ref = useCallback((element: T | null) => {
    if (!element) return;
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

interface Series {
  id: string;
  provider: QuotaProviderType;
  label: string;
  color: string;
  fable: boolean;
  accountCount: number;
  total: number;
  remaining: number;
  recorded: RecordedSeries;
  drain: DrainStep[];
  projection: Projection;
}

interface Tile {
  key: string;
  provider: QuotaProviderType;
  label: string;
  notLoaded: number;
  series: Series | null;
}

export interface PoolChartProps {
  /** Pools in display order; accounts in routing order. */
  pools: OverviewProviderPool[];
  nowMs: number;
  rangeStartMs: number;
  rangeEndMs: number;
  mode: ChartMode;
  scale: ChartScale;
  burnHours: BurnWindow;
  futureUsage: FutureUsage;
  routing: RoutingMode;
  resolvedTheme: ResolvedTheme;
  /** Series ids whose line is hidden. */
  hidden?: readonly string[];
  onToggleSeries?: (id: string) => void;
}

export function PoolChart({
  pools,
  nowMs,
  rangeStartMs,
  rangeEndMs,
  mode,
  scale,
  burnHours,
  futureUsage,
  routing,
  resolvedTheme,
  hidden = [],
  onToggleSeries,
}: PoolChartProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const horizonMs = nowMs + FORECAST_HORIZON_MS;
  const untilMs = Math.max(horizonMs, rangeEndMs);

  const tiles = useMemo(() => {
    const build = (
      id: string,
      provider: QuotaProviderType,
      label: string,
      color: string,
      accounts: PoolAccount[],
      fable: boolean
    ): Series => {
      const burn =
        futureUsage === 'none'
          ? 0
          : (burnRate(accounts, nowMs, futureUsage === 'week' ? 168 : burnHours) ?? 0) *
            usageFactor(futureUsage);
      return {
        id,
        provider,
        label,
        color,
        fable,
        accountCount: accounts.length,
        total: accounts.length * 100,
        remaining: sumValues(accounts.map((account) => account.remaining)),
        recorded: recordedSeries(accounts, nowMs),
        drain: mode === 'drain' ? recordedDrain(accounts, nowMs) : [],
        projection: projectPool({ accounts, nowMs, untilMs, burnPerHour: burn, mode: routing }),
      };
    };
    return pools.flatMap((pool): Tile[] => {
      const label = getTypeLabel(t, pool.provider);
      const notLoaded = pool.credentialCount - pool.accounts.length;
      const main: Tile = {
        key: pool.provider,
        provider: pool.provider,
        label,
        notLoaded,
        series:
          pool.accounts.length > 0
            ? build(
                pool.provider,
                pool.provider,
                label,
                providerChartColor(pool.provider, resolvedTheme),
                pool.accounts,
                false
              )
            : null,
      };
      if (pool.provider !== 'claude' || pool.fableAccounts.length === 0) return [main];
      const fableId = fableSeriesId(pool.provider);
      return [
        main,
        {
          key: fableId,
          provider: pool.provider,
          label: t('pd_overview.fable'),
          notLoaded: 0,
          series: build(
            fableId,
            pool.provider,
            t('pd_overview.fable'),
            fableColor(resolvedTheme),
            pool.fableAccounts,
            true
          ),
        },
      ];
    });
  }, [pools, nowMs, untilMs, burnHours, futureUsage, mode, routing, resolvedTheme, t]);

  const series = tiles.flatMap((tile) => (tile.series ? [tile.series] : []));
  const shown = series.filter((item) => !hidden.includes(item.id));

  /* ---------- geometry ---------- */

  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const plotW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const baseline = MARGIN.top + plotH;
  const span = rangeEndMs - rangeStartMs;
  const x = (ms: number) => MARGIN.left + ((ms - rangeStartMs) / span) * plotW;
  const timeAt = (px: number) => rangeStartMs + ((px - MARGIN.left) / plotW) * span;

  /** Pooled percent (or %/h) to what the axis shows for this series. */
  const norm = (item: Series, pooled: number) =>
    scale === 'share' ? (pooled / Math.max(1, item.total)) * 100 : pooled;

  const drainMax = useMemo(() => {
    if (mode !== 'drain') return 1;
    const rates = shown.flatMap((item) =>
      [...item.drain, ...item.projection.drain].map((step) => norm(item, step.rate))
    );
    return niceCeil(Math.max(0, ...rates) * 1.15);
    // norm closes over scale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, shown, scale]);
  const capacity = Math.max(100, ...series.map((item) => item.total));
  const yMax = mode === 'drain' ? drainMax : scale === 'share' ? 100 : capacity;
  const y = (value: number) => MARGIN.top + plotH - (value / yMax) * plotH;

  const linePath = (item: Series, points: readonly SeriesPoint[]) =>
    points
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'}${x(point.t).toFixed(1)},${y(norm(item, sumValues(point.values))).toFixed(1)}`
      )
      .join('');

  const stepPath = (item: Series, steps: readonly DrainStep[], endMs: number) =>
    steps
      .map((step, index) => {
        const nextT = steps[index + 1]?.t ?? endMs;
        const yy = y(norm(item, step.rate)).toFixed(1);
        return `${index === 0 ? 'M' : 'L'}${x(step.t).toFixed(1)},${yy}L${x(nextT).toFixed(1)},${yy}`;
      })
      .join('');

  /* ---------- ticks and labels ---------- */

  const yTicks =
    mode === 'drain'
      ? [0, yMax / 2, yMax].map((value) => ({ value, label: true }))
      : scale === 'share'
        ? [0, 25, 50, 75, 100].map((value) => ({ value, label: true }))
        : remainingQuotaTicks(yMax);
  const days = useMemo(() => {
    const out: number[] = [];
    const d = new Date(rangeStartMs);
    d.setHours(0, 0, 0, 0);
    for (let ms = d.getTime(); ms < rangeEndMs;) {
      if (ms >= rangeStartMs) out.push(ms);
      d.setDate(d.getDate() + 1);
      ms = d.getTime();
    }
    return out;
  }, [rangeStartMs, rangeEndMs]);
  const dayStep = Math.max(1, Math.ceil((days.length * 64) / Math.max(1, plotW)));
  const nowVisible = nowMs >= rangeStartMs && nowMs <= rangeEndMs;

  const jumpLabels = useMemo(() => {
    if (mode !== 'remaining' || plotW <= 0 || shown.length > MAX_LABELLED_SERIES) return [];
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    if (nowVisible) {
      const nx = x(nowMs);
      placed.push({ x0: nx - 18, x1: nx + 18, y0: 2, y1: 18 });
    }
    const overlaps = (box: (typeof placed)[number]) =>
      placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0);
    const marks: { key: string; x: number; y: number; text: string; color: string }[] = [];
    for (const item of shown) {
      const candidates = [
        ...item.recorded.jumps.map((jump) => ({ jump, points: item.recorded.points })),
        ...item.projection.jumps.map((jump) => ({ jump, points: item.projection.points })),
      ];
      for (const { jump, points } of candidates) {
        if (jump.gain < MIN_JUMP_LABEL || jump.t < rangeStartMs || jump.t > rangeEndMs) continue;
        const after = seriesValuesAt(points, jump.t);
        if (!after) continue;
        const gain = Math.round(norm(item, jump.gain));
        const text =
          shown.length > 1 ? t('pd_overview.reset_jump', { scope: item.label, gain }) : `+${gain}%`;
        const jx = x(jump.t);
        const top = y(norm(item, sumValues(after)));
        const w = text.length * 7 + 4;
        for (const ty of [top - 8, top + 20]) {
          const box = { x0: jx - w / 2, x1: jx + w / 2, y0: ty - 12, y1: ty + 2 };
          if (ty < 14 || ty > baseline - 4 || overlaps(box)) continue;
          placed.push(box);
          marks.push({ key: `${item.id}:${jump.t}`, x: jx, y: ty, text, color: item.color });
          break;
        }
      }
    }
    return marks;
    // x, y and norm close over the values listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, plotW, nowVisible, nowMs, shown, rangeStartMs, rangeEndMs, yMax, scale, t]);

  /* ---------- hover ---------- */

  const [hoverMs, setHoverMs] = useState<number | null>(null);
  const clampToRange = (ms: number) => Math.min(rangeEndMs, Math.max(rangeStartMs, ms));
  const onPointerMove = (event: PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (rect) setHoverMs(clampToRange(timeAt(event.clientX - rect.left)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? DAY_MS : HOUR_MS;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      setHoverMs((value) => clampToRange((value ?? nowMs) + direction * step));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setHoverMs(clampToRange(nowMs));
    } else if (event.key === 'Escape') {
      setHoverMs(null);
    }
  };

  /** Axis value for each shown series at the hovered time, or null before its history. */
  const hoverValues = useMemo(() => {
    if (hoverMs === null) return null;
    const future = hoverMs > nowMs;
    return shown.map((item) => {
      if (mode === 'drain') {
        const rate = drainAt(future ? item.projection.drain : item.drain, hoverMs);
        return { item, value: rate === null ? null : norm(item, rate) };
      }
      const values = seriesValuesAt(
        future ? item.projection.points : item.recorded.points,
        hoverMs
      );
      return { item, value: values ? norm(item, sumValues(values)) : null };
    });
    // norm closes over scale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverMs, nowMs, shown, mode, scale]);

  const uid = useId().replace(/:/g, '');
  const hasHistory = series.some((item) => item.recorded.points.length > 0);
  const chartLabel = t('pd_overview.chart_label', {
    summary: series
      .map((item) =>
        t('pd_overview.series_summary', {
          name: item.label,
          remaining: Math.round(item.remaining),
          total: item.total,
        })
      )
      .join(', '),
  });
  const formatAxis = (value: number) =>
    mode === 'drain'
      ? t('pd_overview.rate_value', { value: formatRate(value) })
      : `${Math.round(value)}%`;

  /* ---------- render ---------- */

  return (
    <section className={styles.card}>
      <div className={styles.stats}>
        {tiles.map((tile) => {
          const item = tile.series;
          const style = {
            '--series-color': item?.color ?? providerChartColor(tile.provider, resolvedTheme),
          } as CSSProperties;
          const head = (
            <span className={styles.statHead}>
              {item?.fable ? (
                <span className={styles.swatch} aria-hidden="true" />
              ) : (
                <ProviderIcon provider={tile.provider} resolvedTheme={resolvedTheme} />
              )}
              <span className={styles.statName}>{tile.label}</span>
              {item && <span className={styles.swatchLine} aria-hidden="true" />}
            </span>
          );
          if (!item) {
            return (
              <div key={tile.key} className={`${styles.stat} ${styles.statEmpty}`} style={style}>
                {head}
                <span className={styles.statMeta}>{t('pd_overview.not_loaded_row')}</span>
              </div>
            );
          }
          const reset =
            item.projection.nextReset && item.projection.nextReset.t <= horizonMs
              ? item.projection.nextReset
              : null;
          const pooled = Math.round(item.remaining);
          return (
            <button
              key={tile.key}
              type="button"
              className={`${styles.stat} ${item.fable ? styles.statSub : ''}`}
              style={style}
              aria-pressed={!hidden.includes(item.id)}
              title={
                item.fable
                  ? t('pd_overview.fable_hint', { count: item.accountCount })
                  : t('pd_overview.series_toggle')
              }
              onClick={() => onToggleSeries?.(item.id)}
            >
              {head}
              <span className={styles.statValue}>{Math.round(norm(item, item.remaining))}%</span>
              <span className={styles.statMeta}>
                {scale === 'share'
                  ? t('pd_overview.pooled_of_total', { remaining: pooled, total: item.total })
                  : t('pd_overview.of_total', { total: item.total })}
                {tile.notLoaded > 0 && (
                  <> · {t('pd_overview.not_loaded', { count: tile.notLoaded })}</>
                )}
              </span>
              {reset && (
                <span
                  className={styles.statMeta}
                  title={`+${Math.round(reset.gain)}% · ${formatWhen(reset.t, locale)}`}
                >
                  {t('pd_overview.next_reset')} <strong>{formatCountdown(reset.t, nowMs)}</strong>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {series.length > 0 && (
        <>
          <div
            ref={wrapRef}
            className={styles.plot}
            tabIndex={0}
            role="group"
            aria-label={chartLabel}
            onKeyDown={onKeyDown}
            onFocus={() => setHoverMs((value) => value ?? clampToRange(nowMs))}
            onBlur={() => setHoverMs(null)}
          >
            {width > 0 && (
              <svg width={width} height={HEIGHT} aria-hidden="true" className={styles.svg}>
                <defs>
                  <clipPath id={`${uid}-clip`}>
                    <rect x={MARGIN.left} y={0} width={plotW} height={baseline} />
                  </clipPath>
                  <pattern
                    id={`${uid}-future`}
                    width="6"
                    height="6"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <line x1="0" y1="0" x2="0" y2="6" className={styles.hatch} />
                  </pattern>
                </defs>

                {nowVisible && (
                  <rect
                    x={x(nowMs)}
                    y={MARGIN.top}
                    width={Math.max(0, MARGIN.left + plotW - x(nowMs))}
                    height={plotH}
                    fill={`url(#${uid}-future)`}
                  />
                )}

                {yTicks.map(({ value: tick, label }) => (
                  <g key={tick}>
                    <line
                      className={tick === 0 ? styles.axis : label ? styles.grid : styles.minorGrid}
                      x1={MARGIN.left}
                      x2={MARGIN.left + plotW}
                      y1={y(tick)}
                      y2={y(tick)}
                    />
                    {label && (
                      <text
                        className={styles.tick}
                        x={MARGIN.left - 10}
                        y={y(tick) + 4}
                        textAnchor="end"
                      >
                        {tick === 0 ? '0' : formatAxis(tick)}
                      </text>
                    )}
                  </g>
                ))}

                {days.map((day, index) =>
                  index % dayStep === 0 && x(day + DAY_MS / 2) < MARGIN.left + plotW ? (
                    <text
                      key={day}
                      className={styles.tick}
                      x={x(day + DAY_MS / 2)}
                      y={baseline + 18}
                      textAnchor="middle"
                    >
                      {new Date(day).toLocaleDateString(locale, {
                        weekday: 'short',
                        day: 'numeric',
                      })}
                    </text>
                  ) : null
                )}

                <g clipPath={`url(#${uid}-clip)`}>
                  {shown.map((item) => (
                    <g key={item.id} style={{ '--series-color': item.color } as CSSProperties}>
                      <path
                        className={`${styles.line} ${item.fable ? styles.thin : ''}`}
                        d={
                          mode === 'drain'
                            ? stepPath(item, item.drain, nowMs)
                            : linePath(item, item.recorded.points)
                        }
                      />
                      <path
                        className={`${styles.line} ${styles.dashed} ${item.fable ? styles.thin : ''}`}
                        d={
                          mode === 'drain'
                            ? stepPath(item, item.projection.drain, untilMs)
                            : linePath(item, item.projection.points)
                        }
                      />
                    </g>
                  ))}
                </g>

                {jumpLabels.map((mark) => (
                  <text
                    key={mark.key}
                    className={styles.jump}
                    style={{ '--series-color': mark.color } as CSSProperties}
                    x={mark.x}
                    y={mark.y}
                    textAnchor="middle"
                  >
                    {mark.text}
                  </text>
                ))}

                {nowVisible && (
                  <g>
                    <line
                      className={styles.nowLine}
                      x1={x(nowMs)}
                      x2={x(nowMs)}
                      y1={MARGIN.top - 8}
                      y2={baseline}
                    />
                    <text className={styles.tick} x={x(nowMs)} y={14} textAnchor="middle">
                      {t('pd_overview.now')}
                    </text>
                    {mode === 'remaining' &&
                      shown.map((item) => (
                        <circle
                          key={item.id}
                          className={styles.dot}
                          style={{ '--series-color': item.color } as CSSProperties}
                          cx={x(nowMs)}
                          cy={y(norm(item, item.remaining))}
                          r={item.fable ? 3.5 : 4.5}
                        />
                      ))}
                  </g>
                )}

                {hoverMs !== null && hoverValues && (
                  <g>
                    <line
                      className={styles.hoverLine}
                      x1={x(hoverMs)}
                      x2={x(hoverMs)}
                      y1={MARGIN.top}
                      y2={baseline}
                    />
                    {hoverValues.map(({ item, value }) =>
                      value === null ? null : (
                        <circle
                          key={item.id}
                          className={styles.dot}
                          style={{ '--series-color': item.color } as CSSProperties}
                          cx={x(hoverMs)}
                          cy={y(value)}
                          r={4}
                        />
                      )
                    )}
                  </g>
                )}

                <rect
                  x={MARGIN.left}
                  y={0}
                  width={plotW}
                  height={baseline}
                  fill="transparent"
                  onPointerMove={onPointerMove}
                  onPointerLeave={() => setHoverMs(null)}
                />
              </svg>
            )}

            {hoverMs !== null && hoverValues && hoverValues.length > 0 && (
              <div
                className={styles.tooltip}
                style={
                  x(hoverMs) > width * 0.6
                    ? { right: width - x(hoverMs) + 12 }
                    : { left: x(hoverMs) + 12 }
                }
                role="status"
              >
                <div className={styles.muted}>{formatWhen(hoverMs, locale)}</div>
                {hoverValues.map(({ item, value }) => (
                  <div
                    key={item.id}
                    className={styles.tooltipRow}
                    style={{ '--series-color': item.color } as CSSProperties}
                  >
                    <span className={styles.swatch} aria-hidden="true" />
                    <span>{item.label}</span>
                    {value === null ? (
                      <span className={styles.muted}>{t('pd_overview.no_history')}</span>
                    ) : (
                      <strong>{formatAxis(value)}</strong>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <footer className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={styles.legendLine} aria-hidden="true" />
              {t('pd_overview.recorded')}
            </span>
            <span className={styles.legendItem}>
              <span className={`${styles.legendLine} ${styles.legendDashed}`} aria-hidden="true" />
              {t('pd_overview.projected')}
            </span>
            {!hasHistory && (
              <span className={styles.legendHint}>{t('pd_overview.history_hint')}</span>
            )}
            <span className={styles.legendNote}>
              {t(`pd_overview.scale_note_${scale}_${mode}`)}
            </span>
          </footer>
        </>
      )}
    </section>
  );
}
