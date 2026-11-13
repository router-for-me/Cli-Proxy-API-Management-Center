import { describe, expect, test } from 'bun:test';
import {
  accountBurnRate,
  buildPoolForecast,
  buildRecordedSeries,
  consumedBetween,
  niceCeiling,
  hoursToSpend,
  projectPool,
  sumSeries,
  valueAt,
  type ForecastAccountInput,
} from '@/features/quota/forecast/model';
import { normalizeQuotaHistory } from '@/services/api/quotaHistory';

const H = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 26, 0, 0, 0);

const point = (hours: number, used: number, resetHours: number | null = null) => ({
  t: T0 + hours * H,
  used,
  resetAt: resetHours === null ? null : T0 + resetHours * H,
});

describe('recorded series', () => {
  test('interpolates usage and holds the last value until the end', () => {
    const { series, resets } = buildRecordedSeries([point(0, 10), point(2, 30)], T0, T0 + 4 * H);
    expect(resets).toEqual([]);
    expect(valueAt(series, T0 + 1 * H)).toBeCloseTo(80);
    expect(valueAt(series, T0 + 3 * H)).toBeCloseTo(70);
  });

  test('jumps to full at a reported reset and declines toward the next sample', () => {
    const { series, resets } = buildRecordedSeries([point(0, 90, 1), point(3, 20)], T0, T0 + 3 * H);
    expect(resets).toEqual([{ t: T0 + H, amount: 90 }]);
    expect(valueAt(series, T0 + H, 'pre')).toBeCloseTo(10);
    expect(valueAt(series, T0 + H, 'post')).toBeCloseTo(100);
    expect(valueAt(series, T0 + 2 * H)).toBeCloseTo(90);
  });

  test('ignores a sample at the reset instant that still reports the old usage', () => {
    const { resets, series } = buildRecordedSeries(
      [point(0, 61, 1), point(1, 61, 169), point(1.2, 0, 169)],
      T0,
      T0 + 2 * H
    );
    expect(resets).toEqual([{ t: T0 + H, amount: 61 }]);
    expect(valueAt(series, T0 + 1.1 * H)).toBeCloseTo(100);
  });

  test('treats an unexplained increase as a reset at the later sample', () => {
    const { resets } = buildRecordedSeries([point(0, 60), point(1, 5)], T0, T0 + H);
    expect(resets).toEqual([{ t: T0 + H, amount: 55 }]);
  });

  test('keeps the higher usage when sources disagree by a point in the same window', () => {
    // Production: usage API 48 then header 0.47, reset instants 186 ms apart.
    const resetAt = T0 + 100 * H;
    const { series, resets } = buildRecordedSeries(
      [
        { t: T0, used: 48, resetAt: resetAt - 186 },
        { t: T0 + H, used: 47, resetAt },
        { t: T0 + 2 * H, used: 48, resetAt: resetAt + 173 },
        { t: T0 + 3 * H, used: 49, resetAt },
      ],
      T0,
      T0 + 3 * H
    );
    expect(resets).toEqual([]);
    expect(valueAt(series, T0 + H)).toBe(52);
    expect(valueAt(series, T0 + 3 * H)).toBe(51);
  });

  test('still reports a small rise as a reset when the window moved', () => {
    const { resets } = buildRecordedSeries([point(0, 1, 10), point(1, 0, 178)], T0, T0 + 2 * H);
    expect(resets).toEqual([{ t: T0 + H, amount: 1 }]);
  });

  test('backfills flat before the first sample', () => {
    const { series } = buildRecordedSeries([point(2, 40)], T0, T0 + 3 * H);
    expect(series[0]).toEqual({ t: T0, v: 60 });
  });
});

