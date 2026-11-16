import { describe, expect, test } from 'bun:test';
import { buildDashboard, measuredRates, projectPool } from '../server/quota/domain';
import type { DashboardOptions } from '../server/quota/domain';
import type { QuotaSample, StoredAccount } from '../server/quota/types';
import { HOUR_MS, STALE_MS } from '../server/quota/types';

const now = Date.UTC(2026, 9, 27, 12);
const account = (id = 'a', patch: Partial<StoredAccount> = {}): StoredAccount => ({
  id,
  provider: 'claude',
  name: 'private-file.json',
  email: 'private@example.test',
  disabled: false,
  retired: false,
  lastSeenAtMs: now,
  lastErrorAtMs: null,
  ...patch,
});
const sample = (at: number, remaining: number, patch: Partial<QuotaSample> = {}): QuotaSample => ({
  accountId: 'a',
  window: 'weekly',
  observedAtMs: at,
  remainingPercent: remaining,
  resetAtMs: now + HOUR_MS,
  periodHours: 168,
  ...patch,
});
const options: DashboardOptions = {
  nowMs: now,
  window: 'weekly',
  lookbackHours: 3,
  multiplier: 1,
  offsetDays: 0,
  reveal: false,
};
const collection = {
  historyStartedAtMs: now,
  lastRefreshAtMs: now,
  nextRefreshAtMs: now + 300_000,
  refreshing: false,
  issues: [],
};
const dashboard = (
  accounts: StoredAccount[],
  samples: QuotaSample[],
  patch: Partial<DashboardOptions> = {}
) => buildDashboard(accounts, samples, { ...options, ...patch }, collection);

describe('measured quota rates', () => {
  test('requires actual observation span, not a fresh balance', () => {
    expect(measuredRates([sample(now, 60)], now, 3).burn).toBeNull();
    expect(measuredRates([sample(now - 60_000, 61), sample(now, 60)], now, 3).burn).toBeNull();
    expect(measuredRates([sample(now - 600_000, 70), sample(now, 60)], now, 3).burn).toBe(60);
  });
  test('resets replenish drain but never produce negative burn', () => {
    const points = [sample(now - 600_000, 10, { resetAtMs: now - 300_000 }), sample(now, 95)];
    expect(measuredRates(points, now, 3)).toEqual({ burn: null, drain: -510 });
  });
  test('outages, future samples and stale samples do not become known rates', () => {
    expect(
      measuredRates([sample(now - STALE_MS - 1, 80), sample(now, 50)], now, 3).burn
    ).toBeNull();
    expect(measuredRates([sample(now - 600_000, 80), sample(now + 1, 50)], now, 3).burn).toBeNull();
    expect(
      measuredRates([sample(now - 1_800_000, 80), sample(now - 1_200_000, 50)], now, 3).burn
    ).toBeNull();
  });
});

