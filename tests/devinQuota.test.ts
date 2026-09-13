import { describe, expect, test } from 'bun:test';
import { hasDevinQuotaObservation, readDevinQuotaSnapshot } from '@/services/api/devinQuota';
import type { AuthFileItem } from '@/types';

const fileWith = (quota: unknown, extra: Record<string, unknown> = {}): AuthFileItem => ({
  name: 'devin.json',
  type: 'devin',
  quota,
  ...extra,
});

describe('Devin quota normalization', () => {
  test('accepts numeric and string percentages, including both boundaries', () => {
    const cases: Array<[unknown, unknown, number | null, number | null]> = [
      [0, 100, 0, 100],
      ['0%', ' 100 % ', 0, 100],
      ['42.5', '7.25%', 42.5, 7.25],
      [-1, 101, null, null],
      ['-1%', '100.01', null, null],
      ['', 'NaN', null, null],
      [undefined, {}, null, null],
    ];

    for (const [daily, weekly, expectedDaily, expectedWeekly] of cases) {
      const result = readDevinQuotaSnapshot(
        fileWith({
          signals: {
            daily_quota_remaining_percent: daily,
            weekly_quota_remaining_percent: weekly,
          },
        })
      );
      expect(result.windows.map((window) => window.remainingPercent)).toEqual([
        expectedDaily,
        expectedWeekly,
      ]);
    }
  });

  test('normalizes daily and weekly reset observations independently', () => {
    const dailyReset = '2026-05-01T10:00:00Z';
    const weeklyReset = '2026-05-07T11:30:00Z';
    const result = readDevinQuotaSnapshot(
      fileWith({
        observed_at: '2026-04-30T12:00:00Z',
        signals: {
          daily_quota_remaining_percent: '20',
          daily_quota_reset_at: dailyReset,
          weekly_quota_remaining_percent: '80',
          weekly_quota_reset_at: weeklyReset,
        },
      })
    );

    expect(result.windows).toEqual([
      {
        id: 'daily',
        remainingPercent: 20,
        resetAtMs: Date.parse(dailyReset),
        periodHours: 24,
      },
      {
        id: 'weekly',
        remainingPercent: 80,
        resetAtMs: Date.parse(weeklyReset),
        periodHours: 168,
      },
    ]);
  });

  test('turns missing, malformed, and zero-time observations into null', () => {
    const result = readDevinQuotaSnapshot(
      fileWith({
        observed_at: '0001-01-01T00:00:00Z',
        signals: {
          daily_quota_reset_at: 'not-a-date',
          weekly_quota_reset_at: 1770000000000,
          plan: '   ',
          plan_start: '',
          plan_end: false,
        },
      })
    );

    expect(result).toEqual({
      windows: [
        { id: 'daily', remainingPercent: null, resetAtMs: null, periodHours: 24 },
        { id: 'weekly', remainingPercent: null, resetAtMs: null, periodHours: 168 },
      ],
      observedAtMs: null,
      plan: null,
      planStartMs: null,
      planEndMs: null,
    });
    expect(hasDevinQuotaObservation(result)).toBeFalse();
  });

  test('reads only quota.signals and quota.observed_at, never lookalike credential fields', () => {
    const secret = 'secret-access-token';
    const result = readDevinQuotaSnapshot(
      fileWith(
        {
          observed_at: '2026-05-01T00:00:00Z',
          signals: {},
          cooldown: {
            daily_quota_remaining_percent: 97,
            daily_quota_reset_at: '2026-06-01T00:00:00Z',
          },
          metadata: { weekly_quota_remaining_percent: 96, token: secret },
          account: { daily_quota_remaining_percent: 95, api_key: secret },
        },
        {
          observed_at: '2027-01-01T00:00:00Z',
          cooldown: { weekly_quota_remaining_percent: 94 },
          metadata: { daily_quota_remaining_percent: 93, access_token: secret },
          account: secret,
          access_token: secret,
        }
      )
    );

    expect(result.windows.every((window) => window.remainingPercent === null)).toBeTrue();
    expect(result.observedAtMs).toBe(Date.parse('2026-05-01T00:00:00Z'));
    expect(hasDevinQuotaObservation(result)).toBeFalse();
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
