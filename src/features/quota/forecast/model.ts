/**
 * Pool quota forecast: recorded history + projection, React-free so tests can
 * drive it with fixed clocks.
 *
 * Units: an account's own quota is 0..100 (% of its window). Pool values are in
 * "pool percent": each account contributes `weight × own%`, so six weight-1
 * accounts make a 600% pool.
 *
 * Series are piecewise-linear. Two consecutive points with the same `t` encode
 * an instantaneous jump (a window reset): the first is the value just before,
 * the second the value just after.
 */

import type { QuotaHistoryPoint } from '@/services/api/quotaHistory';
import { firstInLine } from '../accounts/rowModel';

export type SeriesPoint = { t: number; v: number };

export type ResetJump = { t: number; amount: number };

export type ForecastAccountInput = {
  key: string;
  name: string;
  weight: number;
  /** Window length, used to schedule resets after the next known one. */
  periodMs: number | null;
  /** Samples of the forecast window, sorted by time. */
  samples: QuotaHistoryPoint[];
  /** The account has a 5-hour session limit. */
  sessionLimited?: boolean;
  /** Weekly % one full 5-hour window allows (backend routing report), when measured. */
  sessionShare?: number | null;
};

export type FutureUsage = 'none' | 'half' | 'same' | 'more' | 'double';

export const FUTURE_USAGE_MULTIPLIERS: Record<FutureUsage, number> = {
  none: 0,
  half: 0.5,
  same: 1,
  more: 1.5,
  double: 2,
};

export type ForecastOptions = {
  now: number;
  /** Visible range, epoch ms. */
  from: number;
  to: number;
  /** Burn-rate lookback, hours. */
  burnWindowHours: number;
  futureUsage: FutureUsage;
  /** The projection runs to max(to, horizon). */
  horizon: number;
  /** Project traffic the way the weekly-reset router sends it: earliest deadline first. */
  weeklyResetRouting?: boolean;
};

export type ProjectedReset = { t: number; amount: number; keys: string[] };

export type AccountForecast = {
  key: string;
  name: string;
  weight: number;
  remaining: number;
  /** Own-percent per hour over the burn window, null when history is too short. */
  burnRate: number | null;
  recorded: SeriesPoint[];
  projected: SeriesPoint[];
};

export type PoolForecast = {
  capacity: number;
  remaining: number;
  /** Pool percent per hour over the burn window, null without enough history. */
  burnRate: number | null;
  recorded: SeriesPoint[];
  projected: SeriesPoint[];
  recordedResets: ResetJump[];
  projectedResets: ProjectedReset[];
  /** First projected reset after now, even beyond the visible range. */
  nextReset: ProjectedReset | null;
  firstEmpty: { key: string; t: number } | null;
  poolEmptyAt: number | null;
  /** Rolling pool burn rate (pool %/h) at recorded instants. */
  drainRecorded: SeriesPoint[];
  /** Projected pool burn rate; drops to 0 while the pool is empty. */
  drainProjected: SeriesPoint[];
  accounts: AccountForecast[];
};

const HOUR_MS = 60 * 60 * 1000;
const MIN_BURN_SPAN_MS = 10 * 60 * 1000;
const RESET_MERGE_MS = 60 * 1000;
const EPSILON = 1e-6;
const DRAIN_STEP_MS = 20 * 60 * 1000;
const STALE_AFTER_RESET_MS = 30 * 60 * 1000;
/**
 * Usage never falls within a window, but sources disagree by up to a point:
 * Claude's usage API reports whole percents while its rate-limit headers floor
 * the fraction (48 vs 0.47). Smaller rises in the same window are not resets.
 */
const SOURCE_NOISE_PERCENT = 2;

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

/* ------------------------------------------------------------------ */
/* Recorded series                                                     */
/* ------------------------------------------------------------------ */

