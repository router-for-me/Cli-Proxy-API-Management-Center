import { describe, expect, test } from 'bun:test';
import {
  DAY_MS,
  HOUR_MS,
  buildTimelineLane,
  pickLaneWindow,
  projectLane,
  startOfDay,
  startOfWeek,
  timelineSpan,
  windowsIn,
} from '../src/components/quota/quotaTimelineModel';
import type { TimelineLane } from '../src/components/quota/quotaTimelineModel';

const at = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m, d, h, min).getTime();

describe('windowsIn', () => {
  test('projects backwards and forwards from the anchor', () => {
    // Anchor is a known reset; the span opens before the current window did.
    const anchor = at(2026, 6, 29, 12);
    const from = anchor - 2.5 * DAY_MS;
    const to = anchor + 1.5 * DAY_MS;

    const windows = windowsIn(anchor, DAY_MS, from, to);

    // A 4-day span of daily windows needs 5 bars: the span edges fall mid-window,
    // so there's a partial window at each end.
    expect(windows.length).toBe(5);
    // Every boundary sits on a whole period from the anchor.
    for (const window of windows) {
      // `+ 0` normalizes JS's -0 from a negative remainder (windows before the anchor).
      expect(((window.endMs - anchor) % DAY_MS) + 0).toBe(0);
      expect(window.endMs - window.startMs).toBe(DAY_MS);
    }
    expect(windows.some((w) => w.startMs <= anchor && w.endMs >= anchor)).toBe(true);
    // Fully covers the requested range.
    expect(windows[0].startMs).toBeLessThanOrEqual(from);
    expect(windows[windows.length - 1].endMs).toBeGreaterThanOrEqual(to);
  });

  test('covers the whole span with no gaps or overlaps', () => {
    const windows = windowsIn(at(2026, 6, 29), 5 * HOUR_MS, at(2026, 6, 28), at(2026, 6, 30));
    for (let i = 1; i < windows.length; i += 1) {
      expect(windows[i].startMs).toBe(windows[i - 1].endMs);
    }
  });

  test('rejects a degenerate period, span or anchor', () => {
    expect(windowsIn(1000, 0, 0, 5000)).toEqual([]);
    expect(windowsIn(1000, -5, 0, 5000)).toEqual([]);
    expect(windowsIn(NaN, 1000, 0, 5000)).toEqual([]);
    expect(windowsIn(1000, 1000, 5000, 5000)).toEqual([]);
  });

  test('bails out rather than looping forever on an absurd period', () => {
    // A bad payload could give a 1ms period over a fortnight.
    expect(windowsIn(0, 1, 0, 14 * DAY_MS)).toEqual([]);
  });
});

describe('span boundaries', () => {
  test('startOfDay and startOfWeek land on local midnight', () => {
    const mid = at(2026, 6, 29, 14, 37);
    expect(new Date(startOfDay(mid)).getHours()).toBe(0);
    expect(new Date(startOfWeek(mid)).getDay()).toBe(0);
    expect(new Date(startOfWeek(mid)).getHours()).toBe(0);
  });

  test('weekly span is a fortnight from the containing Sunday', () => {
    const now = at(2026, 6, 29, 14, 0); // a Wednesday
    const span = timelineSpan('weekly', 0, now);

    expect(new Date(span.startMs).getDay()).toBe(0);
    expect(span.days).toBe(14);
    expect(span.startMs).toBeLessThanOrEqual(now);
    expect(span.endMs).toBeGreaterThan(now);
  });

  test('offsets step a week in weekly mode and a day in session mode', () => {
    const now = at(2026, 6, 29, 14, 0);
    const weekly = timelineSpan('weekly', 0, now);
    const weeklyNext = timelineSpan('weekly', 1, now);
    expect(Math.round((weeklyNext.startMs - weekly.startMs) / DAY_MS)).toBe(7);

    const session = timelineSpan('session', 0, now);
    const sessionNext = timelineSpan('session', 1, now);
    expect(Math.round((sessionNext.startMs - session.startMs) / DAY_MS)).toBe(1);
    expect(session.days).toBe(3);
  });

  test('spans a whole number of days even across a DST transition', () => {
    // US DST springs forward 2026-03-08; a fixed +14*DAY_MS would land at 23:00.
    const span = timelineSpan('weekly', 0, at(2026, 2, 10, 12));
    expect(new Date(span.startMs).getHours()).toBe(0);
    expect(new Date(span.endMs).getHours()).toBe(0);
  });
});

