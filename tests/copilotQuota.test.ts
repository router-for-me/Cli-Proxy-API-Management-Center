import { describe, expect, test } from 'bun:test';
import { COPILOT_CONFIG, parseCopilotQuota } from '../src/features/quota/providers/copilot/data';
import {
  useQuotaStore,
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
} from '../src/stores/useQuotaStore';
import { collectQuotaRowInstants } from '../src/features/quota/resetSchedule';

describe('GitHub Copilot quota', () => {
  test('preserves account allowance, usage, overage, and reset date', () => {
    const parsed = parseCopilotQuota({
      copilot_plan: 'individual',
      quota_reset_date: '2026-10-01',
      quota_snapshots: {
        premium_interactions: {
          entitlement: 300,
          remaining: 225,
          percent_remaining: 75,
          overage_count: 2.5,
          overage_permitted: true,
        },
        chat: { entitlement: -1, unlimited: true },
      },
    });
    expect(parsed.plan).toBe('individual');
    expect(parsed.rows[0]).toMatchObject({
      id: 'premium_interactions',
      used: 75,
      percent: 75,
      overage: 2.5,
      overageAllowed: true,
    });
    expect(parsed.rows[1].unlimited).toBe(true);
    expect(
      collectQuotaRowInstants('github-copilot', { status: 'success', ...parsed })[0].atMs
    ).toBe(Date.parse('2026-10-01'));
  });

  test('handles unknown limits, numeric strings, and invalid values without inventing zero usage', () => {
    expect(parseCopilotQuota(null).rows).toEqual([]);
    const { rows } = parseCopilotQuota({
      quota_snapshots: {
        future_credit_quota: { entitlement: '100', remaining: '60' },
        unknown: { entitlement: true, percent_remaining: ' ', overage_permitted: null },
        exhausted: { entitlement: 100, percent_remaining: -5 },
        invalid: null,
      },
    });
    expect(rows[0]).toMatchObject({ used: 40, percent: 60 });
    expect(rows[1]).toMatchObject({
      used: null,
      percent: null,
      overageAllowed: null,
      resetAtMs: null,
    });
    expect(rows[2].percent).toBe(0);
    expect(rows).toHaveLength(3);
  });

  test('uses the existing account filter and clears cached quota between sessions', () => {
    expect(COPILOT_CONFIG.filterFn({ name: 'demo.json', type: 'github-copilot' })).toBe(true);
    expect(
      COPILOT_CONFIG.filterFn({ name: 'demo.json', type: 'github-copilot', disabled: true })
    ).toBe(false);
    expect(COPILOT_CONFIG.filterFn({ name: 'demo.json', type: 'codex' })).toBe(false);
    const generation = captureQuotaCacheGeneration();
    useQuotaStore.getState().setCopilotQuota({ 'demo.json': { status: 'success', rows: [] } });
    useQuotaStore.getState().clearQuotaCache();
    expect(useQuotaStore.getState().copilotQuota).toEqual({});
    expect(
      commitIfQuotaCacheCurrent(generation, () => {
        throw new Error('stale update');
      })
    ).toBe(false);
  });
});