/**
 * Remaining-percent series for one account between `from` and `to`.
 *
 * Between samples usage is interpolated linearly. A reset reported by the
 * earlier sample holds its value until the reset instant, jumps to 100, then
 * declines toward the next sample. An unexplained increase (manual reset,
 * missing reset time) becomes a jump at the later sample, except a dip of under
 * SOURCE_NOISE_PERCENT within the same window, which keeps the higher usage.
 * Before the first sample the value is held flat so pools stay continuous.
 */
export function buildRecordedSeries(
  samples: QuotaHistoryPoint[],
  from: number,
  to: number
): { series: SeriesPoint[]; resets: ResetJump[] } {
  const series: SeriesPoint[] = [];
  const resets: ResetJump[] = [];
  if (samples.length === 0 || to <= from) return { series, resets };

  const remainingOf = (point: QuotaHistoryPoint) => clampPercent(100 - point.used);
  const first = samples[0];
  if (first.t > from) series.push({ t: from, v: remainingOf(first) });

  let previous: QuotaHistoryPoint | null = null;
  for (const sample of samples) {
    const remaining = remainingOf(sample);
    if (!previous) {
      series.push({ t: sample.t, v: remaining });
      previous = sample;
      continue;
    }
    const previousRemaining = remainingOf(previous);
    const resetAt = previous.resetAt;
    if (resetAt !== null && resetAt > previous.t && resetAt <= sample.t) {
      series.push({ t: resetAt, v: previousRemaining });
      series.push({ t: resetAt, v: 100 });
      resets.push({ t: resetAt, amount: 100 - previousRemaining });
      // A sample taken right at the reset can still report the old usage; it
      // stands for a fresh window, not a second drop and refill.
      const stale =
        sample.t - resetAt <= STALE_AFTER_RESET_MS &&
        Math.abs(remaining - previousRemaining) < 0.5 &&
        remaining < 100;
      if (stale) {
        series.push({ t: sample.t, v: 100 });
        previous = { t: sample.t, used: 0, resetAt: sample.resetAt };
        continue;
      }
      series.push({ t: sample.t, v: remaining });
    } else if (remaining > previousRemaining + 0.5) {
      const sameWindow =
        previous.resetAt === null ||
        sample.resetAt === null ||
        Math.abs(sample.resetAt - previous.resetAt) <= RESET_MERGE_MS;
      if (sameWindow && remaining - previousRemaining < SOURCE_NOISE_PERCENT) {
        series.push({ t: sample.t, v: previousRemaining });
        previous = { ...sample, used: previous.used };
        continue;
      }
      series.push({ t: sample.t, v: previousRemaining });
      series.push({ t: sample.t, v: remaining });
      resets.push({ t: sample.t, amount: remaining - previousRemaining });
    } else {
      series.push({ t: sample.t, v: remaining });
    }
    previous = sample;
  }

  const last = previous ?? samples[samples.length - 1];
  const lastRemaining = remainingOf(last);
  if (last.t < to) {
    if (last.resetAt !== null && last.resetAt > last.t && last.resetAt <= to) {
      series.push({ t: last.resetAt, v: lastRemaining });
      series.push({ t: last.resetAt, v: 100 });
      resets.push({ t: last.resetAt, amount: 100 - lastRemaining });
      series.push({ t: to, v: 100 });
    } else {
      series.push({ t: to, v: lastRemaining });
    }
  }

  return { series: clipSeries(series, from, to), resets: resets.filter((r) => r.t >= from) };
}

/** Value of a piecewise-linear series; at a jump, `side` picks before/after. */
export function valueAt(series: SeriesPoint[], t: number, side: 'pre' | 'post' = 'post'): number {
  if (series.length === 0) return 0;
  if (t < series[0].t) return series[0].v;
  const last = series[series.length - 1];
  if (t > last.t) return last.v;

  // First index with point.t >= t.
  let low = 0;
  let high = series.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (series[mid].t < t) low = mid + 1;
    else high = mid;
  }
  if (series[low].t === t) {
    if (side === 'pre') return series[low].v;
    let end = low;
    while (end + 1 < series.length && series[end + 1].t === t) end += 1;
    return series[end].v;
  }
  const a = series[low - 1];
  const b = series[low];
  return a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t);
}

