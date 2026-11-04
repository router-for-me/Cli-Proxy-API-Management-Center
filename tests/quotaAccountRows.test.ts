import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  credentialStatus,
  historyWindowCells,
  isPriorityEligible,
  priorityKeys,
  liveWindowCells,
  remainingTone,
  sectionColumns,
  weeklyResetMs,
  type CredentialStatus,
} from '@/features/quota/accounts/rowModel';
import type { QuotaHistoryAccount } from '@/services/api/quotaHistory';
import type { AuthFileItem } from '@/types/authFile';

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
          droppedAt: null,
        },
        {
          id: 'five_hour',
          periodSeconds: 18000,
          points: [{ t: NOW - 6 * H, used: 80, resetAt: NOW - H }],
          droppedAt: null,
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

  test('leave out recorded windows the credential no longer reports', () => {
    const account: QuotaHistoryAccount = {
      authId: 'claude-a.json',
      authIndex: '',
      fileName: 'claude-a.json',
      provider: 'claude',
      label: '',
      email: '',
      plan: 'max20',
      windows: [
        {
          id: 'five_hour',
          periodSeconds: 18000,
          points: [{ t: NOW - 6 * 24 * H, used: 30, resetAt: NOW - 6 * 24 * H + 2 * H }],
          droppedAt: NOW - 5 * 60 * 1000,
        },
        {
          id: 'seven_day',
          periodSeconds: 604800,
          points: [{ t: NOW - 5 * 60 * 1000, used: 7, resetAt: NOW + 100 * H }],
          droppedAt: null,
        },
      ],
    };
    const { cells, observedAtMs } = historyWindowCells(account, NOW, t);
    expect(cells.map((cell) => cell.id)).toEqual(['seven-day']);
    expect(observedAtMs).toBe(NOW - 5 * 60 * 1000);
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
    expect(isPriorityEligible(NOW + 35.9 * H, NOW, 'serving')).toBe(true);
    expect(isPriorityEligible(NOW + 36.1 * H, NOW, 'serving')).toBe(false);
    expect(isPriorityEligible(NOW - H, NOW, 'serving')).toBe(false);
    expect(isPriorityEligible(null, NOW, 'serving')).toBe(false);
  });

  test('never boost an account the router cannot pick', () => {
    for (const status of ['cooling', 'unavailable', 'disabled', 'error'] as const) {
      expect(isPriorityEligible(NOW + 3 * H, NOW, status)).toBe(false);
    }
  });

  test('read a rate-limited account as cooling until its credential cooldown ends', () => {
    // Production 2026-10-29: weekly limit spent, reset 3 hours away, 429 cooldown until then.
    const file: AuthFileItem = {
      name: 'claude-7681b9e4.json',
      type: 'claude',
      status: 'error',
      unavailable: true,
      next_retry_after: new Date(NOW + 3 * H).toISOString(),
      cooldownSnapshot: {
        receivedAtMs: NOW,
        records: [
          {
            scope: 'credential',
            reason: 'credential_quota',
            retryAt: '',
            remainingSeconds: 3 * 3600,
          },
          { scope: 'model', reason: 'quota', retryAt: '', remainingSeconds: 3 * 3600 },
        ],
      },
    };
    const routing = credentialStatus(file, NOW);
    expect(routing).toEqual({ status: 'cooling', until: NOW + 3 * H });
    expect(isPriorityEligible(NOW + 3 * H, NOW, routing.status)).toBe(false);

    // Once the cooldown has run out, the file's own flags decide.
    expect(credentialStatus(file, NOW + 4 * H).status).toBe('unavailable');
    expect(credentialStatus({ name: 'ok.json', type: 'claude' }, NOW).status).toBe('serving');
    expect(credentialStatus({ name: 'off.json', type: 'claude', disabled: true }, NOW).status).toBe(
      'disabled'
    );
  });

  test('boost only the most urgent eligible account, ties sharing', () => {
    const candidate = (
      key: string,
      resetHours: number | null,
      sessionLimited = false,
      status: CredentialStatus = 'serving'
    ) => ({
      key,
      resetAtMs: resetHours === null ? null : NOW + resetHours * H,
      status,
      sessionLimited,
    });
    const keys = (...candidates: ReturnType<typeof candidate>[]) =>
      [...priorityKeys(candidates, NOW)].sort();

    expect(keys(candidate('35h', 35), candidate('12h', 12), candidate('far', 100))).toEqual([
      '12h',
    ]);
    // The most urgent one is cooling down, so the next one is boosted.
    expect(keys(candidate('35h', 35), candidate('12h', 12, false, 'cooling'))).toEqual(['35h']);
    expect(keys(candidate('a', 20), candidate('b', 20))).toEqual(['a', 'b']);
    expect(keys(candidate('far', 40), candidate('none', null))).toEqual([]);
  });

  test('rank an account with a 5-hour limit an hour earlier', () => {
    const pair = (exemptHours: number, limitedHours: number) =>
      [
        ...priorityKeys(
          [
            {
              key: 'exempt',
              resetAtMs: NOW + exemptHours * H,
              status: 'serving',
              sessionLimited: false,
            },
            {
              key: 'limited',
              resetAtMs: NOW + limitedHours * H,
              status: 'serving',
              sessionLimited: true,
            },
          ],
          NOW
        ),
      ].sort();
    expect(pair(26, 26)).toEqual(['limited']);
    expect(pair(26, 26.9)).toEqual(['limited']);
    expect(pair(26, 27)).toEqual(['exempt', 'limited']);
    expect(pair(26, 27.1)).toEqual(['exempt']);
    expect(pair(35, 12)).toEqual(['limited']);
    // Under an hour from the reset the limited deadline lies in the past: still eligible, still first.
    expect(pair(20 / 60, 30 / 60)).toEqual(['limited']);
    expect(pair(50 / 60, 10 / 60)).toEqual(['limited']);
    expect(pair(2, 0.5)).toEqual(['limited']);
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
