/**
 * Quota windows timeline: lane derivation and window projection.
 *
 * Pure functions over board entries — no React, no clock of its own (`now` is
 * always passed in), so every case here is directly testable.
 *
 * The chart answers one question the cards can't: *when does capacity come
 * back, and does it come back all at once?* Four credentials all resetting on
 * the same evening is a very different situation from four staggered across a
 * week, and no per-card percentage shows that.
 */

import type { QuotaProviderKey } from './quotaSummary';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Weekly view spans a fortnight; the session view zooms to three days. */
export type TimelineMode = 'weekly' | 'session';

export const TIMELINE_SPAN_DAYS: Record<TimelineMode, number> = {
  weekly: 14,
  session: 3,
};

/** The rolling window the session view projects, in hours. */
const SESSION_PERIOD_HOURS = 5;

/** A limit summarized in the lane's left column. */
export interface TimelineLimit {
  label: string;
  /** Remaining percent, 0..100. */
  remaining: number;
}

/** One credential's row in the chart. */
export interface TimelineLane {
  name: string;
  displayName: string;
  provider: QuotaProviderKey;
  /** Instant a window boundary falls on; all other boundaries derive from it. */
  anchorMs: number | null;
  /** Window length in hours. */
  periodHours: number | null;
  /** Remaining percent for the window being drawn, or null when unknown. */
  remaining: number | null;
  limits: TimelineLimit[];
}

/** One drawn bar: a single window occurrence within the visible span. */
export interface TimelineWindow {
  startMs: number;
  endMs: number;
  /** Fractions of the span, 0..100, already clipped to the visible range. */
  leftPercent: number;
  widthPercent: number;
  state: 'past' | 'live' | 'next';
}

/**
 * Every window boundary of `periodMs` aligned to `anchorMs`, covering
 * [fromMs, toMs].
 *
 * The anchor is a known *reset* instant, so windows are projected backwards and
 * forwards from it by whole periods. Both directions matter: the visible span
 * usually starts before the current window opened, and the point of the chart
 * is what's coming.
 */
export function windowsIn(
  anchorMs: number,
  periodMs: number,
  fromMs: number,
  toMs: number
): { startMs: number; endMs: number }[] {
  if (!Number.isFinite(anchorMs) || !(periodMs > 0)) return [];
  if (!(toMs > fromMs)) return [];

  // Guard against a pathological period (a bad payload) turning this into a
  // multi-million-iteration loop.
  const maxWindows = Math.ceil((toMs - fromMs) / periodMs) + 2;
  if (maxWindows > 1000) return [];

  let end = anchorMs + Math.ceil((fromMs - anchorMs) / periodMs) * periodMs;
  const out: { startMs: number; endMs: number }[] = [];
  while (end - periodMs < toMs) {
    out.push({ startMs: end - periodMs, endMs: end });
    end += periodMs;
  }
  return out;
}

/** Start of the local day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Start of the local week (Sunday) containing `ms`. */
export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

/**
 * Visible span for a mode and offset.
 *
 * Weekly steps a week at a time from the containing Sunday; session steps a day
 * at a time from today. Uses date arithmetic rather than adding fixed
 * millisecond counts so a DST transition inside the span doesn't shift every
 * subsequent day by an hour.
 */
export function timelineSpan(
  mode: TimelineMode,
  offset: number,
  now: number
): { startMs: number; endMs: number; days: number } {
  const days = TIMELINE_SPAN_DAYS[mode];
  const base = new Date(mode === 'weekly' ? startOfWeek(now) : startOfDay(now));
  base.setDate(base.getDate() + offset * (mode === 'weekly' ? 7 : 1));
  const startMs = base.getTime();

  const end = new Date(startMs);
  end.setDate(end.getDate() + days);

  return { startMs, endMs: end.getTime(), days };
}

/**
 * Project one lane's windows onto a span, clipped and positioned.
 *
 * Windows falling entirely outside the span are dropped rather than returned
 * with a zero width, so a caller can treat an empty result as "nothing to draw".
 */
export function projectLane(
  lane: TimelineLane,
  spanStartMs: number,
  spanEndMs: number,
  now: number,
  mode: TimelineMode
): TimelineWindow[] {
  const periodHours = mode === 'session' ? SESSION_PERIOD_HOURS : lane.periodHours;
  if (lane.anchorMs === null || !periodHours) return [];

  const span = spanEndMs - spanStartMs;
  if (span <= 0) return [];

  const toPercent = (ms: number) => ((ms - spanStartMs) / span) * 100;

  return windowsIn(lane.anchorMs, periodHours * HOUR_MS, spanStartMs, spanEndMs)
    .map((window): TimelineWindow | null => {
      const left = Math.max(0, toPercent(window.startMs));
      const right = Math.min(100, toPercent(window.endMs));
      if (right <= 0 || left >= 100 || right <= left) return null;

      const state: TimelineWindow['state'] =
        window.endMs <= now ? 'past' : window.startMs <= now ? 'live' : 'next';

      return {
        startMs: window.startMs,
        endMs: window.endMs,
        leftPercent: left,
        widthPercent: right - left,
        state,
      };
    })
    .filter((window): window is TimelineWindow => window !== null);
}