describe('pooled forecast scenarios', () => {
  test('fractional depletion instants finish without timestamp-rounding loops', () => {
    const samples = [sample(now - 600_000, 67), sample(now, 14)];
    const pool = dashboard([account()], samples).pools[0];
    expect(pool.forecastState).toBe('ready');
    expect(pool.firstEmptyAtMs).toBeCloseTo(now + (14 / 318) * HOUR_MS, 0);
    expect(pool.projected.some((point) => point.remainingPoints === 0)).toBe(true);
    const tiny = projectPool(
      [{ remaining: 2e-8, rate: 600, resetAtMs: now + HOUR_MS, periodHours: 5, capacity: 100 }],
      now,
      now + HOUR_MS
    );
    expect(tiny.poolEmptyAtMs).toBe(now);
    expect(tiny.points.at(-1)?.remainingPoints).toBe(100);
  });
  test('records reset jumps at the same instant and caps each account at 100', () => {
    const result = projectPool(
      [{ remaining: 50, rate: 10, resetAtMs: now + HOUR_MS, periodHours: 5, capacity: 100 }],
      now,
      now + 2 * HOUR_MS
    );
    expect(result.resets).toEqual([{ atMs: now + HOUR_MS, gainPoints: 60 }]);
    expect(
      result.points.filter((p) => p.atMs === now + HOUR_MS).map((p) => p.remainingPoints)
    ).toEqual([40, 100]);
    expect(result.points.at(-1)?.remainingPoints).toBe(90);
    expect(result.poolEmptyAtMs).toBeNull();
  });
  test('distinguishes first account empty from the entire pool empty', () => {
    const result = projectPool(
      [
        { remaining: 10, rate: 10, resetAtMs: now + 5 * HOUR_MS, periodHours: 168, capacity: 100 },
        { remaining: 40, rate: 20, resetAtMs: now + 5 * HOUR_MS, periodHours: 168, capacity: 100 },
      ],
      now,
      now + 3 * HOUR_MS
    );
    // Fill-first: the pool's 30/h drains A (10) in 20 minutes, then B (40) by 100 minutes.
    expect(result.firstEmptyAtMs).toBe(now + HOUR_MS / 3);
    expect(result.poolEmptyAtMs).toBe(now + (5 * HOUR_MS) / 3);
    expect(result.points.every((p) => (p.remainingPoints ?? 0) >= 0)).toBe(true);
  });
  test('fill-first: pool demand moves to whichever account has quota, soonest reset first', () => {
    // Two drained accounts and one serving all traffic, as on the live Claude pool.
    const result = projectPool(
      [
        { remaining: 0, rate: 0, resetAtMs: now + 19 * HOUR_MS, periodHours: 168, capacity: 2000 },
        { remaining: 0, rate: 0, resetAtMs: now + 84 * HOUR_MS, periodHours: 168, capacity: 2000 },
        {
          remaining: 420,
          rate: 54,
          resetAtMs: now + 138 * HOUR_MS,
          periodHours: 168,
          capacity: 2000,
        },
      ],
      now,
      now + 150 * HOUR_MS
    );
    const at = (hours: number) =>
      result.points.filter((p) => p.atMs <= now + hours * HOUR_MS).at(-1)?.remainingPoints;
    expect(result.poolEmptyAtMs).toBeCloseTo(now + (420 / 54) * HOUR_MS, -3);
    // The first account's reset is consumed at the pool's burn rate, not left idle.
    expect(at(29)).toBeCloseTo(2000 - 54 * 10, 6);
    expect(at(84 - 0.01)).toBe(0);
    expect(at(94)).toBeCloseTo(2000 - 54 * 10, 6);
    expect(result.resets.map((r) => r.gainPoints)).toEqual([2000, 2000, 2000]);
  });
  test('idle retains remaining balance until the observed reset', () => {
    const result = projectPool(
      [{ remaining: 30, rate: 0, resetAtMs: now + HOUR_MS, periodHours: 168, capacity: 100 }],
      now,
      now + 2 * HOUR_MS
    );
    expect(result.poolEmptyAtMs).toBeNull();
    expect(result.points.at(-1)?.remainingPoints).toBe(100);
    expect(result.resets[0].gainPoints).toBe(70);
  });
});

