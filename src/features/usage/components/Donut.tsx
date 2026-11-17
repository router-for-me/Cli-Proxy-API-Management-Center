import { useState } from 'react';
import type { ShareRow } from '../usageModel';
import styles from './Donut.module.scss';

const SIZE = 168;
const STROKE = 22;
const GAP_DEG = 1.6;

interface DonutProps {
  rows: ShareRow[];
  colorOf: (id: string) => string;
  format: (value: number) => string;
  centerLabel: string;
  centerValue: string;
  emptyText: string;
  ariaLabel: string;
  onSelect?: (id: string) => void;
}

const polar = (cx: number, cy: number, r: number, deg: number) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

function arcPath(start: number, end: number): string {
  const r = (SIZE - STROKE) / 2;
  const c = SIZE / 2;
  const a = polar(c, c, r, start);
  const b = polar(c, c, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M${a.x.toFixed(2)},${a.y.toFixed(2)} A${r},${r} 0 ${large} 1 ${b.x.toFixed(2)},${b.y.toFixed(2)}`;
}

/** Donut with a legend list: share of a whole, center shows the total or the hovered item. */
export function Donut({
  rows,
  colorOf,
  format,
  centerLabel,
  centerValue,
  emptyText,
  ariaLabel,
  onSelect,
}: DonutProps) {
  const [active, setActive] = useState<string | null>(null);
  const activeRow = rows.find((row) => row.id === active) ?? null;
  const gap = rows.length > 1 ? GAP_DEG : 0;

  const arcs = rows.map((row, index) => {
    const offset = rows.slice(0, index).reduce((sum, r) => sum + r.share * 360, 0);
    const sweep = row.share * 360;
    const start = offset + gap / 2;
    const end = Math.max(start + 0.4, offset + sweep - gap / 2);
    return { row, start, end: Math.min(end, start + 359.99) };
  });

  return (
    <div className={styles.wrap}>
      <div className={styles.chart}>
        <svg width={SIZE} height={SIZE} role="img" aria-label={ariaLabel}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={(SIZE - STROKE) / 2}
            className={styles.track}
            strokeWidth={STROKE}
          />
          {arcs.map(({ row, start, end }) => (
            <path
              key={row.id}
              d={arcPath(start, end)}
              stroke={colorOf(row.id)}
              strokeWidth={active === row.id ? STROKE + 4 : STROKE}
              className={`${styles.arc} ${active && active !== row.id ? styles.dimmed : ''}`}
              onMouseEnter={() => setActive(row.id)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
        </svg>
        <div className={styles.center}>
          <span className={styles.centerLabel}>
            {activeRow ? `${(activeRow.share * 100).toFixed(1)}%` : centerLabel}
          </span>
          <strong className={styles.centerValue}>
            {activeRow ? format(activeRow.value) : centerValue}
          </strong>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <ul className={styles.legend}>
          {rows.map((row) => {
            const content = (
              <>
                <span className={styles.dot} style={{ background: colorOf(row.id) }} />
                <span className={styles.label} title={row.label}>
                  {row.label}
                </span>
                <span className={styles.value}>{format(row.value)}</span>
                <span className={styles.share}>{(row.share * 100).toFixed(1)}%</span>
              </>
            );
            return (
              <li
                key={row.id}
                className={active === row.id ? styles.legendActive : undefined}
                onMouseEnter={() => setActive(row.id)}
                onMouseLeave={() => setActive(null)}
              >
                {onSelect ? (
                  <button
                    type="button"
                    className={styles.legendRow}
                    onClick={() => onSelect(row.id)}
                    onFocus={() => setActive(row.id)}
                    onBlur={() => setActive(null)}
                  >
                    {content}
                  </button>
                ) : (
                  <div className={styles.legendRow}>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
