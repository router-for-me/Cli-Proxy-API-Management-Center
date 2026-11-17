import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TrendSlot } from '../usageModel';
import { useElementWidth } from './useElementWidth';
import styles from './TrendChart.module.scss';

const HEIGHT = 260;
const MARGIN = { top: 12, right: 8, bottom: 26, left: 56 };
const TICKS = 4;
const GAP = 2;

export interface SeriesInfo {
  id: string;
  label: string;
  color: string;
}

interface TrendChartProps {
  slots: TrendSlot[];
  /** Bottom-to-top stack order; also the legend order. */
  series: SeriesInfo[];
  format: (value: number) => string;
  ariaLabel: string;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const raw = value / TICKS;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  return step * TICKS;
}

/** Bar outline with only the top corners rounded (data end), square on the baseline. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return [
    `M${x},${y + h}`,
    `V${y + rr}`,
    `Q${x},${y} ${x + rr},${y}`,
    `H${x + w - rr}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `V${y + h}`,
    'Z',
  ].join(' ');
}

export function TrendChart({ slots, series, format, ariaLabel }: TrendChartProps) {
  const { t } = useTranslation();
  const [wrapRef, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const plotW = Math.max(width - MARGIN.left - MARGIN.right, 40);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const maxTotal = useMemo(() => Math.max(0, ...slots.map((s) => s.total)), [slots]);
  const yMax = niceMax(maxTotal);
  const band = slots.length > 0 ? plotW / slots.length : plotW;
  const barW = Math.max(2, Math.min(band * 0.7, 40));
  const labelStep = Math.max(1, Math.ceil(slots.length / Math.max(1, Math.floor(plotW / 46))));
  const baseY = MARGIN.top + plotH;
  const scale = (v: number) => (v / yMax) * plotH;

  const activeSlot = active !== null ? slots[active] : null;
  // Open the tooltip beside the hovered column so it never covers the bars being read.
  const columnX = active !== null ? MARGIN.left + band * active + band / 2 : 0;
  const anchorRight = columnX > width / 2;
  const tooltipStyle = anchorRight
    ? { left: Math.max(columnX - band / 2 - 8, 0), transform: 'translateX(-100%)' }
    : { left: Math.min(columnX + band / 2 + 8, width) };

  return (
    <div className={styles.wrap} ref={wrapRef} onMouseLeave={() => setActive(null)}>
      <svg className={styles.svg} width={width} height={HEIGHT} role="img" aria-label={ariaLabel}>
        {Array.from({ length: TICKS + 1 }, (_, i) => {
          const value = (yMax / TICKS) * i;
          const y = baseY - scale(value);
          return (
            <g key={i}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotW}
                y1={y}
                y2={y}
                className={i === 0 ? styles.baseline : styles.grid}
              />
              <text x={MARGIN.left - 8} y={y} className={styles.yLabel} dominantBaseline="middle">
                {format(value)}
              </text>
            </g>
          );
        })}

        {slots.map((slot, index) => {
          const x = MARGIN.left + band * index + (band - barW) / 2;
          const present = series.filter((s) => (slot.values.get(s.id) ?? 0) > 0);
          let cum = 0;
          return (
            <g
              key={slot.key}
              className={active !== null && active !== index ? styles.dimmed : undefined}
            >
              {present.map((s, k) => {
                const h = scale(slot.values.get(s.id) ?? 0);
                const bottom = baseY - cum;
                cum += h;
                const isTop = k === present.length - 1;
                const top = bottom - h + (isTop ? 0 : GAP);
                const height = bottom - top;
                if (height <= 0.3) return null;
                return isTop ? (
                  <path key={s.id} d={topRounded(x, top, barW, height, 4)} fill={s.color} />
                ) : (
                  <rect key={s.id} x={x} y={top} width={barW} height={height} fill={s.color} />
                );
              })}
            </g>
          );
        })}

        {slots.map((slot, index) =>
          index % labelStep === 0 || index === slots.length - 1 ? (
            <text
              key={slot.key}
              x={MARGIN.left + band * index + band / 2}
              y={baseY + 16}
              className={`${styles.xLabel} ${slot.future ? styles.future : ''}`}
              textAnchor="middle"
            >
              {slot.label}
            </text>
          ) : null
        )}

        {slots.map((slot, index) => (
          <rect
            key={slot.key}
            x={MARGIN.left + band * index}
            y={MARGIN.top}
            width={band}
            height={plotH}
            className={styles.hit}
            tabIndex={slot.future ? -1 : 0}
            aria-label={`${slot.title}: ${format(slot.total)}`}
            onMouseEnter={() => setActive(slot.future ? null : index)}
            onFocus={() => setActive(slot.future ? null : index)}
            onBlur={() => setActive(null)}
          />
        ))}
      </svg>

      {maxTotal <= 0 && <div className={styles.empty}>{t('usage_page.chart_empty')}</div>}

      {activeSlot && (
        <div className={styles.tooltip} style={tooltipStyle} role="status">
          <div className={styles.tooltipTitle}>{activeSlot.title}</div>
          <div className={styles.tooltipTotal}>
            <strong>{format(activeSlot.total)}</strong>
            <span>{t('usage_page.tooltip_total')}</span>
          </div>
          {series
            .map((s) => ({ s, v: activeSlot.values.get(s.id) ?? 0 }))
            .filter(({ v }) => v > 0)
            .sort((a, b) => b.v - a.v)
            .map(({ s, v }) => (
              <div key={s.id} className={styles.tooltipRow}>
                <span className={styles.tooltipKey} style={{ background: s.color }} />
                <strong>{format(v)}</strong>
                <span className={styles.tooltipLabel}>{s.label}</span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export function SeriesLegend({ series }: { series: SeriesInfo[] }) {
  return (
    <ul className={styles.legend}>
      {series.map((s) => (
        <li key={s.id}>
          <span className={styles.legendSwatch} style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}
