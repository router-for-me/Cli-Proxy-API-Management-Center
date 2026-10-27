/**
 * Requests over the last 20 buckets: a stacked area per provider above
 * success/failure columns, sharing one local-time axis and one hover.
 */

import { useId, useLayoutEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTypeLabel } from '@/features/authFiles/constants';
import { formatCompactNumber, formatPercent } from '@/utils/format';
import { axisMax } from '../utils';
import { BUCKET_MS, type Traffic, type TrafficPoint } from './model';
import styles from './ProxDashboard.module.scss';

const AREA_HEIGHT = 168;
const BARS_HEIGHT = 64;
const MAX_BAR_WIDTH = 24;
const SEGMENT_GAP = 2;

type Props = {
  traffic: Traffic;
  colorOf: (provider: string) => string;
};

/** Monotone cubic through the points (no overshoot below the band beneath). */
function monotonePath(xs: number[], ys: number[], move = true): string {
  const n = xs.length;
  if (n === 0) return '';
  const start = `${move ? 'M' : 'L'}${xs[0]},${ys[0]}`;
  if (n === 1) return start;
  const slopes = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]));
  const tangents = xs.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === n - 1) return slopes[n - 2];
    const [a, b] = [slopes[i - 1], slopes[i]];
    return a * b <= 0 ? 0 : (3 * a * b) / (Math.max(a, b) * 2 + Math.min(a, b));
  });
  let d = start;
  for (let i = 0; i < n - 1; i += 1) {
    const dx = (xs[i + 1] - xs[i]) / 3;
    d += ` C${xs[i] + dx},${ys[i] + tangents[i] * dx} ${xs[i + 1] - dx},${ys[i + 1] - tangents[i + 1] * dx} ${xs[i + 1]},${ys[i + 1]}`;
  }
  return d;
}

const timeFormatter = (locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });

/** Width of an element that may mount later than its component (callback ref). */
function useWidth<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    setWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [element]);
  return [element, setElement, width] as const;
}