/** Restrict a series to [from, to], interpolating the boundary values. */
export function clipSeries(series: SeriesPoint[], from: number, to: number): SeriesPoint[] {
  if (series.length === 0 || to < from) return [];
  const out: SeriesPoint[] = [];
  if (series[0].t < from) out.push({ t: from, v: valueAt(series, from, 'post') });
  series.forEach((point) => {
    if (point.t >= from && point.t <= to) out.push(point);
  });
  if (series[series.length - 1].t > to && (out.length === 0 || out[out.length - 1].t < to)) {
    out.push({ t: to, v: valueAt(series, to, 'pre') });
  }
  return out;
}

/**
 * Weighted sum of several series on the union of their breakpoints; jumps in
 * any input become jumps in the output.
 */
export function sumSeries(inputs: { series: SeriesPoint[]; weight: number }[]): SeriesPoint[] {
  const active = inputs.filter((input) => input.series.length > 0);
  if (active.length === 0) return [];
  const times = new Set<number>();
  const jumpTimes = new Set<number>();
  active.forEach(({ series }) => {
    series.forEach((point, index) => {
      times.add(point.t);
      if (index > 0 && series[index - 1].t === point.t) jumpTimes.add(point.t);
    });
  });
  const sorted = Array.from(times).sort((a, b) => a - b);
  const out: SeriesPoint[] = [];
  const total = (t: number, side: 'pre' | 'post') =>
    active.reduce((sum, { series, weight }) => sum + weight * valueAt(series, t, side), 0);
  sorted.forEach((t) => {
    if (jumpTimes.has(t)) {
      out.push({ t, v: total(t, 'pre') });
      out.push({ t, v: total(t, 'post') });
    } else {
      out.push({ t, v: total(t, 'post') });
    }
  });
  return out;
}

/** Total decrease of a series between `a` and `b`; increases (resets) are ignored. */
export function consumedBetween(series: SeriesPoint[], a: number, b: number): number {
  if (series.length < 2 || b <= a) return 0;
  let consumed = 0;
  for (let index = 1; index < series.length; index += 1) {
    const p = series[index - 1];
    const q = series[index];
    if (q.t <= a || p.t >= b || q.t === p.t) continue;
    const start = Math.max(a, p.t);
    const end = Math.min(b, q.t);
    const slope = (q.v - p.v) / (q.t - p.t);
    const drop = -slope * (end - start);
    if (drop > 0) consumed += drop;
  }
  return consumed;
}

/** Own-percent per hour over the lookback, based only on sampled instants. */
export function accountBurnRate(
  series: SeriesPoint[],
  samples: QuotaHistoryPoint[],
  now: number,
  windowHours: number
): number | null {
  if (samples.length === 0) return null;
  const end = Math.min(now, samples[samples.length - 1].t);
  const start = Math.max(now - windowHours * HOUR_MS, samples[0].t);
  if (end - start < MIN_BURN_SPAN_MS) return null;
  return consumedBetween(series, start, end) / ((end - start) / HOUR_MS);
}

/* ------------------------------------------------------------------ */
/* Projection                                                          */
/* ------------------------------------------------------------------ */

type SimAccount = {
  key: string;
  weight: number;
  remaining: number;
  share: number;
  nextReset: number | null;
  periodMs: number | null;
  sessionLimited: boolean;
  sessionShare: number | null;
  points: SeriesPoint[];
};

type Projection = {
  pool: SeriesPoint[];
  accounts: Map<string, SeriesPoint[]>;
  resets: ProjectedReset[];
  firstEmpty: { key: string; t: number } | null;
  poolEmptyAt: number | null;
  drain: SeriesPoint[];
};

const SESSION_WINDOW_HOURS = 5;