describe('dashboard evidence and privacy', () => {
  test('normalizes enabled accounts once and keeps providers separate', () => {
    const result = dashboard(
      [account(), account('b', { provider: 'codex' }), account('disabled', { disabled: true })],
      [
        sample(now, 50),
        sample(now, 80, { accountId: 'b' }),
        sample(now, 100, { accountId: 'disabled' }),
      ]
    );
    expect(result.pools.map((p) => [p.remainingPoints, p.capacityPoints])).toEqual([
      [50, 100],
      [80, 100],
    ]);
    expect(result.pools[0].forecastState).toBe('collecting');
    expect(JSON.stringify(result)).not.toContain('private');
    expect(
      dashboard([account()], [sample(now, 50)], { reveal: true }).pools[0].accounts[0].email
    ).toBe('private@example.test');
  });
  test('missing windows and stale balances are unknown, not zero', () => {
    expect(dashboard([account()], []).pools[0].remainingPoints).toBeNull();
    const stale = dashboard([account()], [sample(now - STALE_MS - 1, 50)]).pools[0];
    expect(stale.remainingPoints).toBeNull();
    expect(stale.forecastState).toBe('stale');
    expect(stale.projected).toEqual([]);
  });
  test('expired windows are unknown until another successful observation', () => {
    const pool = dashboard([account()], [sample(now, 2, { resetAtMs: now })]).pools[0];
    expect(pool.remainingPoints).toBeNull();
    expect(pool.nextResetAtMs).toBeNull();
  });
  test('missing observations immediately supersede balances and break rate intervals', () => {
    const samples = [sample(now - 600_000, 60), sample(now, 0, { remainingPercent: null })];
    const pool = dashboard([account()], samples).pools[0];
    expect(pool.remainingPoints).toBeNull();
    expect(pool.accounts[0].status).toBe('missing-window');
    expect(pool.recorded.at(-1)?.remainingPoints).toBeNull();
    expect(measuredRates(samples, now, 3)).toEqual({ burn: null, drain: null });
    expect(measuredRates([sample(now - 1_200_000, 80), ...samples], now, 3)).toEqual({
      burn: null,
      drain: null,
    });
    expect(
      dashboard([account()], [...samples, sample(now + 1, 50)], { nowMs: now + 1 }).pools[0]
        .remainingPoints
    ).toBe(50);
  });
  test('weekly and five-hour windows are never combined', () => {
    const result = dashboard(
      [account()],
      [sample(now, 50), sample(now, 80, { window: 'five-hour' })],
      { window: 'five-hour' }
    );
    expect(result.pools[0].remainingPoints).toBe(80);
  });
  test('complete observations enable forecasts, incomplete account sets suppress them', () => {
    const samples = [sample(now - 600_000, 60), sample(now, 50)];
    expect(dashboard([account()], samples).pools[0].forecastState).toBe('ready');
    expect(dashboard([account(), account('missing')], samples).pools[0].projected).toEqual([]);
  });
  test('a failed poll does not hide a sample that is still fresh', () => {
    const samples = [sample(now - 720_000, 60), sample(now - 120_000, 50)];
    const pool = dashboard([account('a', { lastErrorAtMs: now })], samples).pools[0];
    expect(pool.accounts[0].status).toBe('ok');
    expect(pool.forecastState).toBe('ready');
    expect(pool.remainingPoints).toBe(50);
  });
  test('failed polls count once the latest sample is stale or absent', () => {
    const stale = [sample(now - STALE_MS - 1, 50)];
    for (const samples of [stale, []]) {
      const pool = dashboard([account('a', { lastErrorAtMs: now })], samples).pools[0];
      expect(pool.accounts[0].status).toBe('error');
      expect(pool.remainingPoints).toBeNull();
    }
  });
  test('inventory failure preserves uncertainty even when previous quota samples are current', () => {
    const result = buildDashboard([account()], [sample(now, 50)], options, {
      ...collection,
      issues: [{ provider: 'claude', code: 'inventory-unavailable' }],
    });
    expect(result.pools[0].remainingPoints).toBeNull();
    expect(result.pools[0].forecastState).toBe('partial');
  });
  test('accounts carry the latest reset reading without leaking the collection map', () => {
    const resets = {
      available: 2,
      usable: 1,
      blocker: null,
      nextExpiryAtMs: now + HOUR_MS,
      observedAtMs: now,
    };
    const result = buildDashboard([account()], [sample(now, 50)], options, {
      ...collection,
      resets: new Map([[account().id, resets]]),
    });
    expect(result.pools[0].accounts[0].resets).toEqual(resets);
    expect('resets' in result).toBe(false);
    expect(dashboard([account()], []).pools[0].accounts[0].resets).toBeNull();
  });
  test('accounts carry their latest reported windows and nothing extra leaks', () => {
    const fiveHour = {
      id: 'five-hour',
      labelKey: 'claude_quota.five_hour',
      remainingPercent: 30,
      resetAtMs: now + HOUR_MS,
    };
    const result = buildDashboard([account()], [sample(now, 50)], options, {
      ...collection,
      windows: new Map([[account().id, [fiveHour]]]),
    });
    expect(result.pools[0].accounts[0].windows).toEqual([fiveHour]);
    expect('windows' in result).toBe(false);
    expect(dashboard([account()], [sample(now, 50)]).pools[0].accounts[0].windows).toEqual([]);
  });
  test('recorded histories hold the last balance flat across a stretch with no reports', () => {
    const recorded = dashboard([account()], [sample(now - HOUR_MS, 80), sample(now, 50)]).pools[0]
      .recorded;
    expect(recorded.map((p) => [p.atMs, p.remainingPoints])).toEqual([
      [now - HOUR_MS, 80],
      [now - 1, 80],
      [now, 50],
    ]);
    expect(recorded[1].burnPointsPerHour).toBeNull();
  });
  test('an explicit missing observation is not held across the gap after it', () => {
    const samples = [sample(now - HOUR_MS, 0, { remainingPercent: null }), sample(now, 50)];
    const recorded = dashboard([account()], samples).pools[0].recorded;
    expect(recorded.map((p) => p.remainingPoints)).toEqual([null, null, 50]);
  });
  describe('an account silent while others report (e.g. disabled for a while)', () => {
    // One quiet account never blanks the pool: its own readings fill its share of the total.
    const minutes = 60_000;
    const steady = Array.from({ length: 25 }, (_, i) => sample(now - 2 * HOUR_MS + i * 5 * minutes, 50));
    const at = (recorded: { atMs: number; remainingPoints: number | null }[], t: number) =>
      recorded.find((p) => p.atMs === t)?.remainingPoints;
    const run = (
      before: number,
      after: number,
      afterPatch: Partial<QuotaSample> = {},
      beforePatch: Partial<QuotaSample> = {}
    ) =>
      dashboard(
        [account('a'), account('b')],
        [
          ...steady,
          sample(now - 2 * HOUR_MS, before, { accountId: 'b', ...beforePatch }),
          sample(now, after, { accountId: 'b', ...afterPatch }),
        ]
      ).pools[0].recorded;
    test('is a straight line between its own readings when both sides share a reset cycle', () => {
      // b read 90, went silent, then read 80 in the same cycle: halfway it held 85.
      expect(at(run(90, 80), now - HOUR_MS)).toBe(50 + 85);
    });
    test('holds its last reading when its balance rose across the gap (a reset was used)', () => {
      expect(at(run(80, 95), now - HOUR_MS)).toBe(50 + 80);
    });
    test('holds its last reading while its cycle has not reset, even if the next one is in a new cycle', () => {
      expect(at(run(90, 80, { resetAtMs: now + 200 * HOUR_MS }), now - HOUR_MS)).toBe(50 + 90);
    });
    test('counts a window that reset during the silence as refilled', () => {
      // b's cycle ended at now - 90 min with no reading since: the reset restored it to 100%.
      expect(
        at(run(10, 95, { resetAtMs: now + 100 * HOUR_MS }, { resetAtMs: now - 90 * minutes }), now - HOUR_MS)
      ).toBe(50 + 100);
    });
    test('an explicit missing observation is still unknown', () => {
      expect(at(run(90, 0, {}, { remainingPercent: null }), now - HOUR_MS)).toBeNull();
    });
    test('current balances never use an estimate', () => {
      const data = dashboard([account('a'), account('b')], [...steady, sample(now - 2 * HOUR_MS, 90, { accountId: 'b' })]);
      expect(data.pools[0].remainingPoints).toBeNull();
    });
  });
  test('an account added later joins the history at its first sample instead of blanking it', () => {
    const minutes = 60_000;
    const accounts = [
      account('a', { firstSampleAtMs: now - 2 * HOUR_MS }),
      account('b', { firstSampleAtMs: now }),
    ];
    const samples = [
      sample(now - 10 * minutes, 80),
      sample(now - 5 * minutes, 70),
      sample(now, 60),
      sample(now, 40, { accountId: 'b' }),
    ];
    const recorded = dashboard(accounts, samples).pools[0].recorded;
    expect(recorded.map((p) => [p.atMs, p.remainingPoints])).toEqual([
      [now - 10 * minutes, 80],
      [now - 5 * minutes, 70],
      [now, 100],
    ]);
  });
  test('a provider added later stacks as zero before it joined, matching the combined total', () => {
    const minutes = 60_000;
    const accounts = [
      account('c', { provider: 'codex', firstSampleAtMs: now - 2 * HOUR_MS }),
      account('b', { firstSampleAtMs: now }),
    ];
    const samples = [
      sample(now - 5 * minutes, 70, { accountId: 'c' }),
      sample(now, 60, { accountId: 'c' }),
      sample(now, 40, { accountId: 'b' }),
    ];
    const all = dashboard(accounts, samples).combined.all;
    expect(all.series?.recorded.map((p) => p.remainingPoints)).toEqual([70, 100]);
    const layer = (provider: string) =>
      all.layers
        ?.find((entry) => entry.provider === provider)
        ?.recorded.map((p) => p.remainingPoints);
    expect(layer('claude')).toEqual([0, 40]);
    expect(layer('codex')).toEqual([70, 60]);
  });
  test('an account that reported before stays unknown while it is missing', () => {
    const minutes = 60_000;
    const accounts = [
      account('a', { firstSampleAtMs: now - 2 * HOUR_MS }),
      account('b', { firstSampleAtMs: now - 2 * HOUR_MS }),
    ];
    const samples = [
      sample(now - 5 * minutes, 70),
      sample(now, 60),
      sample(now, 40, { accountId: 'b' }),
    ];
    const recorded = dashboard(accounts, samples).pools[0].recorded;
    expect(recorded.map((p) => p.remainingPoints)).toEqual([null, 100]);
  });
  test('future scenarios scale predictions without changing recorded balances or rates', () => {
    const samples = [sample(now - 600_000, 60), sample(now, 50)];
    const normal = dashboard([account()], samples).pools[0];
    const doubled = dashboard([account()], samples, { multiplier: 2 }).pools[0];
    expect(doubled.recorded).toEqual(normal.recorded);
    expect(doubled.firstEmptyAtMs! - now).toBe((normal.firstEmptyAtMs! - now) / 2);
  });
});

