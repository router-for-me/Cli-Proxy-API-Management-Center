/**
 * 使用统计相关 API
 */

import { apiClient } from './client';
import { computeKeyStats, KeyStats } from '@/utils/usage';

const USAGE_TIMEOUT_MS = 60 * 1000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const extractUsageSnapshot = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) {
    return null;
  }

  const nestedUsage = value.usage;
  if (isRecord(nestedUsage)) {
    return nestedUsage;
  }

  return value;
};

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
  getUsage: () => apiClient.get<Record<string, unknown>>('/usage', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 导出使用统计快照
   */
  exportUsage: async (fallbackUsage?: unknown): Promise<UsageExportPayload> => {
    const [exportResult, usageResult] = await Promise.allSettled([
      apiClient.get<UsageExportPayload>('/usage/export', { timeout: USAGE_TIMEOUT_MS }),
      apiClient.get<Record<string, unknown>>('/usage', { timeout: USAGE_TIMEOUT_MS })
    ]);

    const exportPayload =
      exportResult.status === 'fulfilled' && isRecord(exportResult.value)
        ? exportResult.value
        : {};

    const fullUsage =
      (usageResult.status === 'fulfilled' ? extractUsageSnapshot(usageResult.value) : null) ??
      extractUsageSnapshot(fallbackUsage) ??
      extractUsageSnapshot(exportPayload.usage);

    if (!fullUsage) {
      if (usageResult.status === 'rejected') {
        throw usageResult.reason;
      }
      if (exportResult.status === 'rejected') {
        throw exportResult.reason;
      }
      throw new Error('Usage export payload is empty');
    }

    return {
      ...exportPayload,
      version: typeof exportPayload.version === 'number' ? exportPayload.version : 1,
      exported_at:
        typeof exportPayload.exported_at === 'string'
          ? exportPayload.exported_at
          : new Date().toISOString(),
      usage: fullUsage
    };
  },

  /**
   * 导入使用统计快照
   */
  importUsage: (payload: unknown) =>
    apiClient.post<UsageImportResponse>('/usage/import', payload, { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 计算密钥成功/失败统计，必要时会先获取 usage 数据
   */
  async getKeyStats(usageData?: unknown): Promise<KeyStats> {
    let payload = usageData;
    if (!payload) {
      const response = await apiClient.get<Record<string, unknown>>('/usage', { timeout: USAGE_TIMEOUT_MS });
      payload = response?.usage ?? response;
    }
    return computeKeyStats(payload);
  }
};
