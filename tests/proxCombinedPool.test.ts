import { describe, expect, test } from 'bun:test';
import { buildDashboard, type DashboardOptions } from '../server/quota/domain';
import { combineProjections, combinedPools } from '../server/quota/combined';
import type { PoolPoint } from '../src/domain/quotaPool/types';
import type { QuotaSample, StoredAccount } from '../server/quota/types';
import { HOUR_MS, STALE_MS } from '../server/quota/types';

const now = Date.UTC(2026, 9, 28, 12);
const accounts: StoredAccount[] = ['claude', 'codex'].map((provider, index) => ({
  id: `a${index}`,
  instanceId: provider,
  provider: provider as 'claude' | 'codex',
  name: 'private.json',
  email: 'private@example.test',
  disabled: false,
  retired: false,
  lastSeenAtMs: now,
  lastErrorAtMs: null,
}));
const options: DashboardOptions = {
  nowMs: now,
  window: 'weekly',
  lookbackHours: 3,
  multiplier: 1,
  offsetDays: 0,
  reveal: false,
};
const collection = {
  historyStartedAtMs: now - HOUR_MS,
  lastRefreshAtMs: now,
  nextRefreshAtMs: now + 300000,
  refreshing: false,
  issues: [],
};
const samples: QuotaSample[] = accounts.flatMap((account, index) =>
  [0, 1, 2].map((i) => ({
    accountId: account.id,
    window: 'weekly' as const,
    observedAtMs: now - (2 - i) * 300000 - index * 1000,
    remainingPercent: 80 - i * (index + 1),
    resetAtMs: now + (index + 1) * HOUR_MS,
    periodHours: 168,
  }))
);
const point = (atMs: number, remainingPoints: number | null): PoolPoint => ({
  atMs,
  remainingPoints,
  burnPointsPerHour: null,
  drainPointsPerHour: null,
});