describe('series arithmetic', () => {
  test('weighted sums keep jumps from any input', () => {
    const a = [
      { t: T0, v: 50 },
      { t: T0 + H, v: 40 },
      { t: T0 + H, v: 100 },
      { t: T0 + 2 * H, v: 90 },
    ];
    const b = [
      { t: T0, v: 100 },
      { t: T0 + 2 * H, v: 80 },
    ];
    const sum = sumSeries([
      { series: a, weight: 1 },
      { series: b, weight: 2.5 },
    ]);
    expect(sum).toEqual([
      { t: T0, v: 300 },
      { t: T0 + H, v: 265 },
      { t: T0 + H, v: 325 },
      { t: T0 + 2 * H, v: 290 },
    ]);
  });

  test('consumption ignores resets and burn rate uses sampled time only', () => {
    const samples = [point(0, 0), point(1, 10, 1.5), point(3, 5)];
    const { series } = buildRecordedSeries(samples, T0, T0 + 3 * H);
    // 10 used before the reset, then 5 more after it.
    expect(consumedBetween(series, T0, T0 + 3 * H)).toBeCloseTo(15);
    expect(accountBurnRate(series, samples, T0 + 3 * H, 3)).toBeCloseTo(5);
    expect(accountBurnRate(series, samples.slice(0, 1), T0 + 3 * H, 3)).toBeNull();
  });

  test('nice ceilings round up to readable steps', () => {
    expect(niceCeiling(3.7)).toBe(4);
    expect(niceCeiling(12)).toBe(15);
    expect(niceCeiling(0)).toBe(1);
  });
});