describe('accounts without a five-hour limit', () => {
  const fiveHour = (accountId: string, remaining: number | null, at = now) =>
    sample(at, remaining ?? 0, {
      accountId,
      window: 'five-hour',
      remainingPercent: remaining,
      resetAtMs: remaining === null ? null : now + HOUR_MS,
      periodHours: remaining === null ? null : 5,
    });
  const ultra = account('u', { plan: 'default_claude_max_20x' });
  const pro = account('p', { plan: 'claude_pro' });
  const steady = [fiveHour('p', 60, now - 600_000), fiveHour('p', 50)];

  test('an Ultra account answering without a five-hour window is left out of that pool, not unknown', () => {
    const view = dashboard([ultra, pro], [fiveHour('u', null), ...steady], { window: 'five-hour' });
    const pool = view.pools[0];
    expect(pool.accounts.find((a) => a.id === 'u')?.status).toBe('no-limit');
    expect(pool.accountCount).toBe(2);
    expect(pool.eligibleCount).toBe(1);
    expect(pool.capacityPoints).toBe(100);
    expect(pool.forecastState).not.toBe('partial');
    expect(pool.remainingPoints).toBe(50);
    expect(view.combined?.claude.series?.remainingPoints).not.toBeNull();
  });
  test('the weekly pool still counts that account', () => {
    const weekly = (id: string) => sample(now, 80, { accountId: id });
    const pool = dashboard([ultra, pro], [weekly('u'), weekly('p')]).pools[0];
    expect(pool.accounts.find((a) => a.id === 'u')?.status).toBe('ok');
    expect(pool.eligibleCount).toBe(2);
  });
  test('only Ultra is exempt; a missing five-hour window on any other plan stays unknown', () => {
    const pool = dashboard([pro], [fiveHour('p', null)], { window: 'five-hour' }).pools[0];
    expect(pool.accounts[0].status).toBe('missing-window');
    expect(pool.forecastState).toBe('partial');
  });
  test('a pool of only such accounts says so instead of claiming no accounts', () => {
    const pool = dashboard([ultra], [fiveHour('u', null)], { window: 'five-hour' }).pools[0];
    expect(pool.forecastState).toBe('no-limit');
    expect(pool.eligibleCount).toBe(0);
  });
  test('a stale answer does not count as proof the limit is gone', () => {
    const old = now - STALE_MS - 1;
    const pool = dashboard(
      [account('u', { plan: 'default_claude_max_20x', lastSeenAtMs: old })],
      [fiveHour('u', null, old)],
      {
        window: 'five-hour',
      }
    ).pools[0];
    expect(pool.accounts[0].status).toBe('stale');
  });
});

