/**
 * Quota windows timeline.
 *
 * The cards answer "how much is left"; this answers "when does it come back,
 * and does it all come back at once". Four credentials resetting the same
 * evening is a very different position from four staggered across a week, and
 * no per-card percentage shows that.
 *
 * All projection maths lives in quotaTimelineModel.ts — this file is layout
 * only. (The model is named ...Model rather than matching this component,
 * because a case-insensitive filesystem cannot hold both QuotaTimeline.tsx and
 * quotaTimeline.ts.)
 */

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { TYPE_COLORS } from '@/utils/quota';
import type { ResolvedTheme, ThemeColors } from '@/types';
import {
  buildTimelineLane,
  projectLane,
  timelineSpan,
  DAY_MS,
} from './quotaTimelineModel';
import type { TimelineLane, TimelineMode } from './quotaTimelineModel';
import type { QuotaBoardEntry } from './useQuotaBoard';
import styles from './QuotaTimeline.module.scss';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const pad = (value: number) => String(value).padStart(2, '0');
const formatDay = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
};
const formatTime = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export interface QuotaTimelineProps {
  entries: QuotaBoardEntry[];
  displayNameFor: (name: string) => string;
  resolvedTheme: ResolvedTheme;
  /** Injectable for tests/screenshots; defaults to the real clock. */
  now?: number;
}

