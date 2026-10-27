import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  historyWindowCells,
  isPriorityBoosted,
  liveWindowCells,
  remainingTone,
  sectionColumns,
  weeklyResetMs,
} from '@/features/quota/accounts/rowModel';
import type { QuotaHistoryAccount } from '@/services/api/quotaHistory';

const t = ((key: string) => key) as unknown as TFunction;
const H = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 26, 3, 30);

describe('account row cells', () => {
  test('convert used percentages to remaining for Claude and Codex', () => {
    const cells = liveWindowCells(
      'codex',
      {
        status: 'success',
        windows: [
          { id: 'five-hour', label: '5-hour limit', usedPercent: 3, resetAtMs: NOW + H },
          { id: 'weekly', label: 'Weekly limit', usedPercent: null, resetAtMs: null },
        ],
      },
      t
    );
    expect(cells).toEqual([
      { id: 'five-hour', label: '5-hour limit', remaining: 97, resetAtMs: NOW + H },
      { id: 'weekly', label: 'Weekly limit', remaining: null, resetAtMs: null },
    ]);
    expect(liveWindowCells('codex', { status: 'loading' }, t)).toEqual([]);
  });

  test('read remaining fractions and limits for other providers', () => {
    expect(
      liveWindowCells(
        'antigravity',
        {
          status: 'success',
          groups: [
            {
              id: 'g',
              label: 'Gemini',
              buckets: [{ id: 'b', label: 'Pro', remainingFraction: 0.4 }],
            },
          ],
        },
        t
      )[0]
    ).toMatchObject({ id: 'g:b', label: 'Pro', remaining: 40 });
    expect(
      liveWindowCells(
        'kimi',
        { status: 'success', rows: [{ id: 'weekly', label: 'Weekly', used: 30, limit: 120 }] },
        t
      )[0].remaining
    ).toBe(75);
    expect(
      liveWindowCells(
        'meta',
        { status: 'success', data: { windows: [{ id: 'weekly', usedPercent: 10, resetAt: 100 }] } },
        t
      )[0]
    ).toMatchObject({ remaining: 90, resetAtMs: 100_000 });
  });

  test('fall back to the latest recorded sample and roll passed resets forward', () => {
    const account: QuotaHistoryAccount = {
      authId: 'codex-a.json',
      authIndex: '',
      fileName: 'codex-a.json',
      provider: 'codex',
      label: '',
      email: '',
      plan: 'pro',
      windows: [
        {
          id: 'seven_day',
          periodSeconds: 604800,
          points: [{ t: NOW - 10 * 60 * 1000, used: 16, resetAt: NOW + 30 * H }],
        },
        {
          id: 'five_hour',
          periodSeconds: 18000,
          points: [{ t: NOW - 6 * H, used: 80, resetAt: NOW - H }],
        },
      ],
    };
    const { cells, observedAtMs } = historyWindowCells(account, NOW, t);
    expect(observedAtMs).toBe(NOW - 10 * 60 * 1000);
    expect(cells).toEqual([
      {
        id: 'five-hour',
        label: 'codex_quota.primary_window',
        remaining: 100,
        resetAtMs: NOW + 4 * H,
      },
      {
        id: 'weekly',
        label: 'codex_quota.secondary_window',
        remaining: 84,
        resetAtMs: NOW + 30 * H,
      },
    ]);
    expect(weeklyResetMs('codex', cells)).toBe(NOW + 30 * H);
  });

  test('share columns across a section in first-seen order', () => {
    const columns = sectionColumns([
      [{ id: 'weekly', label: 'Weekly', remaining: 1, resetAtMs: null }],
      [
        { id: 'five-hour', label: '5-hour', remaining: 1, resetAtMs: null },
        { id: 'weekly', label: 'Weekly', remaining: 1, resetAtMs: null },
      ],
    ]);
    expect(columns.map((column) => column.id)).toEqual(['weekly', 'five-hour']);
  });
});

describe('routing hints', () => {
  test('flag weekly resets less than 36 hours away', () => {
    expect(isPriorityBoosted(NOW + 35.9 * H, NOW)).toBe(true);
    expect(isPriorityBoosted(NOW + 36.1 * H, NOW)).toBe(false);
    expect(isPriorityBoosted(NOW - H, NOW)).toBe(false);
    expect(isPriorityBoosted(null, NOW)).toBe(false);
  });

  test('tone remaining percentages', () => {
    expect(remainingTone(75)).toBe('normal');
    expect(remainingTone(36)).toBe('low');
    expect(remainingTone(5)).toBe('critical');
    expect(remainingTone(null)).toBe('normal');
  });
});

describe('routing strategy parsing', () => {
  test('keeps the weekly-reset strategy instead of falling back to round-robin', async () => {
    const { parseRoutingStrategy } = await import('@/hooks/useVisualConfig');
    expect(parseRoutingStrategy('weekly-reset-weighted-round-robin')).toBe(
      'weekly-reset-weighted-round-robin'
    );
    expect(parseRoutingStrategy('weekly-reset-wrr')).toBe('weekly-reset-weighted-round-robin');
    expect(parseRoutingStrategy('wrr')).toBe('weighted-round-robin');
  });
});
