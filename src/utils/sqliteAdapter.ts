/**
 * SQLite UsageRecord[] → UsageData 格式适配器
 * 将 SQLite 持久化的扁平记录转换为 MonitorPage 子组件期望的嵌套格式
 */

import type { UsageRecord } from '@/services/api/usageSqlite';
import type { UsageData, UsageDetail } from '@/pages/MonitorPage';

/**
 * 将 SQLite 使用记录转换为 UsageData 格式
 * UsageRecord[] (扁平) → { apis: { [apiKey]: { models: { [model]: { details: UsageDetail[] } } } } }
 */
export function sqliteRecordsToUsageData(records: UsageRecord[]): UsageData {
  const apis: UsageData['apis'] = {};

  for (const r of records) {
    const apiKey = r.api_key || 'unknown';
    const modelName = r.model || 'unknown';

    if (!apis[apiKey]) {
      apis[apiKey] = { models: {} };
    }
    if (!apis[apiKey].models[modelName]) {
      apis[apiKey].models[modelName] = { details: [] };
    }

    const detail: UsageDetail = {
      timestamp: r.timestamp,
      failed: r.failed,
      source: r.api_key,
      auth_index: r.auth_index,
      latency_ms: r.latency_ms,
      suspiciousToken: !r.failed && r.total_tokens === 0,
      tokens: {
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        reasoning_tokens: r.reasoning_tokens,
        cached_tokens: r.cached_tokens,
        total_tokens: r.total_tokens,
      },
    };

    apis[apiKey].models[modelName].details.push(detail);
  }

  return { apis };
}

export interface UsageBucket {
  /** Unix timestamp in ms of the bucket start (floored to bucketMinutes) */
  ts: number;
  requestCount: number;
  successCount: number;
  failedCount: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
}

/**
 * Aggregate usage records into fixed-window time buckets (like upstream's recentRequests).
 * Each bucket spans `bucketMinutes` minutes. Returns the most recent `maxBuckets` buckets
 * sorted by time ascending, suitable for O(1) status bar queries.
 */
export function bucketUsageRecords(
  records: UsageRecord[],
  bucketMinutes: number = 10,
  maxBuckets: number = 20
): UsageBucket[] {
  const bucketMs = bucketMinutes * 60_000;
  const bucketMap = new Map<number, UsageBucket>();

  for (const r of records) {
    const ts = new Date(r.timestamp).getTime();
    if (Number.isNaN(ts)) continue;
    const bucketTs = Math.floor(ts / bucketMs) * bucketMs;

    let bucket = bucketMap.get(bucketTs);
    if (!bucket) {
      bucket = { ts: bucketTs, requestCount: 0, successCount: 0, failedCount: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedTokens: 0 };
      bucketMap.set(bucketTs, bucket);
    }

    bucket.requestCount++;
    if (r.failed) {
      bucket.failedCount++;
    } else {
      bucket.successCount++;
    }
    bucket.totalTokens += r.total_tokens ?? 0;
    bucket.inputTokens += r.input_tokens ?? 0;
    bucket.outputTokens += r.output_tokens ?? 0;
    bucket.reasoningTokens += r.reasoning_tokens ?? 0;
    bucket.cachedTokens += r.cached_tokens ?? 0;
  }

  const sorted = Array.from(bucketMap.values()).sort((a, b) => a.ts - b.ts);
  return sorted.slice(-maxBuckets);
}