/**
 * Hours to spend `left` (% of the week) at `drain` %/h when each 5-hour window
 * allows at most `share` %, the first window starting now (backend `hoursToSpend`).
 */
export function hoursToSpend(left: number, drain: number, share: number): number {
  let remaining = left;
  let elapsed = 0;
  let end = SESSION_WINDOW_HOURS;
  for (let guard = 0; guard < 1000; guard += 1) {
    const window = Math.min(share, drain * (end - elapsed));
    if (remaining <= window) return elapsed + remaining / drain;
    remaining -= Math.max(0, window);
    elapsed = end;
    end += SESSION_WINDOW_HOURS;
  }
  return elapsed + remaining / Math.min(drain, share / SESSION_WINDOW_HOURS);
}

/** Splits `rate` (pool %/h) over accounts in proportion to their recent burn. */
function splitByShare(accounts: SimAccount[], rate: number, ownRate: Map<SimAccount, number>) {
  let carriers = accounts.filter((account) => account.share > 0);
  let shareOf = (account: SimAccount) => account.share;
  if (carriers.length === 0) {
    carriers = accounts;
    shareOf = (account) => account.weight;
  }
  const total = carriers.reduce((sum, account) => sum + shareOf(account), 0);
  if (total <= 0) return;
  carriers.forEach((account) => {
    ownRate.set(
      account,
      (ownRate.get(account) ?? 0) + (rate * shareOf(account)) / total / account.weight
    );
  });
}

/**
 * Weekly-reset routing: the account with the earliest effective deadline takes the
 * traffic, a session-limited one only as much as its 5-hour windows allow on average,
 * and the rest goes to the next. The deadline is the reset, moved earlier for a
 * session-limited account by the extra time its windows add at this traffic (the
 * backend rule). Accounts without a known reset share what is left by burn.
 */
function allocateByDeadline(
  accounts: SimAccount[],
  rate: number,
  ownRate: Map<SimAccount, number>
) {
  const deadlineOf = (account: SimAccount) => {
    const reset = account.nextReset as number;
    if (!account.sessionLimited || !account.sessionShare) return reset;
    const drain = rate / account.weight;
    const extra =
      hoursToSpend(account.remaining, drain, account.sessionShare) - account.remaining / drain;
    return reset - Math.max(0, extra) * HOUR_MS;
  };
  let left = rate;
  let queue = accounts.filter((account) => account.nextReset !== null);
  while (left > EPSILON && queue.length > 0) {
    const first = firstInLine(queue, deadlineOf, (account) => account.sessionLimited);
    const each = left / first.length;
    first.forEach((account) => {
      const cap =
        account.sessionLimited && account.sessionShare
          ? (account.sessionShare / SESSION_WINDOW_HOURS) * account.weight
          : Infinity;
      const give = Math.min(each, cap);
      ownRate.set(account, give / account.weight);
      left -= give;
    });
    queue = queue.filter((account) => !first.includes(account));
  }
  if (left > EPSILON) {
    splitByShare(
      accounts.filter((account) => account.nextReset === null),
      left,
      ownRate
    );
  }
}

/**
 * Event-driven projection. The pool keeps consuming `poolRate` (pool %/h) the
 * way the router keeps sending traffic: split across accounts that still have
 * quota in proportion to their recent burn, shifting to the rest as accounts
 * run dry. Each account refills to 100% at its reset and then resets every
 * period.
 *
 * With `routed` (weekly-reset routing), traffic goes to accounts in order of
 * their effective deadline instead (see `allocateByDeadline`), re-ranked at least
 * hourly as they drain.
 */
