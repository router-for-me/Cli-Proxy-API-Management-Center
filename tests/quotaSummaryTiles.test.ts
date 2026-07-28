import { describe, expect, test } from 'bun:test';
import { summarizeProvider, AT_RISK_THRESHOLD } from '@/components/quota/quotaSummary';

const cred = (name: string) => ({ name, label: `${name}@example.com` });

// claude / codex store USED percent — remaining = 100 - used.
/**
 * Reset selection is driven by `resetAtMs`, not by the label text, so a fixture
 * has to supply the instant. Labels are derived from it here so the two can't
 * silently disagree; pass `resetAtMsList` explicitly to test a mismatch.
 */
const labelFromMs = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}, ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const claudeState = (
  usedPercents: (number | null)[],
  resetAtMsList: (number | null)[] = []
) => ({
  status: 'success',
  windows: usedPercents.map((usedPercent, i) => {
    const resetAtMs = resetAtMsList[i] ?? null;
    return {
      id: `w${i}`,
      label: `w${i}`,
      usedPercent,
      resetLabel: resetAtMs === null ? '-' : labelFromMs(resetAtMs),
      resetAtMs,
    };
  }),
});

// antigravity stores REMAINING as a 0..1 fraction.
const antigravityState = (fractions: number[]) => ({
  status: 'success',
  groups: [
    {
      id: 'g',
      label: 'g',
      buckets: fractions.map((remainingFraction, i) => ({
        id: `b${i}`,
        label: `b${i}`,
        remainingFraction,
        resetTime: '2026-08-04T00:00:00Z',
      })),
    },
  ],
});

// kimi stores raw used/limit counts.
const kimiState = (rows: { used: number; limit: number; resetHint?: string }[]) => ({
  status: 'success',
  rows: rows.map((row, i) => ({ id: `r${i}`, ...row })),
});

describe('summarizeProvider polarity', () => {
  test('claude: remaining is 100 minus the worst used percent', () => {
    const summary = summarizeProvider('claude', [cred('a')], { a: claudeState([93, 20]) });
    expect(summary.worstRemaining).toBe(7);
    expect(summary.accounts).toEqual([{ name: 'a', label: 'a@example.com', remaining: 7 }]);
  });

  test('antigravity: remaining fraction scales to percent, not inverted', () => {
    const summary = summarizeProvider('antigravity', [cred('a')], { a: antigravityState([0.25, 1]) });
    expect(summary.worstRemaining).toBe(25);
  });

  test('kimi: remaining derives from used/limit counts', () => {
    const summary = summarizeProvider('kimi', [cred('a')], {
      a: kimiState([{ used: 93, limit: 100 }]),
    });
    expect(summary.worstRemaining).toBe(7);
  });

  test('xai: always unknown — no per-limit data to summarize', () => {
    const summary = summarizeProvider('xai', [cred('a')], {
      a: { status: 'success', billing: { usagePercent: 40 } },
    });
    expect(summary.worstRemaining).toBeNull();
    expect(summary.accounts[0]?.remaining).toBeNull();
    expect(summary.loaded).toBe(0);
  });
});

describe('summarizeProvider accounts', () => {
  test('lists every configured credential and sorts worst first, nulls last', () => {
    const summary = summarizeProvider(
      'claude',
      [cred('healthy'), cred('pending'), cred('worst'), cred('idle')],
      {
        healthy: claudeState([10]), // 90 remaining
        worst: claudeState([98]), // 2 remaining
        idle: { status: 'idle', windows: [] },
        // 'pending' has no slice entry at all
      }
    );
    expect(summary.accounts.map((a) => a.name)).toEqual(['worst', 'healthy', 'pending', 'idle']);
    expect(summary.accounts.map((a) => a.remaining)).toEqual([2, 90, null, null]);
    expect(summary.total).toBe(4);
    expect(summary.loaded).toBe(2);
  });

  test('carries the caller-resolved label through untouched', () => {
    const summary = summarizeProvider('claude', [{ name: 'file.json', label: 'Alice · design' }], {});
    expect(summary.accounts[0]).toEqual({ name: 'file.json', label: 'Alice · design', remaining: null });
  });

  test('counts at-risk credentials against the shared threshold', () => {
    const summary = summarizeProvider('claude', [cred('a'), cred('b')], {
      a: claudeState([100 - (AT_RISK_THRESHOLD - 1)]),
      b: claudeState([100 - AT_RISK_THRESHOLD]),
    });
    expect(summary.atRisk).toBe(1);
  });
});

describe('summarizeProvider nextResetLabel', () => {
  test('claude: picks the soonest window reset across credentials', () => {
    const aug1 = Date.UTC(2026, 7, 1, 21, 0);
    const jul29 = Date.UTC(2026, 6, 29, 14, 59);
    const jul31 = Date.UTC(2026, 6, 31, 15, 0);

    const summary = summarizeProvider('claude', [cred('a'), cred('b')], {
      a: claudeState([10, 20], [aug1, jul29]),
      b: claudeState([30], [jul31]),
    });
    expect(summary.nextResetLabel).toBe(labelFromMs(jul29));
  });

  test('claude: reports null when no window carries a reset instant', () => {
    const summary = summarizeProvider('claude', [cred('a')], {
      a: claudeState([10], [null]),
    });
    expect(summary.nextResetLabel).toBeNull();
  });

  /**
   * Regression: selection used to compare formatted "MM/DD, HH:MM" strings, so
   * "12/31" sorted after "01/02" and a January reset beat a December one.
   */
  test('claude: picks December over January across a year boundary', () => {
    const dec31 = Date.UTC(2026, 11, 31, 20, 0);
    const jan02 = Date.UTC(2027, 0, 2, 9, 0);

    const summary = summarizeProvider('claude', [cred('a'), cred('b')], {
      a: claudeState([10], [jan02]),
      b: claudeState([20], [dec31]),
    });
    expect(summary.nextResetLabel).toBe(labelFromMs(dec31));
  });

  test('kimi: picks the soonest relative reset hint', () => {
    const summary = summarizeProvider('kimi', [cred('a'), cred('b')], {
      a: kimiState([{ used: 1, limit: 10, resetHint: '3h 20m' }]),
      b: kimiState([
        { used: 1, limit: 10, resetHint: '45m' },
        { used: 1, limit: 10, resetHint: '7h' },
      ]),
    });
    expect(summary.nextResetLabel).toBe('45m');
  });

  test('antigravity: null — live-clock labels cannot be precomputed', () => {
    const summary = summarizeProvider('antigravity', [cred('a')], { a: antigravityState([0.5]) });
    expect(summary.nextResetLabel).toBeNull();
  });

  test('unloaded credentials contribute no reset label', () => {
    const summary = summarizeProvider('claude', [cred('a')], {
      a: { status: 'error', windows: [{ id: 'w', label: 'w', usedPercent: 5, resetLabel: '07/29, 14:59' }] },
    });
    expect(summary.nextResetLabel).toBeNull();
  });
});
