/**
 * Cursor quota parsing, over payloads captured verbatim from
 * aiserver.v1.DashboardService on a live Ultra account.
 */

import { describe, expect, test } from 'bun:test';
import {
  buildCursorModelRows,
  buildCursorQuotaSummary,
  formatCursorCents,
  parseCursorNumber,
  parseCursorPayload,
} from '../src/utils/quota/cursor';
import {
  collectQuotaRowInstants,
  CURSOR_AGENT_ROW_ID,
  CURSOR_INCLUDED_ROW_ID,
} from '../src/features/quota/resetSchedule';
import type {
  CursorAggregatedUsage,
  CursorCurrentPeriodUsage,
  CursorPlanInfo,
} from '../src/types';

const PLAN: CursorPlanInfo = {
  planInfo: {
    planName: 'Ultra',
    includedAmountCents: 40000,
    price: '$200/mo',
    billingCycleEnd: '1789830899000',
    planOwner: 'PLAN_OWNER_STRIPE',
  },
};

const PERIOD: CursorCurrentPeriodUsage = {
  billingCycleStart: '1787152499000',
  billingCycleEnd: '1789830899000',
  planUsage: {
    totalSpend: 132,
    includedSpend: 132,
    remaining: 39868,
    limit: 40000,
    autoPercentUsed: 0.0045,
    apiPercentUsed: 0.246,
    totalPercentUsed: 0.0528,
  },
  spendLimitUsage: { limitType: 'user' },
};

const USAGE: CursorAggregatedUsage = {
  aggregations: [
    { modelIntent: 'sand-default', inputTokens: '876179', outputTokens: '51579', cacheReadTokens: '6347584', totalCents: 520.22995, tier: 1 },
    { modelIntent: 'claude-opus-5-low', inputTokens: '174', outputTokens: '11332', cacheWriteTokens: '134056', cacheReadTokens: '2176150', totalCents: 221.0095, tier: 1 },
    { modelIntent: 'sand-automation', inputTokens: '1020502', outputTokens: '18197', cacheReadTokens: '13607936', totalCents: 447.7077, tier: 1 },
    { modelIntent: 'never-billed', inputTokens: '10', outputTokens: '0', totalCents: 0, tier: 1 },
  ],
  totalCostCents: 1321.5496549999998,
};

describe('parseCursorNumber', () => {
  test('reads the decimal strings Cursor sends for 64-bit fields', () => {
    expect(parseCursorNumber('1789830899000')).toBe(1789830899000);
    expect(parseCursorNumber(40000)).toBe(40000);
  });

  test('an absent or unparseable field stays absent rather than becoming zero', () => {
    expect(parseCursorNumber(undefined)).toBeNull();
    expect(parseCursorNumber('')).toBeNull();
    expect(parseCursorNumber('   ')).toBeNull();
    expect(parseCursorNumber('not-a-number')).toBeNull();
    expect(parseCursorNumber(Number.NaN)).toBeNull();
  });
});