export function projectPool(
  accounts: {
    key: string;
    weight: number;
    remaining: number;
    burnRate: number | null;
    nextReset: number | null;
    periodMs: number | null;
    sessionLimited?: boolean;
    sessionShare?: number | null;
  }[],
  poolRate: number,
  start: number,
  end: number,
  routed = false
): Projection {
  const sim: SimAccount[] = accounts.map((account) => ({
    key: account.key,
    weight: account.weight,
    remaining: clampPercent(account.remaining),
    share: Math.max(0, account.burnRate ?? 0) * account.weight,
    nextReset: account.nextReset !== null && account.nextReset > start ? account.nextReset : null,
    periodMs: account.periodMs,
    sessionLimited: account.sessionLimited === true,
    sessionShare: account.sessionShare && account.sessionShare > 0 ? account.sessionShare : null,
    points: [{ t: start, v: clampPercent(account.remaining) }],
  }));
  const poolValue = () => sim.reduce((sum, account) => sum + account.weight * account.remaining, 0);
  const pool: SeriesPoint[] = [{ t: start, v: poolValue() }];
  const resets: ProjectedReset[] = [];
  const drain: SeriesPoint[] = [];
  let firstEmpty: { key: string; t: number } | null = null;
  let poolEmptyAt: number | null = null;

  const already = sim.find((account) => account.remaining <= EPSILON);
  if (already) firstEmpty = { key: already.key, t: start };

  const rate = Math.max(0, poolRate);
  let t = start;
  for (let guard = 0; guard < 5000 && t < end; guard += 1) {
    // Split the pool rate across accounts with quota left.
    const nonEmpty = sim.filter((account) => account.remaining > EPSILON);
    const ownRate = new Map<SimAccount, number>();
    if (rate > 0) {
      if (routed) allocateByDeadline(nonEmpty, rate, ownRate);
      else splitByShare(nonEmpty, rate, ownRate);
    }
    let flowing = 0;
    ownRate.forEach((own, account) => {
      flowing += own * account.weight;
    });
    drain.push({ t, v: flowing });

    // A window that has not started yet starts on first use.
    ownRate.forEach((own, account) => {
      if (own > 0 && account.nextReset === null && account.periodMs) {
        account.nextReset = t + account.periodMs;
      }
    });

    // Deadlines move as accounts drain, so routed traffic is re-ranked at least hourly.
    let next = routed ? Math.min(end, t + HOUR_MS) : end;
    sim.forEach((account) => {
      if (account.nextReset !== null && account.nextReset < next) next = account.nextReset;
    });
    ownRate.forEach((own, account) => {
      if (own <= 0) return;
      const emptyAt = t + (account.remaining / own) * HOUR_MS;
      if (emptyAt < next) next = emptyAt;
    });
    next = Math.max(next, t);

    // Advance to the next event.
    const hours = (next - t) / HOUR_MS;
    ownRate.forEach((own, account) => {
      account.remaining = Math.max(0, account.remaining - own * hours);
      if (account.remaining < 1e-4) account.remaining = 0;
    });
    t = next;
    sim.forEach((account) => account.points.push({ t, v: account.remaining }));
    pool.push({ t, v: poolValue() });
    drain.push({ t, v: flowing });

    if (!firstEmpty) {
      const emptied = sim.find((account) => account.remaining <= EPSILON);
      if (emptied) firstEmpty = { key: emptied.key, t };
    }
    if (poolEmptyAt === null && flowing > 0 && poolValue() <= EPSILON) poolEmptyAt = t;

    // Apply resets due now.
    const due = sim.filter((account) => account.nextReset !== null && account.nextReset <= t + 1);
    if (due.length > 0) {
      let amount = 0;
      due.forEach((account) => {
        amount += account.weight * (100 - account.remaining);
        account.remaining = 100;
        if (account.periodMs) {
          let following = (account.nextReset as number) + account.periodMs;
          while (following <= t) following += account.periodMs;
          account.nextReset = following;
        } else {
          account.nextReset = null;
        }
        account.points.push({ t, v: 100 });
      });
      pool.push({ t, v: poolValue() });
      const lastReset = resets[resets.length - 1];
      if (lastReset && t - lastReset.t <= RESET_MERGE_MS) {
        lastReset.amount += amount;
        lastReset.keys.push(...due.map((account) => account.key));
      } else {
        resets.push({ t, amount, keys: due.map((account) => account.key) });
      }
    }
  }

  return {
    pool,
    accounts: new Map(sim.map((account) => [account.key, account.points])),
    resets: resets.filter((reset) => reset.amount > 0.5),
    firstEmpty,
    poolEmptyAt,
    drain: dedupeSteps(drain),
  };
}

