import { describe, expect, test } from 'bun:test';
import { buildAntigravityQuotaGroups } from '@/utils/quota/builders';
import type { AntigravityQuotaSummaryPayload } from '@/types';

const WEEKLY_RESET = '2026-10-06T02:26:28Z';

const payload = (
  buckets: AntigravityQuotaSummaryPayload['groups'][number]['buckets']
): AntigravityQuotaSummaryPayload => ({
  groups: [{ displayName: 'Gemini Models', buckets }],
});

describe('Antigravity weekly-exhaustion inference', () => {
  test('marks the 5-hour bucket disabled when the weekly bucket is spent', () => {
    const [group] = buildAntigravityQuotaGroups(
      payload([
        { window: 'weekly', remainingFraction: 0, resetTime: WEEKLY_RESET },
        { window: '5h', remainingFraction: 1, resetTime: '2026-10-03T19:16:48Z' },
      ])
    );

    const fiveHour = group.buckets.find((bucket) => bucket.window === '5h');
    expect(fiveHour?.disabled).toBe(true);
    expect(fiveHour?.disabledResetTime).toBe(WEEKLY_RESET);
    // 原始比例保留：被压制不等于被用完。
    expect(fiveHour?.remainingFraction).toBe(1);
  });

  test('leaves the 5-hour bucket alone while the weekly bucket has quota', () => {
    const [group] = buildAntigravityQuotaGroups(
      payload([
        { window: 'weekly', remainingFraction: 0.4, resetTime: WEEKLY_RESET },
        { window: '5h', remainingFraction: 1 },
      ])
    );

    expect(group.buckets.find((bucket) => bucket.window === '5h')?.disabled).toBeUndefined();
  });

  test('accepts the alternative weekly spelling', () => {
    const [group] = buildAntigravityQuotaGroups(
      payload([
        { window: 'week', remainingFraction: 0 },
        { window: 'five_hour', remainingFraction: 1 },
      ])
    );

    expect(group.buckets.find((bucket) => bucket.window === 'five_hour')?.disabled).toBe(true);
  });

  test('does not disable buckets of a group whose weekly window is still fresh', () => {
    const groups = buildAntigravityQuotaGroups({
      groups: [
        {
          displayName: 'Gemini Models',
          buckets: [{ window: '5h', remainingFraction: 1 }],
        },
        {
          displayName: 'Claude and GPT Models',
          buckets: [
            { window: 'weekly', remainingFraction: 0, resetTime: WEEKLY_RESET },
            { window: '5h', remainingFraction: 1 },
          ],
        },
      ],
    });

    expect(groups[0].buckets[0].disabled).toBeUndefined();
    expect(groups[1].buckets.find((bucket) => bucket.window === '5h')?.disabled).toBe(true);
  });

  test('leaves unknown windows untouched', () => {
    const [group] = buildAntigravityQuotaGroups(
      payload([
        { window: 'weekly', remainingFraction: 0, resetTime: WEEKLY_RESET },
        { window: '5h', remainingFraction: 1, resetTime: '2026-10-03T19:16:48Z' },
        { window: 'daily', remainingFraction: 1, resetTime: '2026-10-04T02:26:28Z' },
        { window: 'monthly', remainingFraction: 1 },
      ])
    );

    for (const window of ['daily', 'monthly']) {
      expect(group.buckets.find((bucket) => bucket.window === window)?.disabled).toBeUndefined();
    }
    // 仍然只有 5h 被压制。
    expect(group.buckets.find((bucket) => bucket.window === '5h')?.disabled).toBe(true);
  });

  test('never marks the weekly bucket itself disabled', () => {
    const [group] = buildAntigravityQuotaGroups(
      payload([
        { window: 'weekly', remainingFraction: 0, resetTime: WEEKLY_RESET },
        { window: '5h', remainingFraction: 0.3 },
      ])
    );

    const weekly = group.buckets.find((bucket) => bucket.window === 'weekly');
    expect(weekly?.disabled).toBeUndefined();
    expect(weekly?.remainingFraction).toBe(0);
  });
});
