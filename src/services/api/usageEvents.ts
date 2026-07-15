/**
 * Durable request monitoring APIs (SQLite-backed on CPA).
 */

import { apiClient } from './client';

export interface UsageEvent {
  id: number;
  timestamp_ms: number;
  request_id?: string;
  provider?: string;
  executor_type?: string;
  model?: string;
  alias?: string;
  endpoint?: string;
  auth_type?: string;
  auth_index?: string;
  source?: string;
  source_hash?: string;
  api_key_hash?: string;
  reasoning_effort?: string;
  service_tier?: string;
  response_service_tier?: string;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  latency_ms?: number | null;
  ttft_ms?: number | null;
  failed: boolean;
  fail_status_code?: number;
  fail_summary?: string;
  estimated_cost?: number | null;
}

export interface UsageSummary {
  total_calls: number;
  success_calls: number;
  failure_calls: number;
  success_rate: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  avg_latency_ms: number;
  avg_ttft_ms: number;
  estimated_cost: number;
  priced_calls: number;
}

export interface UsageAccountStat {
  auth_index?: string;
  source?: string;
  source_hash?: string;
  provider?: string;
  total_calls: number;
  success_calls: number;
  failure_calls: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost: number;
}

export interface UsageFilterOptions {
  models: string[];
  providers: string[];
  auth_indices: string[];
  sources: string[];
  api_key_hashes: string[];
}

export interface UsageQuery {
  from_ms?: number;
  to_ms?: number;
  search?: string;
  models?: string[];
  providers?: string[];
  auth_indices?: string[];
  sources?: string[];
  api_key_hashes?: string[];
  failed_only?: boolean;
  success_only?: boolean;
  limit?: number;
  before_id?: number;
}

export interface ModelPrice {
  model: string;
  prompt_per_1m: number;
  completion_per_1m: number;
  cache_per_1m?: number;
  cache_read_per_1m?: number;
  cache_creation_per_1m?: number;
  source?: string;
  updated_at_ms?: number;
}

export interface ModelPriceAlias {
  alias: string;
  target_model: string;
  updated_at_ms?: number;
}

export interface ModelPricesResponse {
  prices: ModelPrice[];
  aliases: ModelPriceAlias[];
  unpriced_models: string[];
  store_path?: string;
}

export interface UsageEventsResponse {
  events: UsageEvent[];
  next_before_id?: number;
  generated_at_ms?: number;
  store_path?: string;
}

export interface UsageSummaryResponse {
  summary: UsageSummary;
  generated_at_ms?: number;
  usage_statistics_enabled?: boolean;
}

const TIMEOUT_MS = 30_000;

export const usageEventsApi = {
  listEvents: (query: UsageQuery = {}) =>
    apiClient.post<UsageEventsResponse>('/usage-events', query, { timeout: TIMEOUT_MS }),

  getSummary: (query: UsageQuery = {}) =>
    apiClient.post<UsageSummaryResponse>('/usage-summary', query, { timeout: TIMEOUT_MS }),

  getFilterOptions: (query: UsageQuery = {}) =>
    apiClient.post<UsageFilterOptions>('/usage-filter-options', query, { timeout: TIMEOUT_MS }),

  getAccountStats: (query: UsageQuery = {}) =>
    apiClient.post<{ accounts: UsageAccountStat[] }>('/usage-account-stats', query, {
      timeout: TIMEOUT_MS,
    }),

  getModelPrices: () => apiClient.get<ModelPricesResponse>('/model-prices', { timeout: TIMEOUT_MS }),

  putModelPrices: (prices: ModelPrice[], replace = false) =>
    apiClient.put('/model-prices', { prices, replace }, { timeout: TIMEOUT_MS }),

  putModelPriceAliases: (aliases: ModelPriceAlias[]) =>
    apiClient.put('/model-price-aliases', { aliases }, { timeout: TIMEOUT_MS }),

  deleteModelPrice: (model: string) =>
    apiClient.delete('/model-prices', { params: { model }, timeout: TIMEOUT_MS }),

  deleteModelPriceAlias: (alias: string) =>
    apiClient.delete('/model-price-aliases', { params: { alias }, timeout: TIMEOUT_MS }),
};
