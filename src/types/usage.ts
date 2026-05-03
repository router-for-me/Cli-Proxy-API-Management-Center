export interface UsageTokenStats {
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
  total_tokens?: number;
}

export interface UsageRequestDetail {
  timestamp?: string;
  latency_ms?: number;
  source?: string;
  auth_index?: string;
  tokens?: UsageTokenStats;
  failed?: boolean;
}

export interface UsageModelSnapshot {
  total_requests?: number;
  total_tokens?: number;
  failure_count?: number;
  details?: UsageRequestDetail[];
}

export interface UsageApiSnapshot {
  total_requests?: number;
  total_tokens?: number;
  failure_count?: number;
  models?: Record<string, UsageModelSnapshot>;
}

export interface UsageSnapshot {
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  total_tokens?: number;
  apis?: Record<string, UsageApiSnapshot>;
  requests_by_day?: Record<string, number>;
  requests_by_hour?: Record<string, number>;
  tokens_by_day?: Record<string, number>;
  tokens_by_hour?: Record<string, number>;
}

export interface UsageResponse {
  statistics_enabled?: boolean;
  usage?: UsageSnapshot;
}