describe('Codex accounts whose provider reports only a weekly window', () => {
  const codex = (id: string, patch: Partial<StoredAccount> = {}) =>
    account(id, { provider: 'codex', plan: 'pro', ...patch });
  // One successful read writes both lanes at the same instant: the weekly balance, and a null
  // five-hour sample when the payload has no five-hour window.
  const weekly = (accountId: string, at = now) => sample(at, 17, { accountId, periodHours: 168 });
  const missingFiveHour = (accountId: string, at = now) =>
    sample(at, 0, {
      accountId,
      window: 'five-hour',
      remainingPercent: null,
      resetAtMs: null,
      periodHours: null,
    });
  const fiveHour = (accountId: string, remaining: number, at = now) =>
    sample(at, remaining, { accountId, window: 'five-hour', periodHours: 5 });
  const codexPool = (view: ReturnType<typeof dashboard>) =>
    view.pools.find((pool) => pool.provider === 'codex')!;
  const view = (accounts: StoredAccount[], samples: QuotaSample[]) =>
    dashboard(accounts, samples, { window: 'five-hour' });

  test('is no-limit in the five-hour pool, outside its capacity, and does not withhold the total', () => {
    const accounts = [codex('c'), codex('d')];
    const samples = [
      weekly('c'),
      missingFiveHour('c'),
      fiveHour('d', 60, now - 600_000),
      fiveHour('d', 50),
    ];
    const result = view(accounts, samples);
    const pool = codexPool(result);
    expect(pool.accounts.find((a) => a.id === 'c')?.status).toBe('no-limit');
    expect(pool.accounts.find((a) => a.id === 'c')?.noFiveHourLimit).toBe(true);
    expect(pool.accountCount).toBe(2);
    expect(pool.eligibleCount).toBe(1);
    expect(pool.capacityPoints).toBe(1000);
    expect(pool.forecastState).not.toBe('partial');
    expect(pool.remainingPoints).toBe(500);
    expect(result.combined?.codex.series?.remainingPoints).not.toBeNull();
  });
  test('a pool of only such accounts says so instead of withholding', () => {
    const pool = codexPool(view([codex('c')], [weekly('c'), missingFiveHour('c')]));
    expect(pool.forecastState).toBe('no-limit');
    expect(pool.eligibleCount).toBe(0);
  });
  test('the weekly pool still counts that account, and flags it', () => {
    const pool = codexPool(dashboard([codex('c')], [weekly('c'), missingFiveHour('c')]));
    expect(pool.accounts[0].status).toBe('ok');
    expect(pool.accounts[0].noFiveHourLimit).toBe(true);
    expect(pool.eligibleCount).toBe(1);
  });
  test('an account that reports a five-hour window is unchanged', () => {
    const pool = codexPool(view([codex('c')], [weekly('c'), fiveHour('c', 40)]));
    expect(pool.accounts[0].status).toBe('ok');
    expect(pool.accounts[0].noFiveHourLimit).toBeFalsy();
    expect(pool.eligibleCount).toBe(1);
    expect(pool.capacityPoints).toBe(1000);
  });
  test('a reading with no weekly window either stays missing, not no-limit', () => {
    const empty = sample(now, 0, { window: 'weekly', remainingPercent: null });
    const pool = codexPool(view([codex('c')], [empty, missingFiveHour('c')]));
    expect(pool.accounts[0].status).toBe('missing-window');
    expect(pool.accounts[0].noFiveHourLimit).toBeFalsy();
    expect(pool.forecastState).toBe('partial');
  });
  test('a failed read is still errored, and a stale answer is not proof', () => {
    const old = now - STALE_MS - 1;
    const failed = codexPool(view(
      [codex('c', { lastSeenAtMs: old, lastErrorAtMs: now })],
      [weekly('c', old), missingFiveHour('c', old)]
    ));
    expect(failed.accounts[0].status).toBe('error');
    expect(failed.forecastState).not.toBe('no-limit');
    const stale = codexPool(view(
      [codex('c', { lastSeenAtMs: old })],
      [weekly('c', old), missingFiveHour('c', old)]
    ));
    expect(stale.accounts[0].status).toBe('stale');
  });
  test('a later five-hour reading supersedes an earlier weekly-only one', () => {
    const pool = codexPool(view(
      [codex('c')],
      [weekly('c', now - 600_000), missingFiveHour('c', now - 600_000), weekly('c'), fiveHour('c', 40)]
    ));
    expect(pool.accounts[0].status).toBe('ok');
    expect(pool.accounts[0].noFiveHourLimit).toBeFalsy();
  });
  test('Claude Pro without a five-hour window stays unknown (the rule is unchanged)', () => {
    const pool = view(
      [account('p', { plan: 'claude_pro' })],
      [sample(now, 17, { accountId: 'p' }), missingFiveHour('p')]
    ).pools.find((entry) => entry.provider === 'claude')!;
    expect(pool.accounts[0].status).toBe('missing-window');
  });
});

