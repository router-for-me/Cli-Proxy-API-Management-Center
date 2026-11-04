import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  credentialStatus,
  historyWindowCells,
  isPriorityEligible,
  priorityKeys,
  routingPlacement,
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
  test('rank any account the router can pick that has a known deadline', () => {
    expect(isPriorityEligible(NOW + 100 * H, 'serving')).toBe(true);
    expect(isPriorityEligible(null, 'serving')).toBe(false);
    for (const status of ['cooling', 'unavailable', 'disabled', 'error'] as const) {
      expect(isPriorityEligible(NOW + 3 * H, status)).toBe(false);
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
    expect(isPriorityEligible(NOW + 3 * H, routing.status)).toBe(false);

    // The router picks it again once the retry time has passed, although the flag only
    // clears on its next success (production 2026-11-04: a Pro shown unavailable while serving).
    expect(credentialStatus(file, NOW + 4 * H)).toEqual({ status: 'serving', until: null });
    expect(credentialStatus({ name: 'ok.json', type: 'claude' }, NOW).status).toBe('serving');
    expect(credentialStatus({ name: 'off.json', type: 'claude', disabled: true }, NOW).status).toBe(
      'disabled'
    );
  });

  test('read an unavailable account by what keeps it out', () => {
    const base: AuthFileItem = { name: 'pro.json', type: 'claude', unavailable: true };
    // Only model cooldowns: back when the first one ends.
    const models: AuthFileItem = {
      ...base,
      cooldownSnapshot: {
        receivedAtMs: NOW,
        records: [
          { scope: 'model', reason: 'quota', retryAt: '', remainingSeconds: 2 * 3600 },
          { scope: 'model', reason: 'quota', retryAt: '', remainingSeconds: 3600 },
        ],
      },
    };
    expect(credentialStatus(models, NOW)).toEqual({ status: 'cooling', until: NOW + H });
    // A retry time still ahead: unavailable until then.
    const retrying = { ...base, next_retry_after: new Date(NOW + 30 * 60 * 1000).toISOString() };
    expect(credentialStatus(retrying, NOW)).toEqual({
      status: 'unavailable',
      until: NOW + 30 * 60 * 1000,
    });
    // No recovery time at all: unavailable for good.
    expect(credentialStatus(base, NOW)).toEqual({ status: 'unavailable', until: null });
  });

  test('send new requests to the earliest deadline, ties sharing', () => {
    const candidate = (
      key: string,
      deadlineHours: number | null,
      sessionLimited = false,
      status: CredentialStatus = 'serving'
    ) => ({
      key,
      deadlineMs: deadlineHours === null ? null : NOW + deadlineHours * H,
      status,
      sessionLimited,
    });
    const keys = (...candidates: ReturnType<typeof candidate>[]) =>
      [...priorityKeys(candidates)].sort();

    expect(keys(candidate('35h', 35), candidate('12h', 12), candidate('far', 100))).toEqual([
      '12h',
    ]);
    // The first is cooling down, so the next one is first in line.
    expect(keys(candidate('35h', 35), candidate('12h', 12, false, 'cooling'))).toEqual(['35h']);
    expect(keys(candidate('a', 20), candidate('b', 20))).toEqual(['a', 'b']);
    // A deadline days away still counts; an unknown one never does.
    expect(keys(candidate('far', 140), candidate('none', null))).toEqual(['far']);
  });

  test('send session-limited accounts first within an hour of the earliest deadline', () => {
    const pair = (exemptHours: number, limitedHours: number) =>
      [
        ...priorityKeys([
          {
            key: 'exempt',
            deadlineMs: NOW + exemptHours * H,
            status: 'serving',
            sessionLimited: false,
          },
          {
            key: 'limited',
            deadlineMs: NOW + limitedHours * H,
            status: 'serving',
            sessionLimited: true,
          },
        ]),
      ].sort();
    expect(pair(26, 26)).toEqual(['limited']);
    expect(pair(26, 26.9)).toEqual(['limited']);
    expect(pair(26, 27)).toEqual(['limited']);
    expect(pair(26, 27.1)).toEqual(['exempt']);
    expect(pair(35, 12)).toEqual(['limited']);
    expect(pair(1, 34)).toEqual(['exempt']);
  });

  test('place accounts by the backend report, else by their weekly reset', () => {
    const routing = { deadline: NOW + 5 * H, sessionLimited: true, sessionShare: 28, drain: 3.9 };
    expect(routingPlacement(routing, NOW + 9 * H, false, NOW)).toEqual({
      deadlineMs: NOW + 5 * H,
      sessionLimited: true,
    });
    expect(routingPlacement(null, NOW + 9 * H, true, NOW)).toEqual({
      deadlineMs: NOW + 9 * H,
      sessionLimited: true,
    });
    expect(routingPlacement(undefined, NOW - H, false, NOW)).toEqual({
      deadlineMs: null,
      sessionLimited: false,
    });
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