/**
 * Pick the window a lane is drawn from: the one whose period best fits the
 * visible span, tie-broken by the soonest reset.
 *
 * A credential usually has several (5-hour, 7-day, per-model). Picking the
 * soonest reset outright looks right and renders uselessly: across a fortnight
 * the 5-hour window always resets first, so every lane becomes ~67 slivers
 * instead of two readable weekly bars. The long window is what a two-week view
 * is *for*; the session view exists precisely to see the short one.
 *
 * `maxPeriodHours` bounds what counts as fitting — the caller passes the span.
 * With nothing under the bound, the shortest available window is used rather
 * than drawing nothing.
 */
export function pickLaneWindow<T extends { resetAtMs?: number | null; periodHours?: number | null }>(
  windows: readonly T[],
  maxPeriodHours?: number
): T | null {
  const usable = windows.filter(
    (window) => typeof window.resetAtMs === 'number' && Number.isFinite(window.resetAtMs)
  );
  if (usable.length === 0) return null;

  const periodOf = (window: T) =>
    typeof window.periodHours === 'number' && window.periodHours > 0 ? window.periodHours : 0;

  const fitting =
    maxPeriodHours === undefined
      ? usable
      : usable.filter((window) => periodOf(window) <= maxPeriodHours);

  // Longest period that still fits; soonest reset breaks a tie.
  const pool = fitting.length > 0 ? fitting : usable;
  return pool.reduce((best, window) => {
    const byPeriod = periodOf(window) - periodOf(best);
    if (byPeriod !== 0) return byPeriod > 0 ? window : best;
    return (window.resetAtMs as number) < (best.resetAtMs as number) ? window : best;
  });
}

/* ------------------------------------------------------------------ lanes */

/** Shape the lane builder reads. Deliberately structural — see the note below. */
interface WindowLike {
  label?: string;
  usedPercent?: number | null;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

interface KimiRowLike {
  label?: string;
  labelKey?: string;
  used: number;
  limit: number;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

export interface TimelineLaneInput {
  name: string;
  displayName: string;
  provider: QuotaProviderKey;
  quota: { status?: string } | undefined;
  /**
   * Longest window period worth drawing, in hours — normally the visible span.
   * A window longer than the whole view can't show a boundary, and a much
   * shorter one degenerates into slivers.
   */
  maxPeriodHours?: number;
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

/**
 * Build a lane for one credential.
 *
 * Read structurally per provider rather than through a normalized model: the
 * five state shapes disagree about where a window lives and what its percentage
 * means, and flattening them would lose exactly the detail the chart needs.
 *
 * Providers that expose no usable reset instant (Antigravity's labels are
 * live-clock derived; xAI has no window data at all) produce a lane with a null
 * anchor. That renders as an explicitly empty row rather than being dropped —
 * a missing credential reads as an oversight, an empty one reads as "nothing
 * scheduled", which is the truth.
 */
export function buildTimelineLane(input: TimelineLaneInput): TimelineLane {
  const { name, displayName, provider, quota, maxPeriodHours } = input;
  const empty: TimelineLane = {
    name,
    displayName,
    provider,
    anchorMs: null,
    periodHours: null,
    remaining: null,
    limits: [],
  };

  if (!quota || quota.status !== 'success') return empty;

  if (provider === 'claude' || provider === 'codex') {
    const windows = ((quota as { windows?: WindowLike[] }).windows ?? []).filter(
      (window) => typeof window.resetAtMs === 'number'
    );
    const chosen = pickLaneWindow(windows, maxPeriodHours);
    if (!chosen) return empty;

    return {
      ...empty,
      anchorMs: chosen.resetAtMs ?? null,
      periodHours: chosen.periodHours ?? null,
      // Claude and Codex store percent USED.
      remaining:
        typeof chosen.usedPercent === 'number' ? clampPercent(100 - chosen.usedPercent) : null,
      limits: windows
        .filter((window) => typeof window.usedPercent === 'number')
        .map((window) => ({
          label: window.label ?? '',
          remaining: clampPercent(100 - (window.usedPercent as number)),
        })),
    };
  }

  if (provider === 'kimi') {
    const rows = ((quota as { rows?: KimiRowLike[] }).rows ?? []).filter(
      (row) => typeof row.resetAtMs === 'number'
    );
    const chosen = pickLaneWindow(rows, maxPeriodHours);
    if (!chosen) return empty;

    // Kimi reports raw counts; remaining is derived.
    const remainingOf = (row: KimiRowLike) =>
      row.limit > 0 ? clampPercent(Math.round(((row.limit - row.used) / row.limit) * 100)) : null;

    return {
      ...empty,
      anchorMs: chosen.resetAtMs ?? null,
      periodHours: chosen.periodHours ?? null,
      remaining: remainingOf(chosen),
      limits: rows
        .map((row) => ({ label: row.label ?? '', remaining: remainingOf(row) }))
        .filter((limit): limit is TimelineLimit => limit.remaining !== null),
    };
  }

  return empty;
}

