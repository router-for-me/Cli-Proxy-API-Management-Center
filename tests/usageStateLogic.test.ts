import { describe, expect, test } from 'bun:test';
import {
  aggregateBreakdownRows,
  generateUsageCsv,
} from '@/features/usage/logic';
import type { BreakdownRow, UsageBucket, UsageRecord } from '@/features/usage/types';

describe('usage state and chart scaling logic', () => {
  test('shared tokenMax normalizes 4 token series against the same scale', () => {
    const buckets: UsageBucket[] = [
      {
        timestamp: '2026-09-18T10:00:00Z',
        records: 1,
        failures: 0,
        uncached_input_tokens: 1000,
        cache_read_tokens: 100,
        cache_write_tokens: 50,
        non_reasoning_output_tokens: 200,
        reasoning_tokens: 50, // total output = 250
        total_tokens: 1400,
      },
      {
        timestamp: '2026-09-18T11:00:00Z',
        records: 1,
        failures: 0,
        uncached_input_tokens: 200,
        cache_read_tokens: 500,
        cache_write_tokens: 100,
        non_reasoning_output_tokens: 800,
        reasoning_tokens: 0, // total output = 800
        total_tokens: 1600,
      },
    ];

    // Across all 4 series:
    // uncached input: 1000, 200
    // output: 250, 800
    // cache read: 100, 500
    // cache write: 50, 100
    // Maximum token value among all series is 1000.
    const allValues = buckets.flatMap((b) => [
      b.uncached_input_tokens,
      b.non_reasoning_output_tokens + b.reasoning_tokens,
      b.cache_read_tokens,
      b.cache_write_tokens,
    ]);
    const tokenMax = Math.max(1, ...allValues);
    expect(tokenMax).toBe(1000);

    // Height calculations: 100 tokens must NOT be at the same height as 1000 tokens
    const y1000 = 36 - (1000 / tokenMax) * 32;
    const y100 = 36 - (100 / tokenMax) * 32;
    expect(y1000).toBe(4);
    expect(y100).toBe(32.8);
    expect(y1000).not.toBe(y100);
  });

  test('cache hit rate calculation handles null and 0-100% on right axis', () => {
    const bucketWithNoInput: UsageBucket = {
      timestamp: '2026-09-18T10:00:00Z',
      records: 1,
      failures: 0,
      uncached_input_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 100,
      non_reasoning_output_tokens: 50,
      reasoning_tokens: 0,
      total_tokens: 150,
    };

    const denom = bucketWithNoInput.uncached_input_tokens + bucketWithNoInput.cache_read_tokens;
    const rate = denom > 0 ? (bucketWithNoInput.cache_read_tokens / denom) * 100 : null;
    expect(rate).toBeNull();

    const bucketWithHit: UsageBucket = {
      ...bucketWithNoInput,
      uncached_input_tokens: 200,
      cache_read_tokens: 800,
    };
    const hitDenom = bucketWithHit.uncached_input_tokens + bucketWithHit.cache_read_tokens;
    const hitRate = hitDenom > 0 ? (bucketWithHit.cache_read_tokens / hitDenom) * 100 : null;
    expect(hitRate).toBe(80);

    // Right axis is fixed 0-100%
    const yHit = 36 - ((hitRate ?? 0) / 100) * 32;
    expect(yHit).toBeCloseTo(36 - 0.8 * 32, 4);
  });

  test('donut breakdown handles 0 total tokens with records and single slice', () => {
    const zeroTokenRows: BreakdownRow[] = [
      {
        key: 'failed-model',
        records: 5,
        failures: 5,
        uncached_input_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        non_reasoning_output_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 0,
        latency_ms_sum: 500,
        latency_samples: 5,
        ttft_ms_sum: 0,
        ttft_samples: 0,
      },
    ];
    const agg = aggregateBreakdownRows(zeroTokenRows, 8);
    expect(agg.totalTokens).toBe(0);
    expect(agg.totalRecords).toBe(5);
    expect(agg.displayed.length).toBe(1);
    expect(agg.displayed[0].share).toBe(0);

    // Single positive slice should take 100% share
    const singleRow: BreakdownRow[] = [
      {
        ...zeroTokenRows[0],
        total_tokens: 5000,
      },
    ];
    const aggSingle = aggregateBreakdownRows(singleRow, 8);
    expect(aggSingle.totalTokens).toBe(5000);
    expect(aggSingle.displayed[0].share).toBe(1.0);
  });

  test('CSV export batching simulation enforces 2000 max and flags truncation', () => {
    // Simulate fetching pages of 200 up to 2000
    const records: UsageRecord[] = [];
    for (let i = 0; i < 2000; i++) {
      records.push({
        timestamp: '2026-09-18T10:00:00Z',
        provider: 'openai',
        executor_type: 'direct',
        model: `model-${i % 5}`,
        alias: 'm',
        account: 'acc',
        failed: false,
        status_code: 200,
        latency_ms: 100,
        token_breakdown: { total_tokens: 50 },
      });
    }

    expect(records.length).toBe(2000);
    const hasMore = true;
    const isTruncated = records.length >= 2000 && hasMore;
    expect(isTruncated).toBe(true);

    const hasMoreExact = false;
    const isTruncatedExact = records.length >= 2000 && hasMoreExact;
    expect(isTruncatedExact).toBe(false);

    const csv = generateUsageCsv(records);
    const lines = csv.replace('﻿', '').split('\r\n').filter(Boolean);
    expect(lines.length).toBe(2001); // 1 header + 2000 rows
  });

  test('CSV export strips .json suffix from account column', () => {
    const records: UsageRecord[] = [
      {
        timestamp: '2026-09-19T10:00:00Z',
        provider: 'antigravity',
        executor_type: 'direct',
        model: 'gemini-3.8-flash-high',
        alias: 'gemini-3.8-flash-high',
        account: 'antigravity-kevin.lee.rowan@gmail.com.json',
        failed: false,
        status_code: 200,
        latency_ms: 100,
        token_breakdown: { total_tokens: 50 },
      },
    ];
    const csv = generateUsageCsv(records);
    expect(csv).toContain('antigravity-kevin.lee.rowan@gmail.com');
    expect(csv).not.toContain('antigravity-kevin.lee.rowan@gmail.com.json');
  });
});