describe('projection', () => {
  test('empties a single account at its own burn rate', () => {
    const projection = projectPool(
      [{ key: 'a', weight: 1, remaining: 50, burnRate: 10, nextReset: null, periodMs: null }],
      10,
      T0,
      T0 + 24 * H
    );
    expect(projection.firstEmpty).toEqual({ key: 'a', t: T0 + 5 * H });
    expect(projection.poolEmptyAt).toBe(T0 + 5 * H);
  });

  test('shifts load to accounts with quota left, keeping the pool slope', () => {
    const projection = projectPool(
      [
        { key: 'busy', weight: 1, remaining: 10, burnRate: 10, nextReset: null, periodMs: null },
        { key: 'idle', weight: 1, remaining: 100, burnRate: 0, nextReset: null, periodMs: null },
      ],
      10,
      T0,
      T0 + 24 * H
    );
    expect(projection.firstEmpty).toEqual({ key: 'busy', t: T0 + H });
    expect(projection.poolEmptyAt).toBe(T0 + 11 * H);
    expect(valueAt(projection.pool, T0 + 5 * H)).toBeCloseTo(60);
  });

  test('refills at resets and repeats every period', () => {
    const projection = projectPool(
      [
        {
          key: 'a',
          weight: 2.5,
          remaining: 20,
          burnRate: 0,
          nextReset: T0 + 2 * H,
          periodMs: 24 * H,
        },
      ],
      0,
      T0,
      T0 + 48 * H
    );
    expect(projection.resets).toEqual([{ t: T0 + 2 * H, amount: 200, keys: ['a'] }]);
    expect(valueAt(projection.pool, T0 + 3 * H)).toBeCloseTo(250);
  });

  describe('with weekly-reset routing', () => {
    const week = 7 * 24 * H;
    const sim = (resetHours: number, remaining: number, burnRate: number) => ({
      remaining,
      burnRate,
      nextReset: T0 + resetHours * H,
      periodMs: week,
    });
    const at = (projection: ReturnType<typeof projectPool>, key: string, hours: number) =>
      valueAt(projection.accounts.get(key) ?? [], T0 + hours * H);

    test('drains the account resetting first instead of wasting it', () => {
      const accounts = [
        { key: 'soon', weight: 1, ...sim(10, 80, 1) },
        { key: 'later', weight: 1, ...sim(100, 100, 9) },
      ];
      // Split by recent burn, 'soon' gets 1 of 10 points an hour and resets with 70% unused.
      const split = projectPool(accounts, 10, T0, T0 + 12 * H);
      expect(split.resets).toEqual([{ t: T0 + 10 * H, amount: 30, keys: ['soon'] }]);

      const routed = projectPool(accounts, 10, T0, T0 + 12 * H, true);
      expect(routed.firstEmpty).toEqual({ key: 'soon', t: T0 + 8 * H });
      expect(routed.resets).toEqual([{ t: T0 + 10 * H, amount: 100, keys: ['soon'] }]);
      // 'later' takes the traffic once 'soon' is empty: 2 hours at 10 points.
      expect(at(routed, 'later', 10)).toBeCloseTo(80);
    });

    test('follows the earliest reset however far away', () => {
      const projection = projectPool(
        [
          { key: 'a', weight: 1, ...sim(80, 80, 5) },
          { key: 'b', weight: 1, ...sim(140, 100, 5) },
        ],
        10,
        T0,
        T0 + 12 * H,
        true
      );
      expect(at(projection, 'a', 4)).toBeCloseTo(40);
      expect(projection.firstEmpty).toEqual({ key: 'a', t: T0 + 8 * H });
      expect(at(projection, 'b', 12)).toBeCloseTo(60);
    });

    test('splits evenly between accounts tied on their reset', () => {
      const projection = projectPool(
        [
          { key: 'a', weight: 1, ...sim(20, 100, 9) },
          { key: 'b', weight: 2, ...sim(20, 100, 0) },
        ],
        12,
        T0,
        T0 + 5 * H,
        true
      );
      // 6 pool points an hour each: 'a' loses 6%/h, double-capacity 'b' 3%/h.
      expect(at(projection, 'a', 5)).toBeCloseTo(70);
      expect(at(projection, 'b', 5)).toBeCloseTo(85);
    });

    test('caps a session-limited account at its 5-hour share and spills the rest', () => {
      const projection = projectPool(
        [
          { key: 'limited', weight: 1, ...sim(10, 100, 1), sessionLimited: true, sessionShare: 20 },
          { key: 'exempt', weight: 1, ...sim(50, 100, 1) },
        ],
        10,
        T0,
        T0 + 2 * H,
        true
      );
      // 20% per 5 hours is 4%/h; the other 6 points an hour go to the next deadline.
      expect(at(projection, 'limited', 2)).toBeCloseTo(92);
      expect(at(projection, 'exempt', 2)).toBeCloseTo(88);
    });

    test('gives what a capped account in a tie cannot take to the others in the tie', () => {
      // Same deadline; 5-hour caps of 1 and 10 points an hour against 10 points of traffic.
      const projection = projectPool(
        [
          { key: 'small', weight: 1, ...sim(30, 5, 1), sessionLimited: true, sessionShare: 5 },
          { key: 'large', weight: 1, ...sim(30, 50, 1), sessionLimited: true, sessionShare: 50 },
          { key: 'later', weight: 1, ...sim(90, 100, 1) },
        ],
        10,
        T0,
        T0 + H,
        true
      );
      expect(at(projection, 'small', 1)).toBeCloseTo(4);
      expect(at(projection, 'large', 1)).toBeCloseTo(41);
      expect(at(projection, 'later', 1)).toBeCloseTo(100);
    });

    test('starts a session-limited account early only under heavy traffic', () => {
      const run = (rate: number) =>
        projectPool(
          [
            { key: 'exempt', weight: 1, ...sim(20, 100, 1) },
            {
              key: 'limited',
              weight: 1,
              ...sim(22, 100, 1),
              sessionLimited: true,
              sessionShare: 28,
            },
          ],
          rate,
          T0,
          T0 + H,
          true
        );
      // At 10%/h its windows need 16.6 h instead of 10 h: it goes before the exempt one.
      const heavy = run(10);
      expect(at(heavy, 'limited', 1)).toBeCloseTo(100 - 5.6);
      expect(at(heavy, 'exempt', 1)).toBeCloseTo(100 - 4.4);
      // At 1%/h the windows never bind, so the earlier reset goes first.
      const light = run(1);
      expect(at(light, 'exempt', 1)).toBeCloseTo(99);
      expect(at(light, 'limited', 1)).toBeCloseTo(100);
    });

    test('spends limited windows the way the backend counts them', () => {
      expect(hoursToSpend(20, 10, 28)).toBeCloseTo(2);
      expect(hoursToSpend(50, 2, 28)).toBeCloseTo(25);
      expect(hoursToSpend(100, 10, 28)).toBeCloseTo(16.6);
    });
  });

  test('starts an unstarted window on first use', () => {
    const projection = projectPool(
      [{ key: 'a', weight: 1, remaining: 100, burnRate: 1, nextReset: null, periodMs: 10 * H }],
      1,
      T0,
      T0 + 11 * H
    );
    expect(projection.resets).toEqual([{ t: T0 + 10 * H, amount: 10, keys: ['a'] }]);
  });
});

