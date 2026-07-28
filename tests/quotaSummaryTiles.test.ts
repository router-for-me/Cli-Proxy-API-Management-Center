import { describe, expect, test } from 'bun:test';
import { summarizeProvider, AT_RISK_THRESHOLD } from '@/components/quota/quotaSummary';

const cred = (name: string) => ({ name, label: `${name}@example.com` });

// claude / codex store USED percent — remaining = 100 - used.
const claudeState = (usedPercents: (number | null)[], resetLabels: string[] = []) => ({
  status: 'success',
  windows: usedPercents.map((usedPercent, i) => ({
    id: `w${i}`,
    label: `w${i}`,
    usedPercent,
    resetLabel: resetLabels[i] ?? '-',
  })),
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
  test('claude: picks the soonest formatted window reset across credentials', () => {
    const summary = summarizeProvider('claude', [cred('a'), cred('b')], {
      a: claudeState([10, 20], ['08/01, 21:00', '07/29, 14:59']),
      b: claudeState([30], ['07/31, 15:00']),
    });
    expect(summary.nextResetLabel).toBe('07/29, 14:59');
  });

  test('claude: ignores placeholder "-" labels and reports null with none left', () => {
    const summary = summarizeProvider('claude', [cred('a')], {
      a: claudeState([10], ['-']),
    });
    expect(summary.nextResetLabel).toBeNull();
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
