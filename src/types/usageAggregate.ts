export interface UsageAggregateTokenStats {
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
  total_tokens?: number;
}

export interface UsageAggregateLatencyStats {
  count?: number;
  total_ms?: number;
  min_ms?: number;
  max_ms?: number;
}

export interface UsageAggregateRateStats {
  window_minutes?: number;
  request_count?: number;
  token_count?: number;
  rpm?: number;
  tpm?: number;
}

export interface UsageAggregateSparkline {
  timestamps?: string[];
  requests?: number[];
  tokens?: number[];
}

export interface UsageAggregateModelSeries {
  timestamps?: string[];
  series?: Record<string, number[]>;
}

export interface UsageAggregateModelSeriesSet {
  hour?: UsageAggregateModelSeries;
  day?: UsageAggregateModelSeries;
}

export interface UsageAggregateTokenBreakdownSeries {
  timestamps?: string[];
  input?: number[];
  output?: number[];
  cached?: number[];
  reasoning?: number[];
}

export interface UsageAggregateTokenBreakdownSeriesSet {
  hour?: UsageAggregateTokenBreakdownSeries;
  day?: UsageAggregateTokenBreakdownSeries;
}

export interface UsageAggregateLatencySeries {
  timestamps?: string[];
  values?: Array<number | null>;
}

export interface UsageAggregateLatencySeriesSet {
  hour?: UsageAggregateLatencySeries;
  day?: UsageAggregateLatencySeries;
}

export interface UsageAggregateTokenSeries {
  input?: number[];
  output?: number[];
  cached?: number[];
  reasoning?: number[];
  total?: number[];
}

export interface UsageAggregateCostBasisSeries {
  timestamps?: string[];
  models?: Record<string, UsageAggregateTokenSeries>;
}

export interface UsageAggregateCostBasisSeriesSet {
  hour?: UsageAggregateCostBasisSeries;
  day?: UsageAggregateCostBasisSeries;
}

export interface UsageAggregateApiModelStat {
  requests?: number;
  success_count?: number;
  failure_count?: number;
  tokens?: number;
  token_breakdown?: UsageAggregateTokenStats;
  latency?: UsageAggregateLatencyStats;
}

export interface UsageAggregateApiStat {
  endpoint?: string;
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  total_tokens?: number;
  token_breakdown?: UsageAggregateTokenStats;
  latency?: UsageAggregateLatencyStats;
  models?: Record<string, UsageAggregateApiModelStat>;
}

export interface UsageAggregateModelStat {
  model?: string;
  requests?: number;
  success_count?: number;
  failure_count?: number;
  tokens?: number;
  token_breakdown?: UsageAggregateTokenStats;
  latency?: UsageAggregateLatencyStats;
}

export interface UsageAggregateCredentialStat {
  source?: string;
  auth_index?: string;
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  total_tokens?: number;
}

export interface UsageAggregateWindow {
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  total_tokens?: number;
  token_breakdown?: UsageAggregateTokenStats;
  latency?: UsageAggregateLatencyStats;
  rate_30m?: UsageAggregateRateStats;
  sparklines?: UsageAggregateSparkline;
  requests?: UsageAggregateModelSeriesSet;
  tokens?: UsageAggregateModelSeriesSet;
  token_breakdown_series?: UsageAggregateTokenBreakdownSeriesSet;
  latency_series?: UsageAggregateLatencySeriesSet;
  cost_basis?: UsageAggregateCostBasisSeriesSet;
  apis?: UsageAggregateApiStat[];
  models?: UsageAggregateModelStat[];
  credentials?: UsageAggregateCredentialStat[];
  model_names?: string[];
}

export interface UsageAggregateSnapshot {
  generated_at?: string;
  model_names?: string[];
  windows?: Record<string, UsageAggregateWindow>;
}