describe('projectLane', () => {
  const lane = (over: Partial<TimelineLane> = {}): TimelineLane => ({
    name: 'a.json',
    displayName: 'Alice',
    provider: 'claude',
    anchorMs: at(2026, 6, 29, 20),
    periodHours: 24 * 7,
    remaining: 40,
    limits: [],
    ...over,
  });

  const span = timelineSpan('weekly', 0, at(2026, 6, 29, 12));

  test('classifies past, live and next windows against now', () => {
    const now = at(2026, 6, 29, 12);
    const windows = projectLane(lane(), span.startMs, span.endMs, now, 'weekly');

    expect(windows.length).toBeGreaterThan(0);
    const live = windows.filter((w) => w.state === 'live');
    expect(live.length).toBe(1);
    expect(live[0].startMs).toBeLessThanOrEqual(now);
    expect(live[0].endMs).toBeGreaterThan(now);
    expect(windows.filter((w) => w.state === 'past').every((w) => w.endMs <= now)).toBe(true);
    expect(windows.filter((w) => w.state === 'next').every((w) => w.startMs > now)).toBe(true);
  });

  test('clips bars to the visible span', () => {
    const windows = projectLane(lane(), span.startMs, span.endMs, at(2026, 6, 29, 12), 'weekly');
    for (const window of windows) {
      expect(window.leftPercent).toBeGreaterThanOrEqual(0);
      expect(window.widthPercent).toBeGreaterThan(0);
      expect(window.leftPercent + window.widthPercent).toBeLessThanOrEqual(100.0001);
    }
  });

  test('returns nothing when the lane has no anchor or period', () => {
    const now = at(2026, 6, 29, 12);
    expect(projectLane(lane({ anchorMs: null }), span.startMs, span.endMs, now, 'weekly')).toEqual(
      []
    );
    expect(
      projectLane(lane({ periodHours: null }), span.startMs, span.endMs, now, 'weekly')
    ).toEqual([]);
  });

  test('session mode projects 5-hour windows regardless of the lane period', () => {
    const now = at(2026, 6, 29, 12);
    const sessionSpan = timelineSpan('session', 0, now);
    const windows = projectLane(lane(), sessionSpan.startMs, sessionSpan.endMs, now, 'session');

    const full = windows.find((w) => w.endMs - w.startMs === 5 * HOUR_MS);
    expect(full).toBeDefined();
  });
});

describe('pickLaneWindow', () => {
  test('ignores windows with no reset instant', () => {
    const chosen = pickLaneWindow([
      { resetAtMs: null, periodHours: 168 },
      { resetAtMs: 1000, periodHours: 5 },
      { resetAtMs: undefined, periodHours: 168 },
    ]);
    expect(chosen?.resetAtMs).toBe(1000);
  });

  /**
   * The bug this rule exists for: across a fortnight, the 5-hour window always
   * resets soonest, so "pick the soonest" drew ~67 slivers per lane instead of
   * two readable weekly bars.
   */
  test('prefers the longest window that fits the span, not the soonest reset', () => {
    const fiveHour = { resetAtMs: 1_000, periodHours: 5 };
    const weekly = { resetAtMs: 9_000, periodHours: 168 };

    expect(pickLaneWindow([fiveHour, weekly], 14 * 24)).toBe(weekly);
    // A three-day span can't fit a weekly window, so the short one wins.
    expect(pickLaneWindow([fiveHour, weekly], 3 * 24)).toBe(fiveHour);
  });

  test('breaks a period tie on the soonest reset', () => {
    const later = { resetAtMs: 9_000, periodHours: 168 };
    const sooner = { resetAtMs: 5_000, periodHours: 168 };
    expect(pickLaneWindow([later, sooner], 14 * 24)).toBe(sooner);
  });

  test('falls back to the shortest available rather than drawing nothing', () => {
    // Every window is longer than the span — still better to draw one.
    const monthly = { resetAtMs: 5_000, periodHours: 720 };
    expect(pickLaneWindow([monthly], 3 * 24)).toBe(monthly);
  });

  test('returns null when nothing qualifies', () => {
    expect(pickLaneWindow([{ resetAtMs: null }])).toBeNull();
    expect(pickLaneWindow([])).toBeNull();
  });
});

