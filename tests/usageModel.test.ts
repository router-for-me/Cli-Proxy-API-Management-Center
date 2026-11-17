import { describe, expect, test } from 'bun:test';
import { normalizeApiKeyPolicyUsage } from '@/services/api/apiKeyPolicyUsage';
import {
  OTHER_SERIES,
  buildTrend,
  modelColorSlots,
  serverCalendar,
  sumTotals,
  toShareRows,
  trendPoints,
} from '@/features/usage/usageModel';

const model = (name: string, tokens: number, extra: Record<string, number> = {}) => ({
  model: name,
  requests: 1,
  tokens,
  ...extra,
});

const payload = {
  keys: [
    {
      key: 'sk-a',
      name: 'Team A',
      disabled: true,
      usage: {
        day: {
          requests: 3,
          failed: 1,
          rejected: 2,
          rejected_reasons: { api_key_disabled: 2, bogus: 0 },
          last_rejected_at: '2026-11-17T08:39:49+03:00',
          tokens: 30,
          reset_at: '2026-11-18T00:00:00+03:00',
          models: [
            model('m1', 20, {
              input_tokens: 15,
              cached_tokens: 5,
              cache_write_tokens: 2,
              output_tokens: 5,
            }),
          ],
        },
        week: { reset_at: '2026-11-23T00:00:00+03:00' },
        month: { reset_at: '2026-12-01T00:00:00+03:00' },
        total: { models: [model('m1', 500), model('m2', 50)] },
      },
      hourly: [
        { time: '2026-11-17T09', models: [model('m1', 20)] },
        { time: '2026-11-16T23', models: [model('m1', 99)] },
      ],
      daily: [
        { time: '2026-11-17', models: [model('m1', 20), model('m9', 7)] },
        { time: '2026-11-10', models: [model('m2', 4)] },
      ],
    },
  ],
};

describe('usage model', () => {
  const entries = normalizeApiKeyPolicyUsage(payload);

  test('parses disabled state and rejections', () => {
    expect(entries[0].disabled).toBe(true);
    expect(entries[0].usage.day.rejected).toBe(2);
    expect(entries[0].usage.day.rejectedReasons).toEqual({ api_key_disabled: 2 });
    expect(entries[0].usage.day.lastRejectedAt).toBe('2026-11-17T08:39:49+03:00');
    expect(entries[0].usage.week.rejected).toBe(0);
    expect(sumTotals(entries, 'day').rejected).toBe(2);
  });

  test('parses history buckets', () => {
    expect(entries[0].hourly).toHaveLength(2);
    expect(entries[0].daily[0].models[0].tokens).toBe(20);
  });

  test('derives the server calendar from reset times', () => {
    // 07:30 UTC is 10:30 at +03:00.
    const cal = serverCalendar(entries, Date.UTC(2026, 10, 17, 7, 30));
    expect(cal).toEqual({
      today: '2026-11-17',
      weekStart: '2026-11-16',
      monthStart: '2026-11-01',
      monthEnd: '2026-12-01',
      nowHour: '2026-11-17T10',
    });
  });

  test('colors follow all-time rank and fold the rest into other', () => {
    const slots = modelColorSlots(entries);
    expect(slots.get('m1')).toBe(0);
    expect(slots.get('m2')).toBe(1);
  });

  test('builds hourly and daily trends', () => {
    const cal = serverCalendar(entries, Date.UTC(2026, 10, 17, 7, 30))!;
    const slots = modelColorSlots(entries);
    const today = buildTrend(entries, 'day', cal, slots, 'tokens', 'en');
    expect(today).toHaveLength(24);
    expect(today[9].total).toBe(20);
    expect(today[10].future).toBe(false);
    expect(today[11].future).toBe(true);
    expect(trendPoints(today)).toHaveLength(11);

    const month = buildTrend(entries, 'month', cal, slots, 'tokens', 'en');
    expect(month).toHaveLength(30);
    expect(month[9].values.get('m2')).toBe(4);
    expect(month[16].total).toBe(27);

    const week = buildTrend(entries, 'week', cal, slots, 'requests', 'en');
    expect(week).toHaveLength(7);
    expect(week[1].total).toBe(2);
  });

  test('folds models outside the color slots into other', () => {
    const cal = serverCalendar(entries, Date.UTC(2026, 10, 17, 7, 30))!;
    const slots = new Map([['m1', 0]]);
    const month = buildTrend(entries, 'month', cal, slots, 'tokens', 'en');
    expect(month[16].values.get(OTHER_SERIES)).toBe(7);
  });

  test('sums totals and share rows', () => {
    const totals = sumTotals(entries, 'day');
    expect(totals).toMatchObject({
      requests: 3,
      failed: 1,
      tokens: 30,
      inputTokens: 15,
      cachedTokens: 5,
      cacheWriteTokens: 2,
      rejected: 2,
    });
    const rows = toShareRows([
      { id: 'a', label: 'a', value: 1 },
      { id: 'b', label: 'b', value: 3 },
      { id: 'c', label: 'c', value: 0 },
    ]);
    expect(rows.map((r) => [r.id, r.share])).toEqual([
      ['b', 0.75],
      ['a', 0.25],
    ]);
  });
});