describe('pool forecast', () => {
  const account = (
    key: string,
    weight: number,
    samples: ReturnType<typeof point>[]
  ): ForecastAccountInput => ({ key, name: key, weight, periodMs: 7 * 24 * H, samples });

  test('reports capacity, remaining and weighted burn', () => {
    const now = T0 + 3 * H;
    const forecast = buildPoolForecast(
      [
        account('a', 1, [point(0, 0, 100), point(3, 30, 100)]),
        account('b', 2.5, [point(0, 50, 50), point(3, 56, 50)]),
      ],
      {
        now,
        from: T0 - 24 * H,
        to: T0 + 10 * 24 * H,
        burnWindowHours: 3,
        futureUsage: 'same',
        horizon: now + 14 * 24 * H,
      }
    );
    expect(forecast.capacity).toBe(350);
    expect(forecast.remaining).toBeCloseTo(70 + 2.5 * 44);
    expect(forecast.burnRate).toBeCloseTo(10 + 2.5 * 2);
    expect(forecast.recorded.at(-1)?.t).toBe(now);
    expect(forecast.projected[0]).toEqual({ t: now, v: forecast.remaining });
    expect(forecast.projectedResets[0].t).toBe(T0 + 50 * H);
  });

  test('follows the earliest reset when weekly-reset routing is on', () => {
    const now = T0 + 3 * H;
    const inputs = [
      // Resets in 7 hours with 78% left, at 1%/h of a 10%/h pool.
      account('soon', 1, [point(0, 19, 10), point(3, 22, 10)]),
      account('later', 1, [point(0, 0, 200), point(3, 27, 200)]),
    ];
    const options = {
      now,
      from: T0,
      to: T0 + 24 * H,
      burnWindowHours: 3,
      futureUsage: 'same' as const,
      horizon: now,
    };
    const split = buildPoolForecast(inputs, options);
    const routed = buildPoolForecast(inputs, { ...options, weeklyResetRouting: true });
    expect(split.nextReset?.amount).toBeCloseTo(22 + 7 * 1);
    expect(routed.nextReset?.amount).toBeCloseTo(22 + 7 * 10);
  });

  test('weighs samples by the plan they were recorded under', () => {
    const now = T0 + 3 * H;
    const forecast = buildPoolForecast(
      [
        // Pro (0.1) upgraded to Max 5x (0.5) at 2 h: its week starts over.
        {
          ...account('up', 0.5, [
            point(0, 50, 100),
            point(1, 54, 100),
            point(2, 0, 100),
            point(3, 2, 100),
          ]),
          earlierWeights: [{ until: T0 + 2 * H, weight: 0.1 }],
        },
        account('u', 1, [point(0, 10, 200), point(3, 13, 200)]),
      ],
      {
        now,
        from: T0 - H,
        to: T0 + 24 * H,
        burnWindowHours: 3,
        futureUsage: 'same',
        horizon: now,
      }
    );
    expect(forecast.capacity).toBe(150);
    expect(forecast.remaining).toBeCloseTo(0.5 * 98 + 87);
    // The upgrade adds what the Max week holds beyond the Pro week's rest.
    expect(forecast.recordedResets).toHaveLength(1);
    expect(forecast.recordedResets[0].t).toBe(T0 + 2 * H);
    expect(forecast.recordedResets[0].amount).toBeCloseTo(0.5 * 100 - 0.1 * 46);
    expect(valueAt(forecast.recorded, T0 + 2 * H, 'pre')).toBeCloseTo(0.1 * 46 + 88);
    expect(valueAt(forecast.recorded, T0 + 2 * H, 'post')).toBeCloseTo(0.5 * 100 + 88);
    // Pro use counts at the Pro size: 0.4 + 1 pool points in 3 h, plus u's 1 %/h.
    expect(forecast.burnRate).toBeCloseTo(1.4 / 3 + 1);
    const up = forecast.accounts.find((item) => item.key === 'up');
    expect(0.5 * valueAt(up?.recorded ?? [], T0 + H)).toBeCloseTo(0.1 * 46);
  });

  test('a paused future keeps the pool flat apart from resets', () => {
    const now = T0 + 3 * H;
    const forecast = buildPoolForecast([account('a', 1, [point(0, 0), point(3, 30)])], {
      now,
      from: T0,
      to: T0 + 48 * H,
      burnWindowHours: 3,
      futureUsage: 'none',
      horizon: now,
    });
    expect(forecast.projected.at(-1)?.v).toBeCloseTo(70);
    expect(forecast.poolEmptyAt).toBeNull();
  });
});