describe('buildTimelineLane', () => {
  const base = { name: 'a.json', displayName: 'Alice' };

  test('claude/codex: anchors on the span-appropriate window, remaining from used', () => {
    const soon = at(2026, 6, 29, 20);
    const later = at(2026, 7, 1, 20);
    const quota = {
      status: 'success',
      windows: [
        { label: '7-day', usedPercent: 93, resetAtMs: later, periodHours: 168 },
        { label: '5-hour', usedPercent: 20, resetAtMs: soon, periodHours: 5 },
      ],
    };

    // Fortnight view: the weekly window, even though the 5-hour resets sooner.
    const weekly = buildTimelineLane({
      ...base, provider: 'claude', quota, maxPeriodHours: 14 * 24,
    });
    expect(weekly.anchorMs).toBe(later);
    expect(weekly.periodHours).toBe(168);
    expect(weekly.remaining).toBe(7); // stored USED

    // Three-day view: the weekly window doesn't fit, so the short one is used.
    const session = buildTimelineLane({
      ...base, provider: 'claude', quota, maxPeriodHours: 3 * 24,
    });
    expect(session.anchorMs).toBe(soon);
    expect(session.periodHours).toBe(5);
    expect(session.remaining).toBe(80);

    // Every limit is still summarized in the lane head regardless of the pick.
    expect(weekly.limits).toEqual([
      { label: '7-day', remaining: 7 },
      { label: '5-hour', remaining: 80 },
    ]);
  });

  test('kimi: derives remaining from raw used/limit counts', () => {
    const lane = buildTimelineLane({
      ...base,
      provider: 'kimi',
      quota: {
        status: 'success',
        rows: [
          { label: 'Daily', used: 540, limit: 1000, resetAtMs: 5000, periodHours: 24 },
          { label: 'Monthly', used: 8100, limit: 30000, resetAtMs: 9000, periodHours: 720 },
        ],
      },
      // A fortnight fits the daily window but not the monthly one.
      maxPeriodHours: 14 * 24,
    });

    expect(lane.anchorMs).toBe(5000);
    expect(lane.remaining).toBe(46);
    expect(lane.limits).toEqual([
      { label: 'Daily', remaining: 46 },
      { label: 'Monthly', remaining: 73 },
    ]);
  });

  test('providers with no usable reset produce an empty lane, not a dropped one', () => {
    // Antigravity's labels are live-clock derived; xAI has no window data.
    for (const provider of ['antigravity', 'xai'] as const) {
      const lane = buildTimelineLane({
        ...base,
        provider,
        quota: { status: 'success', groups: [] },
      });
      expect(lane.name).toBe('a.json');
      expect(lane.anchorMs).toBeNull();
      expect(lane.limits).toEqual([]);
    }
  });

  test('unloaded or errored quota produces an empty lane', () => {
    expect(buildTimelineLane({ ...base, provider: 'claude', quota: undefined }).anchorMs).toBeNull();
    expect(
      buildTimelineLane({ ...base, provider: 'claude', quota: { status: 'error' } }).anchorMs
    ).toBeNull();
  });

  test('windows without a reset instant do not anchor the lane', () => {
    const lane = buildTimelineLane({
      ...base,
      provider: 'claude',
      quota: {
        status: 'success',
        windows: [{ label: '7-day', usedPercent: 50, resetAtMs: null, periodHours: 168 }],
      },
    });
    expect(lane.anchorMs).toBeNull();
  });
});