/** Collapse runs of equal values in a step series, keeping both ends of each change. */
const dedupeSteps = (series: SeriesPoint[]): SeriesPoint[] =>
  series.filter((point, index) => {
    if (index === 0 || index === series.length - 1) return true;
    const previous = series[index - 1];
    const next = series[index + 1];
    return !(previous.v === point.v && next.v === point.v);
  });

/* ------------------------------------------------------------------ */
/* Pool forecast                                                       */
/* ------------------------------------------------------------------ */

/** The first reset after `now`, rolling a past reset forward by whole periods. */
const upcomingReset = (resetAt: number | null, periodMs: number | null, now: number) => {
  if (resetAt === null) return null;
  if (resetAt > now) return resetAt;
  if (!periodMs) return null;
  return resetAt + Math.ceil((now - resetAt + 1) / periodMs) * periodMs;
};

const mergeResets = (resets: ResetJump[]): ResetJump[] => {
  const sorted = [...resets].sort((a, b) => a.t - b.t);
  const merged: ResetJump[] = [];
  sorted.forEach((reset) => {
    const last = merged[merged.length - 1];
    if (last && reset.t - last.t <= RESET_MERGE_MS) last.amount += reset.amount;
    else merged.push({ ...reset });
  });
  return merged.filter((reset) => reset.amount > 0.5);
};

export function buildPoolForecast(
  inputs: ForecastAccountInput[],
  options: ForecastOptions
): PoolForecast {
  const { now, from, to, burnWindowHours, futureUsage } = options;
  const recordedEnd = Math.min(now, to);
  // History needs to reach back far enough for the burn window even when the
  // visible range starts later.
  const historyFrom = Math.min(from, now - burnWindowHours * HOUR_MS);
  const accounts = inputs.filter((input) => input.samples.length > 0 && input.weight > 0);

  const prepared = accounts.map((input) => {
    const { series, resets } = buildRecordedSeries(input.samples, historyFrom, now);
    const remaining = series.length > 0 ? valueAt(series, now, 'post') : 0;
    const burnRate = accountBurnRate(series, input.samples, now, burnWindowHours);
    const latest = input.samples[input.samples.length - 1];
    const nextReset = upcomingReset(latest.resetAt, input.periodMs, now);
    return { input, series, resets, remaining, burnRate, nextReset };
  });

  const capacity = accounts.reduce((sum, input) => sum + input.weight * 100, 0);
  const remaining = prepared.reduce((sum, item) => sum + item.input.weight * item.remaining, 0);
  const rated = prepared.filter((item) => item.burnRate !== null);
  const burnRate =
    rated.length > 0
      ? rated.reduce((sum, item) => sum + item.input.weight * (item.burnRate as number), 0)
      : null;

  const visibleRecorded = prepared.map((item) => ({
    series: from < recordedEnd ? clipSeries(item.series, from, recordedEnd) : [],
    weight: item.input.weight,
  }));
  const recorded = sumSeries(visibleRecorded);
  const recordedResets = mergeResets(
    prepared.flatMap((item) =>
      item.resets
        .filter((reset) => reset.t >= from && reset.t <= recordedEnd)
        .map((reset) => ({ t: reset.t, amount: reset.amount * item.input.weight }))
    )
  );

  const projectionEnd = Math.max(to, options.horizon);
  const projection = projectPool(
    prepared.map((item) => ({
      key: item.input.key,
      weight: item.input.weight,
      remaining: item.remaining,
      burnRate: item.burnRate,
      nextReset: item.nextReset,
      periodMs: item.input.periodMs,
      sessionLimited: item.input.sessionLimited,
      sessionShare: item.input.sessionShare ?? null,
    })),
    (burnRate ?? 0) * FUTURE_USAGE_MULTIPLIERS[futureUsage],
    now,
    projectionEnd,
    options.weeklyResetRouting === true
  );

  const projectedFrom = Math.max(now, from);
  const projectedVisible = now < to;
  const projected = projectedVisible ? clipSeries(projection.pool, projectedFrom, to) : [];

  const drainRecorded = buildDrainSeries(prepared, from, recordedEnd, burnWindowHours);
  const drainProjected = projectedVisible ? clipSeries(projection.drain, projectedFrom, to) : [];

  return {
    capacity,
    remaining,
    burnRate,
    recorded,
    projected,
    recordedResets,
    projectedResets: projection.resets.filter((reset) => reset.t > now && reset.t <= to + 1),
    nextReset: projection.resets.find((reset) => reset.t > now) ?? null,
    firstEmpty: projection.firstEmpty,
    poolEmptyAt: projection.poolEmptyAt,
    drainRecorded,
    drainProjected,
    accounts: prepared.map((item) => ({
      key: item.input.key,
      name: item.input.name,
      weight: item.input.weight,
      remaining: item.remaining,
      burnRate: item.burnRate,
      recorded: from < recordedEnd ? clipSeries(item.series, from, recordedEnd) : [],
      projected: projectedVisible
        ? clipSeries(projection.accounts.get(item.input.key) ?? [], projectedFrom, to)
        : [],
    })),
  };
}

