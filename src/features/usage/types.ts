export type UsageRange = '24h' | '7d';
export type UsageMetric = 'tokens' | 'requests';

export interface TokenBreakdown {
  input?: {
    uncached_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    total_tokens?: number;
  };
  output?: {
    non_reasoning_tokens?: number;
    reasoning_tokens?: number;
    total_tokens?: number;
  };
  total_tokens?: number;
}

export interface UsageBucket {
  timestamp: string;
  records: number;
  failures: number;
  uncached_input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  non_reasoning_output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  latency_ms_sum?: number;
  latency_samples?: number;
  ttft_ms_sum?: number;
  ttft_samples?: number;
}

export interface UsageRecord {
  timestamp: string;
  provider: string;
  executor_type: string;
  model: string;
  alias: string;
  account: string;
  auth_type: string;
  endpoint?: string;
  reasoning_effort?: string;
  request_id?: string;
  failed: boolean;
  status_code: number;
  latency_ms: number;
  stream?: boolean;
  ttft_ms?: number;
  error_message?: string;
  token_breakdown: TokenBreakdown;
}

export interface BreakdownRow {
  key: string;
  records: number;
  failures: number;
  uncached_input_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  non_reasoning_output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
  latency_ms_sum: number;
  latency_samples: number;
  ttft_ms_sum: number;
  ttft_samples: number;
}

export interface UsageBreakdownResponse {
  from: string;
  to: string;
  dimension: string;
  rows: BreakdownRow[];
}

export interface UsageTimeseriesResponse {
  from: string;
  to: string;
  step: 'hour' | 'day';
  range_mode?: 'bucket' | 'exact';
  buckets: UsageBucket[];
}

export interface UsageRecordsResponse {
  from: string;
  to: string;
  records: UsageRecord[];
  has_more: boolean;
  next_offset: number;
  snapshot_id?: string;
}

export interface UsageRangeQuery {
  from: string;
  to: string;
  step: 'hour' | 'day';
  range_mode?: 'bucket' | 'exact';
}

export interface UsageSummary {
  totalTokens: number;
  inputTokens: number;
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  requests: number;
  failures: number;
  errorRate: number;
  avgLatencyMs: number | null;
  avgTtftMs: number | null;
  cacheHitRate: number | null;
}

export interface UsageFilter {
  provider?: string;
  model?: string;
  account?: string;
  failed?: boolean;
}

export interface AggregatedBreakdownRow extends BreakdownRow {
  isOther?: boolean;
  share: number;
}

export interface AggregatedBreakdownResult {
  displayed: AggregatedBreakdownRow[];
  totalTokens: number;
  totalRecords: number;
}
