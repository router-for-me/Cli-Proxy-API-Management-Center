import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react';
import { sumSeries, valueAt, type SeriesPoint } from './model';
import { formatWeekdayTime } from './format';
import styles from './ForecastChart.module.scss';

export type ChartLayer = { recorded: SeriesPoint[]; projected: SeriesPoint[] };

/** One account in the stacked breakdown; values are own-percent, scaled by `weight`. */
export type ChartBand = ChartLayer & { key: string; name: string; color: string; weight: number };

export type ChartAnnotation = { t: number; v: number; label: string };

export type ForecastChartProps = {
  from: number;
  to: number;
  now: number;
  yMax: number;
  yTicks: number[];
  formatValue: (value: number) => string;
  color: string;
  pool: ChartLayer;
  bands: ChartBand[] | null;
  annotations: ChartAnnotation[];
  emptyMarker: { t: number; label: string } | null;
  dayTicks: { t: number; label: string }[];
  locale: string;
  ariaLabel: string;
  labels: { now: string; pool: string; projected: string };
};

const HEIGHT = 276;
const PLOT_TOP = 24;
const PLOT_HEIGHT = 224;
const PLOT_LEFT = 58;
const PLOT_RIGHT_GAP = 13;
const ANNOTATION_GAP = 8;
const DAY_LABEL_MIN_PX = 56;

const pathOf = (points: { x: number; y: number }[]) =>
  points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');