/** Pool burn rate (pool %/h) over a rolling lookback, sampled on a fixed grid. */
function buildDrainSeries(
  prepared: { input: ForecastAccountInput; series: SeriesPoint[] }[],
  from: number,
  to: number,
  windowHours: number
): SeriesPoint[] {
  if (to <= from || prepared.length === 0) return [];
  const firstSample = Math.min(...prepared.map((item) => item.input.samples[0].t));
  const start = Math.max(from, firstSample);
  if (to <= start) return [];
  const lookback = windowHours * HOUR_MS;
  const out: SeriesPoint[] = [];
  const rateAt = (t: number) => {
    const a = Math.max(t - lookback, firstSample);
    const span = t - a;
    if (span < MIN_BURN_SPAN_MS) return 0;
    return prepared.reduce(
      (sum, item) =>
        sum + (item.input.weight * consumedBetween(item.series, a, t)) / (span / HOUR_MS),
      0
    );
  };
  for (let t = start; t < to; t += DRAIN_STEP_MS) out.push({ t, v: rateAt(t) });
  out.push({ t: to, v: rateAt(to) });
  return out;
}

/* ------------------------------------------------------------------ */
/* Range & axes                                                        */
/* ------------------------------------------------------------------ */

export const RANGE_DAYS_BEFORE = 3;
export const RANGE_DAYS = 14;
export const PROJECTION_HORIZON_DAYS = 14;

export const startOfLocalDay = (t: number): number => {
  const date = new Date(t);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export const addLocalDays = (t: number, days: number): number => {
  const date = new Date(t);
  date.setDate(date.getDate() + days);
  return date.getTime();
};

/** Visible range: three days of history before the anchor day, fourteen days in total. */
export const forecastRange = (anchor: number): { from: number; to: number } => {
  const from = addLocalDays(startOfLocalDay(anchor), -RANGE_DAYS_BEFORE);
  return { from, to: addLocalDays(from, RANGE_DAYS) };
};

/** Local midnights inside [from, to). */
export const dayStarts = (from: number, to: number): number[] => {
  const days: number[] = [];
  for (let t = startOfLocalDay(from); t < to; t = addLocalDays(t, 1)) {
    if (t >= from) days.push(t);
  }
  return days;
};

/** A rounded axis maximum for rate charts. */
export const niceCeiling = (value: number): number => {
  if (!(value > 0)) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const step = steps.find((candidate) => candidate * base >= value) ?? 10;
  return step * base;
};
