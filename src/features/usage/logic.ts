import type {
  UsageBucket,
  UsageRange,
  UsageRecord,
  UsageRangeQuery,
  UsageSummary,
} from './types';

export function buildUsageRange(range: UsageRange, now = new Date()): UsageRangeQuery {
  const to = new Date(now.getTime());
  const from = new Date(now.getTime());
  if (range === '24h') {
    from.setHours(from.getHours() - 24);
    return { from: from.toISOString(), to: to.toISOString(), step: 'hour' };
  }
  from.setDate(from.getDate() - 7);
  return { from: from.toISOString(), to: to.toISOString(), step: 'day' };
}

export function summarizeBuckets(buckets: UsageBucket[]): UsageSummary {
  const summary = buckets.reduce(
    (total, bucket) => ({
      totalTokens: total.totalTokens + bucket.total_tokens,
      inputTokens:
        total.inputTokens +
        bucket.uncached_input_tokens +
        bucket.cache_read_tokens +
        bucket.cache_write_tokens,
      outputTokens:
        total.outputTokens + bucket.non_reasoning_output_tokens + bucket.reasoning_tokens,
      requests: total.requests + bucket.records,
      failures: total.failures + bucket.failures,
      errorRate: 0,
    }),
    { totalTokens: 0, inputTokens: 0, outputTokens: 0, requests: 0, failures: 0, errorRate: 0 }
  );
  return {
    ...summary,
    errorRate: summary.requests > 0 ? (summary.failures / summary.requests) * 100 : 0,
  };
}

export function metricValue(bucket: UsageBucket, metric: 'tokens' | 'requests'): number {
  return metric === 'requests' ? bucket.records : bucket.total_tokens;
}

export function formatTokenCount(value: number): string {
  return Math.max(0, value).toLocaleString();
}

export function formatLatency(record: UsageRecord): string {
  if (record.latency_ms <= 0) return '—';
  return `${record.latency_ms.toLocaleString()} ms`;
}

export function formatStatus(record: UsageRecord): string {
  return record.failed ? `${record.status_code || 500}` : `${record.status_code || 200}`;
}