describe('history normalization', () => {
  test('maps backend fields and drops malformed entries', () => {
    const history = normalizeQuotaHistory({
      enabled: true,
      now: 5,
      poll_interval_seconds: 600,
      accounts: [
        {
          auth_id: 'claude-a.json',
          auth_index: 'abc',
          file_name: 'claude-a.json',
          provider: 'Claude',
          email: 'a@example.com',
          plan: 'MAX',
          plans: [[4000, 'MAX5'], [2000, 'pro'], ['bad']],
          windows: [
            {
              id: 'seven_day',
              period_seconds: 604800,
              points: [[2, 140, null], [1, 10, 9], ['bad']],
            },
            { id: 'five_hour', period_seconds: 18000, points: [[1, 5, null]], dropped_at: 2 },
          ],
        },
        { provider: 'codex' },
      ],
    });
    expect(history.accounts).toHaveLength(1);
    expect(history.accounts[0].provider).toBe('claude');
    expect(history.accounts[0].plan).toBe('max');
    expect(history.accounts[0].plans).toEqual([
      { t: 2000, plan: 'pro' },
      { t: 4000, plan: 'max5' },
    ]);
    expect(history.accounts[0].windows[0].points).toEqual([
      { t: 1, used: 10, resetAt: 9 },
      { t: 2, used: 100, resetAt: null },
    ]);
    expect(history.accounts[0].windows.map((window) => window.droppedAt)).toEqual([null, 2]);
  });
});

describe('quota history routing report', () => {
  test("reads each account's routing placement", () => {
    const history = normalizeQuotaHistory({
      enabled: true,
      accounts: [
        {
          auth_id: 'a',
          provider: 'claude',
          windows: [],
          routing: {
            deadline: 1800000000000,
            session_limited: true,
            session_share: 28.2,
            drain: 3.87,
          },
        },
        { auth_id: 'b', provider: 'claude', windows: [], routing: { session_limited: false } },
        { auth_id: 'c', provider: 'claude', windows: [] },
      ],
    });
    expect(history.accounts.map((account) => account.routing)).toEqual([
      { deadline: 1800000000000, sessionLimited: true, sessionShare: 28.2, drain: 3.87 },
      { deadline: null, sessionLimited: false, sessionShare: null, drain: null },
      null,
    ]);
  });
});