describe('combined provider totals', () => {
  test('adds current balances and records at shared observation times using account rules', () => {
    const data = buildDashboard(accounts, samples, options, collection);
    const total = data.combined!.all.series!;
    expect(total.capacityPoints).toBe(200);
    expect(total.remainingPoints).toBe(154);
    expect(total.recorded.at(-1)?.remainingPoints).toBe(154);
    expect(total.recorded[0].remainingPoints).toBeNull(); // Codex arrived first: Claude is not zero.
    expect(total.burnPointsPerHour).toBeCloseTo(
      data.pools.reduce((sum, p) => sum + p.burnPointsPerHour!, 0),
      8
    );
    expect(total.projected[0].remainingPoints).toBe(154);
    expect(JSON.stringify(total)).not.toContain('private');
    expect(data.combined!.claude.series?.remainingPoints).toBe(78);
    expect(data.combined!.codex.series?.remainingPoints).toBe(76);
  });
  test('returns aligned per-provider contributions with the same totals and no account metadata', () => {
    const combined = buildDashboard(accounts, samples, options, collection).combined!.all;
    expect(combined.layers?.map((layer) => layer.provider)).toEqual(['claude', 'codex']);
    for (const kind of ['recorded', 'projected'] as const) {
      const total = combined.series![kind];
      for (const layer of combined.layers!) {
        expect(layer[kind].map((point) => point.atMs)).toEqual(total.map((point) => point.atMs));
        expect('accounts' in layer).toBe(false);
      }
      total.forEach((point, index) => {
        if (point.remainingPoints !== null)
          expect(
            combined.layers!.reduce((sum, layer) => sum + layer[kind][index].remainingPoints!, 0)
          ).toBeCloseTo(point.remainingPoints, 8);
      });
    }
    expect(JSON.stringify(combined.layers)).not.toContain('private');
    const projected = combined.series!.projected;
    const resetIndex = projected.findIndex(
      (point, index) => index > 0 && point.atMs === projected[index - 1].atMs
    );
    expect(resetIndex).toBeGreaterThan(0);
    const codex = combined.layers!.find((layer) => layer.provider === 'codex')!;
    // Claude's first reset must not introduce a jump in Codex's layer.
    expect(codex.projected[resetIndex].remainingPoints).toBe(
      codex.projected[resetIndex - 1].remainingPoints
    );
  });

  test('preserves independent consumption and simultaneous or staggered reset jumps', () => {
    const a = [point(0, 10), point(10, 0), point(10, 100), point(20, 90)];
    const b = [point(0, 30), point(5, 25), point(5, 75), point(20, 60)];
    expect(combineProjections([a, b]).map((p) => [p.atMs, p.remainingPoints])).toEqual([
      [0, 40],
      [5, 30],
      [5, 80],
      [10, 70],
      [10, 170],
      [20, 150],
    ]);
    expect(
      combineProjections([a, a])
        .filter((p) => p.atMs === 10)
        .map((p) => p.remainingPoints)
    ).toEqual([0, 200]);
  });
  test('never fills missing projection endpoints, gaps or absent traces', () => {
    expect(
      combineProjections([
        [point(0, 10), point(10, null), point(20, 5)],
        [point(5, 20), point(15, 10)],
      ]).map((p) => p.remainingPoints)
    ).toEqual([null, null, null, null, null]);
    expect(combineProjections([[], [point(0, 10)]])).toEqual([]);
  });
  test('no reports hold the total and every provider layer flat instead of breaking', () => {
    const gap = accounts.flatMap((account, index) =>
      [now - 2 * HOUR_MS, now].map((observedAtMs, i) => ({
        accountId: account.id,
        window: 'weekly' as const,
        observedAtMs,
        remainingPercent: i ? 50 : 80,
        resetAtMs: now + (index + 1) * HOUR_MS,
        periodHours: 168,
      }))
    );
    const all = buildDashboard(accounts, gap, options, collection).combined!.all;
    expect(all.series!.recorded.map((p) => [p.atMs, p.remainingPoints])).toEqual([
      [now - 2 * HOUR_MS, 160],
      [now - 1, 160],
      [now, 100],
    ]);
    for (const layer of all.layers!) {
      expect(layer.recorded.map((p) => p.remainingPoints)).toEqual([80, 80, 50]);
    }
  });
  test('unknown current windows suppress the total and forecast, keeping known history', () => {
    const broken = samples.map((s) =>
      s.accountId === 'a1' && s.observedAtMs === now - 1000 ? { ...s, remainingPercent: null } : s
    );
    const data = buildDashboard(accounts, broken, options, collection);
    expect(data.combined!.all.series!.remainingPoints).toBeNull();
    expect(data.combined!.all.series!.recorded.at(-1)?.remainingPoints).toBeNull();
    expect(data.combined!.all.series!.projected).toEqual([]);
  });
  test('stale and expired observations contribute an estimate, never blank the total', () => {
    for (const [patch, codex] of [
      [{ observedAtMs: now - STALE_MS - 1 }, 76],
      [{ resetAtMs: now - 1 }, 100],
    ] as const) {
      const old = samples
        .filter((s) => s.accountId === 'a0')
        .concat({ ...samples.at(-1)!, ...patch });
      const data = buildDashboard(accounts, old, options, collection);
      const claude = data.pools.find((pool) => pool.provider === 'claude')!.remainingPoints!;
      expect(data.combined!.all.series!.remainingPoints).toBe(claude + codex);
      expect(data.combined!.all.series!.forecastState).not.toBe('ready');
    }
  });
  test('does not inflate capacity from duplicate same-provider sources or empty failures', () => {
    const data = buildDashboard(accounts, samples, options, collection);
    const a = data.pools.find((p) => p.provider === 'claude')!;
    let read = false;
    expect(
      combinedPools([a, { ...a, instanceId: 'second' }], () => {
        read = true;
        return [];
      })
    ).toEqual({ series: null, unavailableReason: 'ambiguous-sources' });
    expect(read).toBe(false);
    const failed = {
      ...a,
      provider: 'codex' as const,
      accounts: [],
      eligibleCount: 0,
      accountCount: 0,
      forecastState: 'partial' as const,
      remainingPoints: null,
    };
    const total = combinedPools([a, failed], () => a.recorded).series!;
    expect(total.remainingPoints).toBeNull();
    expect(total.recorded).toEqual([]);
    expect(total.projected).toEqual([]);
  });
  test('excludes disabled, retired and unresolved accounts from displayed totals', () => {
    const extra = { ...accounts[0], id: 'extra', instanceId: undefined };
    const data = buildDashboard([...accounts, extra], samples, options, {
      ...collection,
      sources: [
        { instanceId: 'claude', sourceLabel: 'Claude' },
        { instanceId: 'codex', sourceLabel: 'Codex' },
      ],
    });
    expect(data.combined!.all.series!.capacityPoints).toBe(200);
    for (const patch of [{ disabled: true }, { retired: true }]) {
      const result = buildDashboard(
        [{ ...accounts[0], ...patch }, accounts[1]],
        samples,
        options,
        collection
      );
      expect(result.combined!.all.series!.remainingPoints).toBe(76);
      expect(result.combined!.all.series!.capacityPoints).toBe(100);
    }
    expect(buildDashboard([], [], options, collection).combined!.all.unavailableReason).toBe(
      'no-accounts'
    );
  });
  test('a provider with no 5-hour limit adds nothing and never empties the 5-hour total', () => {
    // Codex answered with a weekly window and an explicit missing 5-hour one (same reading), so it
    // has no 5-hour limit. The combined 5-hour total and its history are Claude's alone.
    const fiveHour: QuotaSample[] = [0, 1, 2].flatMap((i) => {
      const at = now - (2 - i) * 300000;
      return [
        { accountId: 'a0', window: 'five-hour' as const, observedAtMs: at, remainingPercent: 90 - i, resetAtMs: now + HOUR_MS, periodHours: 5 },
        { accountId: 'a0', window: 'weekly' as const, observedAtMs: at, remainingPercent: 80, resetAtMs: now + 100 * HOUR_MS, periodHours: 168 },
        { accountId: 'a1', window: 'weekly' as const, observedAtMs: at + 1000, remainingPercent: 50, resetAtMs: now + 100 * HOUR_MS, periodHours: 168 },
        { accountId: 'a1', window: 'five-hour' as const, observedAtMs: at + 1000, remainingPercent: null, resetAtMs: null, periodHours: null },
      ];
    });
    const data = buildDashboard(accounts, fiveHour, { ...options, window: 'five-hour' }, collection);
    const claude = data.combined!.claude.series!;
    const total = data.combined!.all.series!;
    expect(data.pools.find((pool) => pool.provider === 'codex')!.forecastState).toBe('no-limit');
    expect(total.capacityPoints).toBe(claude.capacityPoints);
    expect(total.remainingPoints).toBe(claude.remainingPoints);
    expect(total.forecastState).toBe(claude.forecastState);
    expect(total.recorded.length).toBeGreaterThan(0);
    expect(total.recorded).toEqual(claude.recorded);
  });

  test('plan weights, scenarios and both windows use the same authoritative total', () => {
    for (const window of ['weekly', 'five-hour'] as const)
      for (const multiplier of [0, 0.5, 1, 2] as const) {
        const data = buildDashboard(
          accounts.map((a) => ({
            ...a,
            plan: a.provider === 'claude' ? 'default_claude_max_20x' : 'promax',
          })),
          samples.map((s) => ({ ...s, window })),
          { ...options, window, multiplier },
          collection
        );
        const total = data.combined!.all.series!;
        expect(total.capacityPoints).toBe(data.pools.reduce((sum, p) => sum + p.capacityPoints, 0));
        expect(total.remainingPoints).toBe(
          data.pools.reduce((sum, p) => sum + p.remainingPoints!, 0)
        );
        expect(total.capacityPoints).toBe(4500);
        expect(total.remainingPoints).toBe(3460);
        expect(total.projected.at(-1)?.atMs).toBe(
          Math.max(...data.pools.map((pool) => pool.projected.at(-1)!.atMs))
        );
        expect(total.projected.at(-1)!.atMs).toBeLessThanOrEqual(data.toMs);
      }
  });
});
