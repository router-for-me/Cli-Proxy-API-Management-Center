import { describe, expect, test } from 'bun:test';
import { buildUsageRange, metricValue, summarizeBuckets } from '@/features/usage/logic';
import type { UsageBucket } from '@/features/usage/types';

const bucket = (overrides: Partial<UsageBucket> = {}): UsageBucket => ({
  timestamp: '2026-09-18T10:00:00Z',
  records: 2,
  failures: 1,
  uncached_input_tokens: 100,
  cache_read_tokens: 20,
  cache_write_tokens: 10,
  non_reasoning_output_tokens: 50,
  reasoning_tokens: 20,
  total_tokens: 200,
  ...overrides,
});

describe('usage page logic', () => {
  test('builds hourly and daily ranges from a stable clock', () => {
    const now = new Date('2026-09-18T12:00:00Z');
    const hourly = buildUsageRange('24h', now);
    const daily = buildUsageRange('7d', now);

    expect(hourly.step).toBe('hour');
    expect(hourly.from).toBe('2026-09-17T12:00:00.000Z');
    expect(hourly.to).toBe('2026-09-18T12:00:00.000Z');
    expect(daily.step).toBe('day');
    expect(daily.from).toBe('2026-09-11T12:00:00.000Z');
  });

  test('summarizes canonical token buckets without USD pricing', () => {
    const summary = summarizeBuckets([bucket(), bucket({ records: 3, failures: 0, total_tokens: 300 })]);
    expect(summary.totalTokens).toBe(500);
    expect(summary.inputTokens).toBe(260);
    expect(summary.outputTokens).toBe(140);
    expect(summary.requests).toBe(5);
    expect(summary.failures).toBe(1);
    expect(summary.errorRate).toBe(20);
  });

  test('supports request and token chart metrics', () => {
    const value = bucket({ records: 7, total_tokens: 900 });
    expect(metricValue(value, 'requests')).toBe(7);
    expect(metricValue(value, 'tokens')).toBe(900);
  });
});
