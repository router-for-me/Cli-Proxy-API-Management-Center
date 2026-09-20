import { describe, expect, test } from 'bun:test';
import {
  aggregateBreakdownRows,
  buildSmoothPath,
  buildUsageRange,
  cleanAccountName,
  computeNiceScale,
  escapeCsvCell,
  formatCompactNumber,
  formatDuration,
  formatLatency,
  formatTokenCount,
  generateUsageCsv,
  metricValue,
  summarizeBuckets,
} from '@/features/usage/logic';
import type { BreakdownRow, UsageBucket, UsageRecord } from '@/features/usage/types';

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
  latency_ms_sum: 300,
  latency_samples: 2,
  ttft_ms_sum: 100,
  ttft_samples: 2,
  ...overrides,
});

describe('usage page logic', () => {
  test('builds hourly and daily ranges from a stable clock with range_mode exact', () => {
    const now = new Date('2026-09-18T12:00:00Z');
    const hourly = buildUsageRange('24h', now);
    const daily = buildUsageRange('7d', now);

    expect(hourly.step).toBe('hour');
    expect(hourly.from).toBe('2026-09-17T12:00:00.000Z');
    expect(hourly.to).toBe('2026-09-18T12:00:00.000Z');
    expect(hourly.range_mode).toBe('exact');
    expect(daily.step).toBe('day');
    expect(daily.from).toBe('2026-09-11T12:00:00.000Z');
    expect(daily.range_mode).toBe('exact');
  });

  test('summarizes canonical token buckets with 11 KPIs and corrected input 200', () => {
    const summary = summarizeBuckets([
      bucket(),
      bucket({
        records: 3,
        failures: 0,
        total_tokens: 300,
        latency_ms_sum: 2700,
        latency_samples: 3,
        ttft_ms_sum: 900,
        ttft_samples: 3,
      }),
    ]);
    expect(summary.totalTokens).toBe(500);
    // Corrected input tokens: 100 + 100 = 200 (uncached), NOT 260
    expect(summary.inputTokens).toBe(200);
    expect(summary.uncachedInputTokens).toBe(200);
    expect(summary.outputTokens).toBe(140);
    expect(summary.cacheReadTokens).toBe(40);
    expect(summary.cacheWriteTokens).toBe(20);
    expect(summary.reasoningTokens).toBe(40);
    expect(summary.requests).toBe(5);
    expect(summary.failures).toBe(1);
    expect(summary.errorRate).toBe(20);

    // Weighted sample averages:
    // Latency: (300 + 2700) / (2 + 3) = 3000 / 5 = 600 ms
    expect(summary.avgLatencyMs).toBe(600);
    // TTFT: (100 + 900) / (2 + 3) = 1000 / 5 = 200 ms
    expect(summary.avgTtftMs).toBe(200);
    // Cache hit rate: sum(cache_read) / sum(uncached_input + cache_read)
    // 40 / (200 + 40) = 40 / 240 = 16.666...%
    expect(summary.cacheHitRate).toBeCloseTo(16.6667, 3);
  });

  test('returns null for averages and hit rate when samples or denominators are missing', () => {
    const emptySummary = summarizeBuckets([
      bucket({
        records: 0,
        failures: 0,
        uncached_input_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        non_reasoning_output_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 0,
        latency_ms_sum: 0,
        latency_samples: 0,
        ttft_ms_sum: 0,
        ttft_samples: 0,
      }),
    ]);
    expect(emptySummary.avgLatencyMs).toBeNull();
    expect(emptySummary.avgTtftMs).toBeNull();
    expect(emptySummary.cacheHitRate).toBeNull();
    expect(emptySummary.errorRate).toBe(0);
  });

  test('supports request and token chart metrics', () => {
    const value = bucket({ records: 7, total_tokens: 900 });
    expect(metricValue(value, 'requests')).toBe(7);
    expect(metricValue(value, 'tokens')).toBe(900);
  });

  test('formats duration into ms or seconds according to plan', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(-10)).toBe('—');
    expect(formatDuration(150)).toBe('150 ms');
    expect(formatDuration(999)).toBe('999 ms');
    expect(formatDuration(1000)).toBe('1.00s');
    expect(formatDuration(1700)).toBe('1.70s');
    expect(formatDuration(2543)).toBe('2.54s');
  });

  test('formats record latency with formatLatency', () => {
    const rec1: UsageRecord = {
      timestamp: '2026-09-18T12:00:00Z',
      provider: 'anthropic',
      executor_type: 'direct',
      model: 'claude-3-5-sonnet',
      alias: 'sonnet',
      account: 'acc1',
      auth_type: 'api-key',
      failed: false,
      status_code: 200,
      latency_ms: 1700,
      token_breakdown: {},
    };
    expect(formatLatency(rec1)).toBe('1.70s');

    const rec2: UsageRecord = {
      ...rec1,
      latency_ms: 250,
    };
    expect(formatLatency(rec2)).toBe('250 ms');

    const rec3: UsageRecord = {
      ...rec1,
      latency_ms: 0,
    };
    expect(formatLatency(rec3)).toBe('—');
  });

  test('escapes CSV cells preventing formula injection and following RFC 4180', () => {
    expect(escapeCsvCell('simple')).toBe('simple');
    expect(escapeCsvCell(1234)).toBe('1234');
    expect(escapeCsvCell(0)).toBe('0');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');

    // Comma escaping
    expect(escapeCsvCell('hello,world')).toBe('"hello,world"');
    // Quotes escaping
    expect(escapeCsvCell('say "hello"')).toBe('"say ""hello"""');
    // Newline escaping
    expect(escapeCsvCell("line1\nline2")).toBe("\"line1\nline2\"");

    // Formula injection escaping (=, +, -, @)
    expect(escapeCsvCell('=SUM(A1:B1)')).toBe("\"'=SUM(A1:B1)\"");
    expect(escapeCsvCell('+12345')).toBe("\"'+12345\"");
    expect(escapeCsvCell('-2+3*[calc]')).toBe("\"'-2+3*[calc]\"");
    expect(escapeCsvCell('@cmd')).toBe("\"'@cmd\"");
    expect(escapeCsvCell('  =cmd')).toBe("\"'  =cmd\"");
    expect(escapeCsvCell('\t@calc')).toBe("\"'\t@calc\"");
  });

  test('generates usage CSV with UTF-8 BOM, CRLF, and full columns', () => {
    const records: UsageRecord[] = [
      {
        timestamp: '2026-09-18T10:00:00Z',
        provider: 'openai',
        executor_type: 'direct',
        model: 'gpt-4o',
        alias: '4o',
        account: 'user1',
        endpoint: '/v1/chat/completions',
        reasoning_effort: 'medium',
        auth_type: 'bearer',
        failed: false,
        status_code: 200,
        latency_ms: 1200,
        stream: true,
        ttft_ms: 350,
        token_breakdown: {
          input: {
            uncached_tokens: 100,
            cache_read_tokens: 20,
            cache_write_tokens: 10,
          },
          output: {
            non_reasoning_tokens: 50,
            reasoning_tokens: 30,
          },
          total_tokens: 210,
        },
      },
    ];

    const csv = generateUsageCsv(records);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.includes('\r\n')).toBe(true);

    const lines = csv.replace('﻿', '').split('\r\n');
    expect(lines.length).toBe(3); // header + 1 data row + trailing empty line
    const header = lines[0];
    expect(header).toContain('Timestamp');
    expect(header).toContain('Endpoint');
    expect(header).toContain('Reasoning Effort');
    expect(header).toContain('Uncached Input Tokens');
    expect(header).toContain('Reasoning Tokens');

    const row = lines[1];
    expect(row).toContain('2026-09-18T10:00:00Z');
    expect(row).toContain('openai');
    expect(row).toContain('gpt-4o');
    expect(row).toContain('/v1/chat/completions');
    expect(row).toContain('medium');
    expect(row).toContain('1200');
    expect(row).toContain('350');
    expect(row).toContain('210');
  });

  test('aggregates breakdown rows into top N plus Other', () => {
    const rows: BreakdownRow[] = [
      { key: 'm1', records: 10, failures: 0, uncached_input_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0, non_reasoning_output_tokens: 0, reasoning_tokens: 0, total_tokens: 1000, latency_ms_sum: 0, latency_samples: 0, ttft_ms_sum: 0, ttft_samples: 0 },
      { key: 'm2', records: 8, failures: 0, uncached_input_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0, non_reasoning_output_tokens: 0, reasoning_tokens: 0, total_tokens: 800, latency_ms_sum: 0, latency_samples: 0, ttft_ms_sum: 0, ttft_samples: 0 },
      { key: 'm3', records: 6, failures: 0, uncached_input_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0, non_reasoning_output_tokens: 0, reasoning_tokens: 0, total_tokens: 600, latency_ms_sum: 0, latency_samples: 0, ttft_ms_sum: 0, ttft_samples: 0 },
      { key: 'm4', records: 4, failures: 0, uncached_input_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0, non_reasoning_output_tokens: 0, reasoning_tokens: 0, total_tokens: 400, latency_ms_sum: 0, latency_samples: 0, ttft_ms_sum: 0, ttft_samples: 0 },
      { key: 'm5', records: 2, failures: 0, uncached_input_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0, non_reasoning_output_tokens: 0, reasoning_tokens: 0, total_tokens: 200, latency_ms_sum: 0, latency_samples: 0, ttft_ms_sum: 0, ttft_samples: 0 },
    ];

    const aggregated = aggregateBreakdownRows(rows, 3);
    expect(aggregated.displayed.length).toBe(4); // 3 items + 1 Other item
    expect(aggregated.displayed[0].key).toBe('m1');
    expect(aggregated.displayed[0].total_tokens).toBe(1000);
    expect(aggregated.displayed[0].share).toBeCloseTo(1000 / 3000, 4);

    const other = aggregated.displayed[3];
    expect(other.isOther).toBe(true);
    expect(other.total_tokens).toBe(600); // 400 + 200
    expect(other.records).toBe(6); // 4 + 2
    expect(other.share).toBeCloseTo(600 / 3000, 4);
    expect(aggregated.totalTokens).toBe(3000);

    // Test sorting and share calculation by requests metric
    const aggRequests = aggregateBreakdownRows(rows, 3, 'requests');
    expect(aggRequests.displayed.length).toBe(4);
    expect(aggRequests.totalRecords).toBe(30); // 10+8+6+4+2
    // m1 had 10 records, m2 had 8 records, m3 had 6 records
    expect(aggRequests.displayed[0].key).toBe('m1');
    expect(aggRequests.displayed[0].share).toBeCloseTo(10 / 30, 4);
    expect(aggRequests.displayed[1].key).toBe('m2');
    expect(aggRequests.displayed[1].share).toBeCloseTo(8 / 30, 4);
    expect(aggRequests.displayed[3].isOther).toBe(true);
    expect(aggRequests.displayed[3].records).toBe(6); // 4+2
    expect(aggRequests.displayed[3].share).toBeCloseTo(6 / 30, 4);
  });

  test('formats compact human-readable numbers with units K, M, B and strips trailing zeros', () => {
    expect(formatCompactNumber(null)).toBe('0');
    expect(formatCompactNumber(undefined)).toBe('0');
    expect(formatCompactNumber(0)).toBe('0');
    expect(formatCompactNumber(120)).toBe('120');
    expect(formatCompactNumber(999)).toBe('999');

    // Thousands (K)
    expect(formatCompactNumber(1000)).toBe('1K');
    expect(formatCompactNumber(1500)).toBe('1.5K');
    expect(formatCompactNumber(1250)).toBe('1.25K');
    expect(formatCompactNumber(200000)).toBe('200K');

    // Millions (M)
    expect(formatCompactNumber(1000000)).toBe('1M');
    expect(formatCompactNumber(1500000)).toBe('1.5M');
    expect(formatCompactNumber(100000000)).toBe('100M');
    expect(formatCompactNumber(200000000)).toBe('200M');
    expect(formatCompactNumber(123456789)).toBe('123.46M');

    // Billions (B)
    expect(formatCompactNumber(1000000000)).toBe('1B');
    expect(formatCompactNumber(2500000000)).toBe('2.5B');

    // Token count wrapper enforces non-negative format
    expect(formatTokenCount(100000000)).toBe('100M');
    expect(formatTokenCount(200000000)).toBe('200M');
    expect(formatTokenCount(-50)).toBe('0');
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(200)).toBe('200');
  });

  test('computes nice axis scale aligned to multiples like 25M, 20M, 15M, 10M, 5M, 0', () => {
    // 23.67M rounds nicely up to 25M with step 5M (5 intervals, 6 ticks)
    const scale23m = computeNiceScale(23_670_000, 5);
    expect(scale23m.max).toBe(25_000_000);
    expect(scale23m.step).toBe(5_000_000);
    expect(scale23m.ticks).toEqual([25_000_000, 20_000_000, 15_000_000, 10_000_000, 5_000_000, 0]);
    expect(scale23m.ticks.map((t) => formatTokenCount(t))).toEqual(['25M', '20M', '15M', '10M', '5M', '0']);

    // 2.15M (sub2api reference screenshot) rounds nicely to 2.5M with step 500K
    const scale2m = computeNiceScale(2_150_000, 5);
    expect(scale2m.max).toBe(2_500_000);
    expect(scale2m.step).toBe(500_000);
    expect(scale2m.ticks).toEqual([2_500_000, 2_000_000, 1_500_000, 1_000_000, 500_000, 0]);
    expect(scale2m.ticks.map((t) => formatTokenCount(t))).toEqual(['2.5M', '2M', '1.5M', '1M', '500K', '0']);

    // Zero or negative returns baseline 5 ticks
    const scaleZero = computeNiceScale(0, 5);
    expect(scaleZero.max).toBe(5);
    expect(scaleZero.ticks).toEqual([5, 4, 3, 2, 1, 0]);

    // Integer request counts
    const scaleReq = computeNiceScale(12, 5, true);
    expect(scaleReq.max).toBeGreaterThanOrEqual(12);
    expect(scaleReq.ticks.every((t) => Number.isInteger(t))).toBe(true);
  });

  test('generates smooth cubic Bezier path clamped within boundaries', () => {
    // Empty / single point
    expect(buildSmoothPath([])).toBe('');
    expect(buildSmoothPath([{ x: 10, y: 50 }])).toBe('M 10.00,50.00');

    // Two points -> line
    expect(buildSmoothPath([{ x: 0, y: 10 }, { x: 100, y: 90 }])).toBe('M 0.00,10.00 L 100.00,90.00');

    // Three points -> smooth cubic Bezier
    const path3 = buildSmoothPath([
      { x: 0, y: 95 },
      { x: 50, y: 20 },
      { x: 100, y: 95 },
    ]);
    expect(path3).toContain('M 0.00,95.00 C');

    // Handles null gaps for broken series
    const pathGapped = buildSmoothPath([
      { x: 0, y: 50 },
      { x: 20, y: 40 },
      null,
      { x: 60, y: 30 },
      { x: 100, y: 20 },
    ]);
    expect(pathGapped).toContain('M 0.00,50.00');
    expect(pathGapped).toContain('M 60.00,30.00');
  });

  test('cleans account names by stripping trailing .json and trimming whitespace', () => {
    expect(cleanAccountName(null)).toBe('—');
    expect(cleanAccountName(undefined)).toBe('—');
    expect(cleanAccountName('')).toBe('—');
    expect(cleanAccountName('   ')).toBe('—');
    expect(cleanAccountName('antigravity-george.j.ramirez1989@gmail.com.json')).toBe(
      'antigravity-george.j.ramirez1989@gmail.com'
    );
    expect(cleanAccountName('codex-023b6056-tongzhipeng5688@gmail.com-plus.json')).toBe(
      'codex-023b6056-tongzhipeng5688@gmail.com-plus'
    );
    expect(cleanAccountName('antigravity-tongzhipeng5688@gmail.com')).toBe(
      'antigravity-tongzhipeng5688@gmail.com'
    );
    expect(cleanAccountName('  user.json  ')).toBe('user');
  });
});
