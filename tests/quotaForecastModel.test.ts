import { describe, expect, test } from 'bun:test';
import {
  accountBurnRate,
  buildPoolForecast,
  buildRecordedSeries,
  consumedBetween,
  niceCeiling,
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
          windows: [
            {
              id: 'seven_day',
              period_seconds: 604800,
              points: [[2, 140, null], [1, 10, 9], ['bad']],
            },
          ],
        },
        { provider: 'codex' },
      ],
    });
    expect(history.accounts).toHaveLength(1);
    expect(history.accounts[0].provider).toBe('claude');
    expect(history.accounts[0].plan).toBe('max');
    expect(history.accounts[0].windows[0].points).toEqual([
      { t: 1, used: 10, resetAt: 9 },
      { t: 2, used: 100, resetAt: null },
    ]);
  });
});