export function TrafficChart({ traffic, colorOf }: Props) {
  const { t, i18n } = useTranslation();
  const gradientId = useId();
  const [plot, plotRef, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const { points, providers } = traffic;
  const count = points.length;
  const format = useMemo(() => timeFormatter(i18n.language || 'en'), [i18n.language]);
  const rangeLabel = (point: TrafficPoint) =>
    `${format.format(point.start)}–${format.format(point.start + BUCKET_MS)}`;

  const peak = Math.max(0, ...points.map((point) => point.total));
  const areaMax = axisMax(peak, 2);
  const barsMax = axisMax(peak, 1);
  const slot = count > 0 ? width / count : 0;
  const xAt = (index: number) => (index + 0.5) * slot;

  const bands = useMemo(() => {
    if (width <= 0 || count === 0) return [];
    const xs = points.map((_, index) => (index + 0.5) * (width / count));
    const y = (value: number) => AREA_HEIGHT - (value / areaMax) * AREA_HEIGHT;
    const base = points.map(() => 0);
    return providers.map((provider) => {
      const lower = [...base];
      points.forEach((point, index) => {
        base[index] += point.byProvider[provider] ?? 0;
      });
      const upper = [...base];
      const top = monotonePath(xs, upper.map(y));
      const bottom = monotonePath([...xs].reverse(), [...lower].reverse().map(y), false);
      return { provider, top, area: `${top} ${bottom} Z`, tops: upper.map(y) };
    });
  }, [points, providers, width, count, areaMax]);

  const hourTicks = useMemo(() => {
    if (count === 0) return [];
    const first = points[0].start;
    const last = points[count - 1].start + BUCKET_MS;
    const ticks: { x: number; label: string }[] = [];
    const hour = 60 * 60 * 1000;
    for (let tick = Math.ceil(first / hour) * hour; tick <= last; tick += hour) {
      ticks.push({ x: ((tick - first) / (last - first)) * 100, label: format.format(tick) });
    }
    return ticks.filter((tick) => tick.x > 4 && tick.x < 96);
  }, [points, count, format]);

  if (count === 0) {
    return <p className={styles.chartEmpty}>{t('prox.traffic_unavailable')}</p>;
  }

  const activePoint = active === null ? null : points[active];
  const barWidth = Math.min(MAX_BAR_WIDTH, Math.max(4, slot * 0.56));
  const pickIndex = (clientX: number) => {
    const rect = plot?.getBoundingClientRect();
    if (!rect || slot <= 0) return;
    setActive(Math.min(count - 1, Math.max(0, Math.floor((clientX - rect.left) / slot))));
  };
  const summary = t('prox.chart_summary', {
    total: traffic.total.toLocaleString(),
    success: traffic.success.toLocaleString(),
    failed: traffic.failed.toLocaleString(),
  });

  return (
    <figure className={styles.chart} aria-label={summary}>
      <div className={styles.chartTop}>
        <ul className={styles.legend}>
          {providers.map((provider) => (
            <li key={provider}>
              <i style={{ background: colorOf(provider) }} aria-hidden="true" />
              {getTypeLabel(t, provider)}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className={styles.textButton}
          aria-expanded={showTable}
          onClick={() => setShowTable((value) => !value)}
        >
          {showTable ? t('prox.hide_table') : t('prox.show_table')}
        </button>
      </div>

      <div className={styles.plotRow}>
        <div className={styles.yAxis} style={{ height: AREA_HEIGHT }} aria-hidden="true">
          <span style={{ top: 0 }}>{formatCompactNumber(areaMax)}</span>
          <span style={{ top: '50%' }}>{formatCompactNumber(areaMax / 2)}</span>
          <span style={{ top: '100%' }}>0</span>
        </div>
        <div
          ref={plotRef}
          className={styles.plot}
          onPointerMove={(event) => pickIndex(event.clientX)}
          onPointerDown={(event) => pickIndex(event.clientX)}
          onPointerLeave={() => setActive(null)}
        >
          {active !== null && (
            <span
              className={styles.hoverBand}
              style={{ left: active * slot, width: slot }}
              aria-hidden="true"
            />
          )}
          <svg width={width} height={AREA_HEIGHT} className={styles.svg} aria-hidden="true">
            <defs>
              {providers.map((provider, index) => (
                <linearGradient
                  key={provider}
                  id={`${gradientId}-${index}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={colorOf(provider)} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={colorOf(provider)} stopOpacity={0.03} />
                </linearGradient>
              ))}
            </defs>
            {[0, 0.5, 1].map((ratio) => (
              <line
                key={ratio}
                className={styles.gridLine}
                x1={0}
                x2={width}
                y1={ratio * AREA_HEIGHT}
                y2={ratio * AREA_HEIGHT}
              />
            ))}
            {bands.map((band, index) => (
              <g key={band.provider}>
                <path d={band.area} fill={`url(#${gradientId}-${index})`} />
                <path
                  d={band.top}
                  fill="none"
                  stroke={colorOf(band.provider)}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </g>
            ))}
            {active !== null &&
              bands.map((band) => (
                <circle
                  key={band.provider}
                  cx={xAt(active)}
                  cy={band.tops[active]}
                  r={4}
                  fill={colorOf(band.provider)}
                  className={styles.dot}
                />
              ))}
          </svg>
          {traffic.total === 0 && <p className={styles.noRequests}>{t('prox.no_requests')}</p>}
        </div>
      </div>

      <div className={styles.chartTop}>
        <ul className={styles.legend}>
          <li>
            <i className={styles.swatchSuccess} aria-hidden="true" />
            {t('stats.success')}
          </li>
          <li>
            <i className={styles.swatchFailure} aria-hidden="true" />
            {t('stats.failure')}
          </li>
        </ul>
      </div>
      <div className={styles.plotRow}>
        <div className={styles.yAxis} style={{ height: BARS_HEIGHT }} aria-hidden="true">
          <span style={{ top: 0 }}>{formatCompactNumber(barsMax)}</span>
          <span style={{ top: '100%' }}>0</span>
        </div>
        <div
          className={styles.plot}
          onPointerMove={(event) => pickIndex(event.clientX)}
          onPointerDown={(event) => pickIndex(event.clientX)}
          onPointerLeave={() => setActive(null)}
        >
          {active !== null && (
            <span
              className={styles.hoverBand}
              style={{ left: active * slot, width: slot }}
              aria-hidden="true"
            />
          )}
          <svg width={width} height={BARS_HEIGHT} className={styles.svg} aria-hidden="true">
            {[0, 1].map((ratio) => (
              <line
                key={ratio}
                className={styles.gridLine}
                x1={0}
                x2={width}
                y1={ratio * BARS_HEIGHT}
                y2={ratio * BARS_HEIGHT}
              />
            ))}
            {points.map((point, index) => {
              if (point.total === 0) return null;
              const x = xAt(index) - barWidth / 2;
              const successHeight = (point.success / barsMax) * BARS_HEIGHT;
              const failedHeight = (point.failed / barsMax) * BARS_HEIGHT;
              const gap = point.success > 0 && point.failed > 0 ? SEGMENT_GAP : 0;
              const successTop = BARS_HEIGHT - successHeight;
              return (
                <g key={point.start}>
                  {point.success > 0 && (
                    <path
                      className={styles.barSuccess}
                      d={columnPath(x, successTop, barWidth, successHeight, point.failed === 0)}
                    />
                  )}
                  {point.failed > 0 && (
                    <path
                      className={styles.barFailure}
                      d={columnPath(
                        x,
                        successTop - gap - Math.max(2, failedHeight),
                        barWidth,
                        Math.max(2, failedHeight),
                        true
                      )}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <div className={styles.xAxis} aria-hidden="true">
        {hourTicks.map((tick) => (
          <span key={tick.label} style={{ left: `${tick.x}%` }}>
            {tick.label}
          </span>
        ))}
      </div>

      {activePoint && (
        <div
          className={styles.tooltip}
          role="status"
          style={
            /* Beside the highlighted column, never over it. */
            active! < count / 2
              ? { left: `calc(var(--axis-width) + ${(active! + 1) * slot + 8}px)` }
              : { left: `calc(var(--axis-width) + ${active! * slot - 8}px)`, translate: '-100%' }
          }
        >
          <span className={styles.tooltipTitle}>{rangeLabel(activePoint)}</span>
          {providers.map((provider) => (
            <span key={provider} className={styles.tooltipRow}>
              <i style={{ background: colorOf(provider) }} aria-hidden="true" />
              {getTypeLabel(t, provider)}
              <b>{(activePoint.byProvider[provider] ?? 0).toLocaleString()}</b>
            </span>
          ))}
          <span className={styles.tooltipDivider} aria-hidden="true" />
          <span className={styles.tooltipRow}>
            <i className={styles.swatchSuccess} aria-hidden="true" />
            {t('stats.success')}
            <b>{activePoint.success.toLocaleString()}</b>
          </span>
          <span className={styles.tooltipRow}>
            <i className={styles.swatchFailure} aria-hidden="true" />
            {t('stats.failure')}
            <b>{activePoint.failed.toLocaleString()}</b>
          </span>
        </div>
      )}

      {showTable && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">{t('prox.table_time')}</th>
                {providers.map((provider) => (
                  <th key={provider} scope="col">
                    {getTypeLabel(t, provider)}
                  </th>
                ))}
                <th scope="col">{t('stats.success')}</th>
                <th scope="col">{t('stats.failure')}</th>
                <th scope="col">{t('dashboard.success_rate')}</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((point) => (
                <tr key={point.start}>
                  <th scope="row">{rangeLabel(point)}</th>
                  {providers.map((provider) => (
                    <td key={provider}>{(point.byProvider[provider] ?? 0).toLocaleString()}</td>
                  ))}
                  <td>{point.success.toLocaleString()}</td>
                  <td>{point.failed.toLocaleString()}</td>
                  <td>
                    {point.total > 0 ? formatPercent((point.success / point.total) * 100) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}

/** A column with a 4px rounded data end, square at the baseline side. */
function columnPath(x: number, y: number, w: number, h: number, roundTop: boolean): string {
  const r = roundTop ? Math.min(4, w / 2, h) : 0;
  return [
    `M${x},${y + h}`,
    `L${x},${y + r}`,
    r ? `Q${x},${y} ${x + r},${y}` : '',
    `L${x + w - r},${y}`,
    r ? `Q${x + w},${y} ${x + w},${y + r}` : '',
    `L${x + w},${y + h}`,
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
}