export function ForecastChart(props: ForecastChartProps) {
  const { from, to, now, yMax, yTicks, formatValue, color, pool, bands, annotations } = props;
  const { emptyMarker, dayTicks, locale, ariaLabel, labels } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, '');

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const plotRight = Math.max(PLOT_LEFT + 1, width - PLOT_RIGHT_GAP);
  const plotWidth = plotRight - PLOT_LEFT;
  const plotBottom = PLOT_TOP + PLOT_HEIGHT;
  const x = (t: number) => PLOT_LEFT + ((t - from) / (to - from)) * plotWidth;
  const y = (v: number) => PLOT_TOP + (1 - Math.min(Math.max(v / yMax, 0), 1)) * PLOT_HEIGHT;
  // Label every day when there is room, otherwise every second or third day.
  const dayLabelStep = Math.max(
    1,
    Math.ceil(DAY_LABEL_MIN_PX / (plotWidth / Math.max(1, dayTicks.length)))
  );
  const toXY = (series: SeriesPoint[]) => series.map((p) => ({ x: x(p.t), y: y(p.v) }));
  const area = (series: SeriesPoint[]) => {
    if (series.length < 2) return '';
    const pts = toXY(series);
    return `${pathOf(pts)}L${pts[pts.length - 1].x.toFixed(1)},${plotBottom}L${pts[0].x.toFixed(1)},${plotBottom}Z`;
  };

  // Stacked breakdown: band k spans the sum of accounts [0, k).. [0, k].
  const stacked = useMemo(() => {
    if (!bands || bands.length === 0) return null;
    const stack = (part: 'recorded' | 'projected') => {
      let lower: SeriesPoint[] = [];
      return bands.map((band, index) => {
        const upper = sumSeries(
          bands.slice(0, index + 1).map((item) => ({ series: item[part], weight: item.weight }))
        );
        const result = { key: band.key, color: band.color, upper, lower };
        lower = upper;
        return result;
      });
    };
    return { recorded: stack('recorded'), projected: stack('projected') };
  }, [bands]);

  const nowVisible = now >= from && now <= to;

  const placedAnnotations = useMemo(() => {
    const nowX = PLOT_LEFT + ((now - from) / (to - from)) * plotWidth;
    const placed: { x: number; y: number; label: string; anchor: 'middle' | 'end' }[] = [];
    [...annotations]
      .sort((a, b) => a.t - b.t)
      .forEach((annotation) => {
        let ax = PLOT_LEFT + ((annotation.t - from) / (to - from)) * plotWidth;
        let ay = PLOT_TOP + (1 - Math.min(Math.max(annotation.v / yMax, 0), 1)) * PLOT_HEIGHT;
        ay -= ANNOTATION_GAP;
        let anchor: 'middle' | 'end' = 'middle';
        if (nowVisible && Math.abs(ax - nowX) < 40 && ay < PLOT_TOP + 2) {
          // Keep clear of the "Now" label: tuck the label left of the jump, inside the plot.
          ax -= 6;
          ay = PLOT_TOP + 14;
          anchor = 'end';
        }
        const collides = (y: number) =>
          placed.some((other) => Math.abs(other.x - ax) < 44 && Math.abs(other.y - y) < 14);
        // Lift once past a neighbour; if that still collides, the tooltip carries it.
        if (collides(ay)) ay -= 14;
        if (collides(ay) || ay < PLOT_TOP - 22) return;
        placed.push({ x: ax, y: ay, label: annotation.label, anchor });
      });
    return placed;
  }, [annotations, from, now, nowVisible, to, plotWidth, yMax]);

  const nowValue = pool.recorded.length > 0 ? pool.recorded[pool.recorded.length - 1].v : null;

  const handlePointerMove = (event: PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    setHoverT(from + Math.min(Math.max(ratio, 0), 1) * (to - from));
  };

  const hover = useMemo(() => {
    if (hoverT === null) return null;
    const projected = hoverT > now;
    const layer = projected ? pool.projected : pool.recorded;
    if (layer.length === 0 || hoverT < layer[0].t || hoverT > layer[layer.length - 1].t) {
      return null;
    }
    const value = valueAt(layer, hoverT);
    const rows = (bands ?? []).map((band) => {
      const series = projected ? band.projected : band.recorded;
      return {
        key: band.key,
        name: band.name,
        color: band.color,
        value: band.weight * valueAt(series, hoverT),
      };
    });
    return { t: hoverT, projected, value, rows };
  }, [bands, hoverT, now, pool]);

  return (
    <div className={styles.chart} ref={containerRef} style={{ height: HEIGHT }}>
      {width > 0 && (
        <svg
          className={styles.svg}
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={ariaLabel}
          style={{ '--series-color': color } as CSSProperties}
        >
          <defs>
            <linearGradient
              id={gradientId}
              x1="0"
              y1={PLOT_TOP}
              x2="0"
              y2={plotBottom}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor={color} stopOpacity={0.22} />
              <stop offset="85%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          {dayTicks.map((tick) => (
            <line
              key={`grid-${tick.t}`}
              className={styles.dayGrid}
              x1={x(tick.t)}
              x2={x(tick.t)}
              y1={PLOT_TOP}
              y2={plotBottom}
            />
          ))}
          {yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                className={styles.valueGrid}
                x1={PLOT_LEFT}
                x2={plotRight}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                className={styles.axisLabel}
                x={PLOT_LEFT - 11}
                y={y(tick)}
                dy="0.35em"
                textAnchor="end"
              >
                {formatValue(tick)}
              </text>
            </g>
          ))}
          {dayTicks.map((tick, index) => {
            const center = x(tick.t + 12 * 60 * 60 * 1000);
            if (center > plotRight || index % dayLabelStep !== 0) return null;
            return (
              <text
                key={`day-${tick.t}`}
                className={styles.dayLabel}
                x={center}
                y={plotBottom + 17}
                textAnchor="middle"
              >
                {tick.label}
              </text>
            );
          })}

          {stacked ? (
            <>
              {stacked.recorded.map((band) => (
                <BandShape
                  key={`r-${band.key}`}
                  band={band}
                  x={x}
                  y={y}
                  opacity={0.32}
                  dashed={false}
                />
              ))}
              {stacked.projected.map((band) => (
                <BandShape key={`p-${band.key}`} band={band} x={x} y={y} opacity={0.16} dashed />
              ))}
            </>
          ) : (
            <>
              <path className={styles.area} d={area(pool.recorded)} fill={`url(#${gradientId})`} />
              <path
                className={styles.area}
                d={area(pool.projected)}
                fill={`url(#${gradientId})`}
                opacity={0.45}
              />
            </>
          )}

          <path className={styles.recordedLine} d={pathOf(toXY(pool.recorded))} />
          <path className={styles.projectedLine} d={pathOf(toXY(pool.projected))} />

          {placedAnnotations.map((annotation) => (
            <text
              key={`a-${annotation.x}-${annotation.label}`}
              className={styles.annotation}
              x={annotation.x}
              y={annotation.y}
              textAnchor={annotation.anchor}
            >
              {annotation.label}
            </text>
          ))}

          {nowVisible && (
            <g>
              <line
                className={styles.nowLine}
                x1={x(now)}
                x2={x(now)}
                y1={PLOT_TOP - 9}
                y2={HEIGHT - 2}
              />
              <text className={styles.nowLabel} x={x(now)} y={PLOT_TOP - 15} textAnchor="middle">
                {labels.now}
              </text>
              {nowValue !== null && (
                <circle className={styles.nowDot} cx={x(now)} cy={y(nowValue)} r={4.5} />
              )}
            </g>
          )}

          {emptyMarker && emptyMarker.t >= from && emptyMarker.t <= to && (
            <g>
              <text
                className={styles.emptyLabel}
                x={x(emptyMarker.t)}
                y={plotBottom - 15}
                textAnchor="middle"
              >
                {emptyMarker.label}
              </text>
              <circle className={styles.emptyDot} cx={x(emptyMarker.t)} cy={plotBottom} r={5.5} />
            </g>
          )}

          {hover && (
            <g pointerEvents="none">
              <line
                className={styles.crosshair}
                x1={x(hover.t)}
                x2={x(hover.t)}
                y1={PLOT_TOP}
                y2={plotBottom}
              />
              <circle className={styles.hoverDot} cx={x(hover.t)} cy={y(hover.value)} r={4} />
            </g>
          )}

          <rect
            className={styles.hitArea}
            x={PLOT_LEFT}
            y={PLOT_TOP}
            width={plotWidth}
            height={PLOT_HEIGHT}
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setHoverT(null)}
          />
        </svg>
      )}

      {hover && (
        <div
          className={styles.tooltip}
          style={{
            left: Math.min(x(hover.t) + 12, width - 220),
            top: PLOT_TOP + 4,
          }}
          role="status"
        >
          <div className={styles.tooltipTime}>
            {formatWeekdayTime(hover.t, locale)}
            {hover.projected && <span className={styles.tooltipTag}>{labels.projected}</span>}
          </div>
          <div className={styles.tooltipRow}>
            <span className={styles.tooltipSwatch} style={{ background: color }} />
            <strong>{formatValue(hover.value)}</strong>
            <span className={styles.tooltipName}>{labels.pool}</span>
          </div>
          {hover.rows.map((row) => (
            <div key={row.key} className={styles.tooltipRow}>
              <span className={styles.tooltipSwatch} style={{ background: row.color }} />
              <strong>{formatValue(row.value)}</strong>
              <span className={styles.tooltipName}>{row.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type StackedBand = { key: string; color: string; upper: SeriesPoint[]; lower: SeriesPoint[] };

function BandShape({
  band,
  x,
  y,
  opacity,
  dashed,
}: {
  band: StackedBand;
  x: (t: number) => number;
  y: (v: number) => number;
  opacity: number;
  dashed: boolean;
}) {
  if (band.upper.length < 2) return null;
  const upper = band.upper.map((p) => ({ x: x(p.t), y: y(p.v) }));
  const lower =
    band.lower.length > 0
      ? band.lower.map((p) => ({ x: x(p.t), y: y(p.v) })).reverse()
      : [
          { x: upper[upper.length - 1].x, y: y(0) },
          { x: upper[0].x, y: y(0) },
        ];
  const d = `${pathOf(upper)}${lower.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')}Z`;
  return (
    <g>
      <path d={d} fill={band.color} fillOpacity={opacity} />
      <path
        d={pathOf(upper)}
        fill="none"
        stroke={band.color}
        strokeWidth={1}
        strokeDasharray={dashed ? '4 3' : undefined}
        strokeOpacity={0.9}
      />
    </g>
  );
}
