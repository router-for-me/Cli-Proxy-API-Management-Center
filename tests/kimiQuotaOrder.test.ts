import { describe, expect, test } from 'bun:test';
import { buildKimiQuotaRows } from '@/utils/quota';

describe('Kimi quota ordering', () => {
  test('shows the 5-hour limit before the weekly limit', () => {
    const rows = buildKimiQuotaRows({
      usage: {
        used: 200,
        limit: 1000,
      },
      limits: [
        {
          detail: {
            used: 20,
            limit: 100,
          },
          window: {
            duration: 300,
            timeUnit: 'MINUTES',
          },
        },
      ],
    });

    expect(rows.map(({ id }) => id)).toEqual(['limit-0', 'summary']);
    expect(rows[0]?.labelKey).toBe('kimi_quota.limit_window');
    expect(rows[0]?.labelParams).toEqual({ duration: '5h' });
    expect(rows[1]?.labelKey).toBe('kimi_quota.weekly_limit');
  });
});

describe('Kimi quota reset formatting', () => {
  const getResetHint = (resetIn: number): string | undefined => {
    const rows = buildKimiQuotaRows({
      usage: {
        used: 200,
        limit: 1000,
        resetIn,
      },
    });

    return rows[0]?.resetHint;
  };

  test('converts reset durations longer than a day to days and hours', () => {
    expect(getResetHint(132 * 3600)).toBe('5d 12h');
    expect(getResetHint(168 * 3600)).toBe('7d 0h');
  });

  test('keeps hour and minute formatting for durations shorter than a day', () => {
    expect(getResetHint(5 * 3600 + 30 * 60)).toBe('5h 30m');
  });

  test('shows less than one minute for short positive durations', () => {
    expect(getResetHint(59)).toBe('<1m');
  });
});
