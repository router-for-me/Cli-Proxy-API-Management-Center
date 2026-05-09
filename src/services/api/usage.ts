/**
 * 使用统计相关 API
 */

import { apiClient } from './client';
import { computeKeyStats, KeyStats } from '@/utils/usage';
import { TIMEOUT_HEAVY } from '@/utils/constants';

export interface UsageExportPayload {
  version?: number;
  exported_at?: string;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UsageImportResponse {
  added?: number;
  skipped?: number;
  total_requests?: number;
  failed_requests?: number;
  [key: string]: unknown;
}

export const usageApi = {
  /**
   * 获取使用统计原始数据
   */
  getUsage: () => apiClient.get<Record<string, unknown>>('/usage', { timeout: TIMEOUT_HEAVY }),

  /**
   * 导出使用统计快照
   */
  exportUsage: () => apiClient.get<UsageExportPayload>('/usage/export', { timeout: TIMEOUT_HEAVY }),

  /**
   * 导入使用统计快照
   */
  importUsage: (payload: unknown) =>
    apiClient.post<UsageImportResponse>('/usage/import', payload, { timeout: TIMEOUT_HEAVY }),

  /**
   * 计算密钥成功/失败统计，必要时会先获取 usage 数据
   */
  async getKeyStats(usageData?: unknown): Promise<KeyStats> {
    let payload = usageData;
    if (!payload) {
      const response = await apiClient.get<Record<string, unknown>>('/usage', { timeout: TIMEOUT_HEAVY });
      payload = response?.usage ?? response;
    }
    return computeKeyStats(payload);
  }
};