describe('parseCursorPayload', () => {
  test('accepts the body as a string or as an already-decoded object', () => {
    expect(parseCursorPayload<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
    expect(parseCursorPayload<{ a: number }>({ a: 1 })).toEqual({ a: 1 });
  });

  test('malformed JSON yields null instead of throwing into the card', () => {
    expect(parseCursorPayload('{')).toBeNull();
    expect(parseCursorPayload('"a string"')).toBeNull();
  });
});

describe('buildCursorModelRows', () => {
  test('orders by spend and drops models that were never billed', () => {
    const rows = buildCursorModelRows(USAGE);
    expect(rows.map((row) => row.model)).toEqual([
      'sand-default',
      'sand-automation',
      'claude-opus-5-low',
    ]);
    expect(rows[0].cacheReadTokens).toBe(6347584);
  });

  test('no usage read at all is an empty list, not a crash', () => {
    expect(buildCursorModelRows(null)).toEqual([]);
    expect(buildCursorModelRows({})).toEqual([]);
  });
});

describe('buildCursorQuotaSummary', () => {
  test('reads the allowance, the draw-down and the cycle from a live payload', () => {
    const summary = buildCursorQuotaSummary(PLAN, PERIOD, USAGE);
    expect(summary.planName).toBe('Ultra');
    expect(summary.planPrice).toBe('$200/mo');
    expect(summary.limitCents).toBe(40000);
    expect(summary.usedCents).toBe(132);
    expect(summary.remainingCents).toBe(39868);
    expect(summary.cycleEndMs).toBe(1789830899000);
    // 1787152499000 -> 1789830899000 is 31 days.
    expect(summary.periodHours).toBe(744);
    expect(summary.models).toHaveLength(3);
  });

  test('the meter reads remaining capacity, not money spent', () => {
    const summary = buildCursorQuotaSummary(PLAN, PERIOD, USAGE);
    expect(summary.remainingPercent).toBeCloseTo(99.67, 2);
  });

  test('falls back to the plan read when the period omits the allowance', () => {
    const summary = buildCursorQuotaSummary(PLAN, { billingCycleStart: '1787152499000' }, null);
    expect(summary.limitCents).toBe(40000);
    expect(summary.cycleEndMs).toBe(1789830899000);
    // The cycle end came from the plan read, so the pair is still complete.
    expect(summary.periodHours).toBe(744);
  });

  test('a cycle with no end anywhere states no length rather than inventing one', () => {
    const summary = buildCursorQuotaSummary(null, { billingCycleStart: '1787152499000' }, null);
    expect(summary.cycleEndMs).toBeNull();
    expect(summary.periodHours).toBeNull();
  });

  test('an account with no plan read still reports what the period knows', () => {
    const summary = buildCursorQuotaSummary(null, PERIOD, null);
    expect(summary.planName).toBeNull();
    expect(summary.limitCents).toBe(40000);
    expect(summary.models).toEqual([]);
  });

  test('a zero allowance yields no percentage rather than a division by zero', () => {
    const summary = buildCursorQuotaSummary(null, { planUsage: { limit: 0, totalSpend: 0 } }, null);
    expect(summary.remainingPercent).toBeNull();
  });
});

describe('formatCursorCents', () => {
  test('cents render as dollars, and an absent amount says so', () => {
    expect(formatCursorCents(40000)).toBe('$400.00');
    expect(formatCursorCents(132)).toBe('$1.32');
    expect(formatCursorCents(null)).toBe('--');
  });
});

describe('collectQuotaRowInstants for cursor', () => {
  test('the billing cycle end is the instant the allowance returns', () => {
    const quota = {
      status: 'success',
      summary: buildCursorQuotaSummary(PLAN, PERIOD, USAGE),
    };
    expect(collectQuotaRowInstants('cursor', quota)).toEqual([
      { rowId: CURSOR_INCLUDED_ROW_ID, atMs: 1789830899000, kind: 'window' },
    ]);
  });

  test('a card that has not loaded contributes no instant', () => {
    expect(collectQuotaRowInstants('cursor', { status: 'idle', summary: null })).toEqual([]);
    expect(collectQuotaRowInstants('cursor', { status: 'success', summary: null })).toEqual([]);
  });
});

const AGENT = {
  currentPeriodStart: '2026-08-19T15:16:39.259Z',
  nextResetTimestampUtc: '2026-08-26T15:16:39.259Z',
  usagePercent: 1.188947,
  hasAvailableUsage: true,
  hasNonZeroIncludedLimit: true,
};

describe('the agent window, which is a second quota', () => {
  test('is read as its own weekly window, not as a view of the allowance', () => {
    const summary = buildCursorQuotaSummary(PLAN, PERIOD, USAGE, AGENT, { requestQuota: 500 });
    expect(summary.agent).not.toBeNull();
    expect(summary.agent?.usedPercent).toBeCloseTo(1.1889, 3);
    expect(summary.agent?.remainingPercent).toBeCloseTo(98.811, 3);
    expect(summary.agent?.resetAtMs).toBe(Date.parse('2026-08-26T15:16:39.259Z'));
    expect(summary.agent?.periodHours).toBe(168);
    expect(summary.fastRequestQuota).toBe(500);
  });

  test('a plan that includes none of it contributes no row', () => {
    const summary = buildCursorQuotaSummary(PLAN, PERIOD, USAGE, {
      ...AGENT,
      hasNonZeroIncludedLimit: false,
    });
    expect(summary.agent).toBeNull();
  });

  test('exhaustion is carried, because zero remaining and no data look alike', () => {
    const summary = buildCursorQuotaSummary(PLAN, PERIOD, USAGE, {
      ...AGENT,
      usagePercent: 100,
      hasAvailableUsage: false,
    });
    expect(summary.agent?.exhausted).toBe(true);
    expect(summary.agent?.remainingPercent).toBe(0);
  });

  test('both windows are offered to the recovery sort, weekly one included', () => {
    const quota = {
      status: 'success',
      summary: buildCursorQuotaSummary(PLAN, PERIOD, USAGE, AGENT, null),
    };
    const instants = collectQuotaRowInstants('cursor', quota);
    expect(instants.map((instant) => instant.rowId).sort()).toEqual([
      CURSOR_AGENT_ROW_ID,
      CURSOR_INCLUDED_ROW_ID,
    ]);
    // The weekly window recovers first, which is the whole reason it is here.
    const agent = instants.find((instant) => instant.rowId === CURSOR_AGENT_ROW_ID);
    const included = instants.find((instant) => instant.rowId === CURSOR_INCLUDED_ROW_ID);
    expect(agent!.atMs).toBeLessThan(included!.atMs);
  });

  test('an account with no agent read still reports the allowance', () => {
    const summary = buildCursorQuotaSummary(PLAN, PERIOD, USAGE, null, null);
    expect(summary.agent).toBeNull();
    expect(summary.fastRequestQuota).toBeNull();
    expect(summary.limitCents).toBe(40000);
  });
});