export function QuotaTimeline({
  entries,
  displayNameFor,
  resolvedTheme,
  now: nowProp,
}: QuotaTimelineProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<TimelineMode>('weekly');
  const [offset, setOffset] = useState(0);

  // The clock is state, not a read during render: bars are classified
  // past/live/next against it and the marker is positioned by it, so it has to
  // advance on its own or the chart quietly goes stale on a long-lived tab.
  // A minute is finer than any window boundary here (the shortest is 5 hours).
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (nowProp !== undefined) return; // fixed clock: tests and screenshots
    const id = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [nowProp]);

  const now = nowProp ?? tick;

  const span = useMemo(() => timelineSpan(mode, offset, now), [mode, offset, now]);

  const lanes = useMemo(
    () =>
      entries.map((entry) =>
        buildTimelineLane({
          name: entry.file.name,
          displayName: displayNameFor(entry.file.name),
          provider: entry.provider,
          quota: entry.quota,
          // Bound the lane's window to the visible span, so a fortnight view
          // draws weekly bars rather than ~67 five-hour slivers.
          maxPeriodHours: span.days * 24,
        })
      ),
    [entries, displayNameFor, span.days]
  );

  /** Weekly: one cell per day. Session: one per 6 hours. */
  const cells = useMemo(() => {
    const zoomed = mode === 'session';
    const count = zoomed ? span.days * 4 : span.days;
    const cellMs = (span.endMs - span.startMs) / count;
    const todayStart = new Date(now).setHours(0, 0, 0, 0);

    return Array.from({ length: count }, (_, index) => {
      const at = span.startMs + index * cellMs;
      const date = new Date(at);
      const isDayStart = !zoomed || date.getHours() === 0;
      return {
        at,
        isDayStart,
        isToday: new Date(at).setHours(0, 0, 0, 0) === todayStart,
        isWeekend: date.getDay() === 0 || date.getDay() === 6,
        weekday: t(`quota_management.weekday_${WEEKDAY_KEYS[date.getDay()]}`, {
          defaultValue: WEEKDAY_KEYS[date.getDay()],
        }),
        label: isDayStart ? formatDay(at) : `${pad(date.getHours())}:00`,
      };
    });
  }, [mode, span, now, t]);

  // Only draw the marker when the current moment is actually on screen.
  const nowPercent =
    now >= span.startMs && now < span.endMs
      ? ((now - span.startMs) / (span.endMs - span.startMs)) * 100
      : null;

  if (lanes.length === 0) return null;

  return (
    <section className={styles.timeline}>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>
            {t('quota_management.windows_title', { defaultValue: 'Quota windows' })}
          </h2>
          <p className={styles.range}>
            {formatDay(span.startMs)} – {formatDay(span.endMs - DAY_MS)}
            {' · '}
            {mode === 'weekly'
              ? t('quota_management.windows_span_weekly', { defaultValue: 'two weeks' })
              : t('quota_management.windows_span_session', { defaultValue: 'three days' })}
            {offset === 0 && ` · ${t('quota_management.windows_current', { defaultValue: 'current' })}`}
          </p>
        </div>

        <div className={styles.controls}>
          <div className={styles.nav}>
            <button
              type="button"
              onClick={() => setOffset((value) => value - 1)}
              aria-label={t('quota_management.windows_prev', { defaultValue: 'Previous' })}
            >
              ‹
            </button>
            <button type="button" onClick={() => setOffset(0)} disabled={offset === 0}>
              {t('quota_management.windows_today', { defaultValue: 'Today' })}
            </button>
            <button
              type="button"
              onClick={() => setOffset((value) => value + 1)}
              aria-label={t('quota_management.windows_next', { defaultValue: 'Next' })}
            >
              ›
            </button>
          </div>

          <div className={styles.modes} role="group">
            {(['weekly', 'session'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  setOffset(0); // spans differ in size; an old offset means nothing
                }}
              >
                {value === 'weekly'
                  ? t('quota_management.windows_mode_weekly', { defaultValue: 'Weekly' })
                  : t('quota_management.windows_mode_session', { defaultValue: '5-hour' })}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className={styles.chart}>
        <div className={styles.axis}>
          <div className={styles.axisLabel}>
            {t('quota_management.windows_credential', { defaultValue: 'Credential' })}
          </div>
          <div className={styles.axisCells}>
            {cells.map((cell) => (
              <div
                key={cell.at}
                className={styles.axisCell}
                data-today={cell.isToday ? 1 : 0}
                data-weekend={cell.isWeekend ? 1 : 0}
                data-daystart={cell.isDayStart ? 1 : 0}
              >
                <span className={styles.axisWeekday}>{cell.isDayStart ? cell.weekday : ''}</span>
                <span className={styles.axisDate}>{cell.label}</span>
              </div>
            ))}
          </div>
        </div>

        {lanes.map((lane) => (
          <Lane
            key={lane.name}
            lane={lane}
            span={span}
            now={now}
            mode={mode}
            cells={cells}
            nowPercent={nowPercent}
            resolvedTheme={resolvedTheme}
          />
        ))}
      </div>

      <footer className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchLive}`} />
          {t('quota_management.windows_legend_current', { defaultValue: 'current window' })}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchNext}`} />
          {t('quota_management.windows_legend_upcoming', { defaultValue: 'upcoming' })}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchPast}`} />
          {t('quota_management.windows_legend_elapsed', { defaultValue: 'elapsed' })}
        </span>
        <span className={styles.legendNote}>
          {mode === 'weekly'
            ? t('quota_management.windows_note_weekly', {
                defaultValue:
                  'Each bar is one full quota window, drawn from when it opened to when it resets. Lanes ending together compete for the same days.',
              })
            : t('quota_management.windows_note_session', {
                defaultValue:
                  'Each bar is one 5-hour window. Only credentials with a window counting down can be projected; the rest stay empty rather than invented.',
              })}
        </span>
      </footer>
    </section>
  );
}

interface LaneProps {
  lane: TimelineLane;
  span: { startMs: number; endMs: number; days: number };
  now: number;
  mode: TimelineMode;
  cells: { at: number; isWeekend: boolean; isDayStart: boolean }[];
  nowPercent: number | null;
  resolvedTheme: ResolvedTheme;
}

function Lane({ lane, span, now, mode, cells, nowPercent, resolvedTheme }: LaneProps) {
  const { t } = useTranslation();

  const windows = useMemo(
    () => projectLane(lane, span.startMs, span.endMs, now, mode),
    [lane, span, now, mode]
  );

  const colorSet = TYPE_COLORS[lane.provider] || TYPE_COLORS.unknown;
  const color: ThemeColors =
    resolvedTheme === 'dark' && colorSet.dark ? colorSet.dark : colorSet.light;

  // Sub-day windows are labelled in hours — rounding 5h to days gives "0d".
  const periodLabel =
    mode === 'session'
      ? '5h'
      : !lane.periodHours
        ? ''
        : lane.periodHours < 24
          ? `${Math.round(lane.periodHours)}h`
          : `${Math.round(lane.periodHours / 24)}d`;

  return (
    <div className={styles.lane} style={{ '--provider-accent': color.text } as CSSProperties}>
      <div className={styles.laneHead}>
        <div className={styles.laneTop}>
          <span className={styles.laneDot} />
          <span className={styles.laneName} title={lane.displayName}>
            {lane.displayName}
          </span>
          {periodLabel && <span className={styles.lanePeriod}>{periodLabel}</span>}
        </div>
        <div className={styles.laneLimits}>
          {lane.limits.map((limit) => (
            <span key={limit.label} className={styles.laneLimit}>
              {limit.label} <b>{limit.remaining}%</b>
            </span>
          ))}
        </div>
      </div>

      <div className={styles.track}>
        <div className={styles.trackGrid}>
          {cells.map((cell) => (
            <span
              key={cell.at}
              data-weekend={cell.isWeekend ? 1 : 0}
              data-daystart={cell.isDayStart ? 1 : 0}
            />
          ))}
        </div>

        {nowPercent !== null && (
          <div className={styles.nowLine} style={{ left: `${nowPercent}%` }} />
        )}

        {windows.length === 0 ? (
          <span className={styles.laneIdle}>
            {t('quota_management.windows_idle', {
              defaultValue: 'no window counting down',
            })}
          </span>
        ) : (
          windows.map((window) => {
            // A label needs room to read; below that the bar speaks for itself
            // and the detail lives in the tooltip.
            const showLabel = window.widthPercent > (mode === 'session' ? 4.5 : 9);
            const endText =
              mode === 'session'
                ? formatTime(window.endMs)
                : `${formatDay(window.endMs)} ${formatTime(window.endMs)}`;

            return (
              <div
                key={window.startMs}
                className={`${styles.window} ${styles[`window${capitalize(window.state)}`]}`}
                style={{ left: `${window.leftPercent}%`, width: `${window.widthPercent}%` }}
                title={`${lane.displayName}\n${formatDay(window.startMs)} ${formatTime(
                  window.startMs
                )} → ${formatDay(window.endMs)} ${formatTime(window.endMs)}${
                  window.state === 'live' && lane.remaining !== null
                    ? `\n${lane.remaining}% remaining`
                    : ''
                }`}
              >
                {/* Consumed portion of the *current* window only — a past or
                    future window has no meaningful fill. */}
                {window.state === 'live' && lane.remaining !== null && (
                  <span
                    className={styles.windowFill}
                    style={{ width: `${100 - lane.remaining}%` }}
                  />
                )}
                {showLabel && (
                  <span className={styles.windowLabel}>
                    {window.state === 'live' && lane.remaining !== null
                      ? `${lane.remaining}% · `
                      : ''}
                    {endText}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
