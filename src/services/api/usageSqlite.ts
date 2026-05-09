/**
 * SQLite 持久化使用统计 API
 * 对接 CLIProxyAPI 后端的 /v0/management/usage-sqlite/* 端点
 */

import { apiClient } from './client';
import { TIMEOUT_HEAVY } from '@/utils/constants';

export interface UsageStats {
  total_requests: number;
  success_count: number;
  failed_count: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  avg_latency_ms: number;
}

export interface UsageRecord {
  timestamp: string;
  latency_ms: number;
  source: string;
  auth_index: string;
  auth_type: string;
  api_key: string;
  provider: string;
  model: string;
  alias: string;
  endpoint: string;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cached_tokens: number;
  total_tokens: number;
  failed: boolean;
  fail_status_code: number;
  fail_body: string;
  request_id: string;
}

export interface UsageRecordsResponse {
  records: UsageRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface ModelStat {
  model: string;
  provider: string;
  request_count: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
}

export interface DailyStat {
  date: string;
  request_count: number;
  total_tokens: number;
}

export interface UsageQueryParams {
  since?: string;   // duration string, e.g. "24h", "7d" (uses Go duration format)
  provider?: string;
  model?: string;
  api_key?: string;
  status?: 'success' | 'failed';
  limit?: number;
  offset?: number;
}

export const usageSqliteApi = {
  /** 获取聚合统计 */
  getStats: (since?: string) =>
    apiClient.get<UsageStats>('/usage-sqlite/stats', {
      timeout: TIMEOUT_HEAVY,
      params: since ? { since } : undefined,
    }),

  /** 获取分页使用记录 */
  getRecords: (params?: UsageQueryParams) =>
    apiClient.get<UsageRecordsResponse>('/usage-sqlite/records', {
      timeout: TIMEOUT_HEAVY,
      params: params as Record<string, unknown>,
    }),

  /** 获取按模型聚合统计 */
  getModelStats: (since?: string) =>
    apiClient.get<ModelStat[]>('/usage-sqlite/model-stats', {
      timeout: TIMEOUT_HEAVY,
      params: since ? { since } : undefined,
    }),

  /** 获取按日聚合统计 */
  getDailyStats: (since?: string) =>
    apiClient.get<DailyStat[]>('/usage-sqlite/daily-stats', {
      timeout: TIMEOUT_HEAVY,
      params: since ? { since } : undefined,
    }),

  /** 检查 SQLite 持久化是否启用 */
  getEnabled: () =>
    apiClient.get<{ enabled: boolean }>('/usage-sqlite/enabled', {
      timeout: TIMEOUT_HEAVY,
    }),
};