describe('accounts known to have no five-hour limit', () => {
  const fiveHourWindow = {
    id: 'five-hour',
    labelKey: 'claude_quota.five_hour',
    remainingPercent: 50,
    resetAtMs: null,
  };
  const weeklyWindow = {
    id: 'seven-day',
    labelKey: 'claude_quota.seven_day',
    remainingPercent: 80,
    resetAtMs: null,
  };
  const withWindows = (
    accounts: StoredAccount[],
    windows: Record<string, (typeof weeklyWindow)[]>
  ) =>
    buildDashboard(accounts, [sample(now, 80)], options, {
      ...collection,
      windows: new Map(Object.entries(windows)),
    }).pools[0].accounts;
  const ultra = account('u', { plan: 'default_claude_max_20x' });
  const pro = account('p', { plan: 'claude_pro' });
  test('is flagged for Ultra when its latest reading has other windows but no five-hour one', () => {
    const [u] = withWindows([ultra], { u: [weeklyWindow] });
    expect(u.noFiveHourLimit).toBe(true);
  });
  test('is not flagged while the five-hour window is still reported, or before any reading', () => {
    expect(
      withWindows([ultra], { u: [weeklyWindow, fiveHourWindow] })[0].noFiveHourLimit
    ).toBeFalsy();
    expect(withWindows([ultra], {})[0].noFiveHourLimit).toBeFalsy();
  });
  test('is never inferred for other plans', () => {
    expect(withWindows([pro], { p: [weeklyWindow] })[0].noFiveHourLimit).toBeFalsy();
  });
});

describe('account identifiers', () => {
  test('a masked identifier is always sent; the full email only when revealed', () => {
    const hidden = dashboard(
      [account('a', { email: 'ada.lovelace@example.test' })],
      [sample(now, 80)]
    );
    const view = hidden.pools[0].accounts[0];
    expect(view.identifier).toBe('ada•••ce@ex•••.test');
    expect(view.email).toBeUndefined();
    expect(JSON.stringify(hidden)).not.toContain('ada.lovelace');
    const shown = dashboard(
      [account('a', { email: 'ada.lovelace@example.test' })],
      [sample(now, 80)],
      {
        reveal: true,
      }
    );
    expect(shown.pools[0].accounts[0].email).toBe('ada.lovelace@example.test');
  });
  test('names that are not emails are masked too', () => {
    const view = dashboard(
      [account('a', { email: null, name: 'secret-credential-file.json' })],
      [sample(now, 80)]
    );
    const identifier = view.pools[0].accounts[0].identifier;
    expect(identifier).toBe('sec•••on');
    expect(JSON.stringify(view)).not.toContain('credential-file');
  });
});
