/**
 * 使用统计相关 API
 */

import { apiClient } from './client';
import { computeKeyStats, KeyStats } from '@/utils/usage';

const USAGE_TIMEOUT_MS = 60 * 1000;

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

export interface UsagePersistenceConfig {
  enabled?: boolean;
  filePath?: string;
  intervalSeconds?: number;
  maxDetailsPerModel?: number;
}

export interface UsagePersistenceStatus {
  enabled?: boolean;
  filePath?: string;
  intervalSeconds?: number;
  maxDetailsPerModel?: number;
  lastLoadedAt?: string;
  lastSavedAt?: string;
  saveCount?: number;
  loadCount?: number;
  lastLoadAdded?: number;
  lastLoadSkipped?: number;
  lastError?: string;
  [key: string]: unknown;
}

export interface UsagePersistenceLoadResult {
  loaded?: boolean;
  filePath?: string;
  added?: number;
  skipped?: number;
  [key: string]: unknown;
}

type UsagePersistenceConfigResponse = {
  'usage-persistence'?: Record<string, unknown>;
  status?: {
    runtime?: Record<string, unknown>;
  };
};

const parseUsagePersistenceConfig = (payload: unknown): UsagePersistenceConfig => {
  if (!payload || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined,
    filePath:
      typeof record['file-path'] === 'string'
        ? record['file-path']
        : typeof record.filePath === 'string'
          ? record.filePath
          : undefined,
    intervalSeconds:
      typeof record['interval-seconds'] === 'number'
        ? record['interval-seconds']
        : typeof record.intervalSeconds === 'number'
          ? record.intervalSeconds
          : undefined,
    maxDetailsPerModel:
      typeof record['max-details-per-model'] === 'number'
        ? record['max-details-per-model']
        : typeof record.maxDetailsPerModel === 'number'
          ? record.maxDetailsPerModel
          : undefined
  };
};

const parseUsagePersistenceStatus = (payload: unknown): UsagePersistenceStatus => {
  if (!payload || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined,
    filePath:
      typeof record['file-path'] === 'string'
        ? record['file-path']
        : typeof record.path === 'string'
          ? record.path
        : typeof record.filePath === 'string'
          ? record.filePath
          : undefined,
    intervalSeconds:
      typeof record['interval-seconds'] === 'number'
        ? record['interval-seconds']
        : typeof record.interval_seconds === 'number'
          ? record.interval_seconds
        : typeof record.intervalSeconds === 'number'
          ? record.intervalSeconds
          : undefined,
    maxDetailsPerModel:
      typeof record['max-details-per-model'] === 'number'
        ? record['max-details-per-model']
        : typeof record.max_details_per_model === 'number'
          ? record.max_details_per_model
          : typeof record.maxDetailsPerModel === 'number'
            ? record.maxDetailsPerModel
            : undefined,
    lastLoadedAt:
      typeof record['last-loaded-at'] === 'string'
        ? record['last-loaded-at']
        : typeof record.last_loaded_at === 'string'
          ? record.last_loaded_at
        : typeof record.lastLoadedAt === 'string'
          ? record.lastLoadedAt
          : undefined,
    lastSavedAt:
      typeof record['last-saved-at'] === 'string'
        ? record['last-saved-at']
        : typeof record.last_saved_at === 'string'
          ? record.last_saved_at
        : typeof record.lastSavedAt === 'string'
          ? record.lastSavedAt
          : undefined,
    saveCount:
      typeof record['save-count'] === 'number'
        ? record['save-count']
        : typeof record.saveCount === 'number'
          ? record.saveCount
          : undefined,
    loadCount:
      typeof record['load-count'] === 'number'
        ? record['load-count']
        : typeof record.loadCount === 'number'
          ? record.loadCount
          : undefined,
    lastLoadAdded:
      typeof record['last-load-added'] === 'number'
        ? record['last-load-added']
        : typeof record.lastLoadAdded === 'number'
          ? record.lastLoadAdded
          : undefined,
    lastLoadSkipped:
      typeof record['last-load-skipped'] === 'number'
        ? record['last-load-skipped']
        : typeof record.lastLoadSkipped === 'number'
          ? record.lastLoadSkipped
          : undefined,
    lastError:
      typeof record['last-error'] === 'string'
        ? record['last-error']
        : typeof record.last_error === 'string'
          ? record.last_error
        : typeof record.lastError === 'string'
          ? record.lastError
          : undefined
  };
};

const parseUsagePersistenceLoadResult = (payload: unknown): UsagePersistenceLoadResult => {
  if (!payload || typeof payload !== 'object') return {};
  const record = payload as Record<string, unknown>;
  return {
    loaded: typeof record.loaded === 'boolean' ? record.loaded : undefined,
    filePath:
      typeof record['file-path'] === 'string'
        ? record['file-path']
        : typeof record.filePath === 'string'
          ? record.filePath
          : undefined,
    added: typeof record.added === 'number' ? record.added : undefined,
    skipped: typeof record.skipped === 'number' ? record.skipped : undefined
  };
};

export const usageApi = {
  /**
   * 获取使用统计原始数据
   */
  getUsage: () => apiClient.get<Record<string, unknown>>('/usage', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 导出使用统计快照
   */
  exportUsage: () => apiClient.get<UsageExportPayload>('/usage/export', { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 导入使用统计快照
   */
  importUsage: (payload: unknown) =>
    apiClient.post<UsageImportResponse>('/usage/import', payload, { timeout: USAGE_TIMEOUT_MS }),

  /**
   * 获取 usage 持久化配置
   */
  async getUsagePersistenceConfig(): Promise<{
    config: UsagePersistenceConfig;
    status: UsagePersistenceStatus;
  }> {
    const response = await apiClient.get<UsagePersistenceConfigResponse>('/usage-persistence', {
      timeout: USAGE_TIMEOUT_MS
    });
    return {
      config: parseUsagePersistenceConfig(response?.['usage-persistence']),
      status: parseUsagePersistenceStatus(response?.status?.runtime)
    };
  },

  /**
   * 更新 usage 持久化配置
   */
  async updateUsagePersistenceConfig(config: UsagePersistenceConfig): Promise<UsagePersistenceConfig> {
    const payload: Record<string, unknown> = {};
    if (typeof config.enabled === 'boolean') payload.enabled = config.enabled;
    if (typeof config.filePath === 'string') payload['file-path'] = config.filePath;
    if (typeof config.intervalSeconds === 'number') {
      payload['interval-seconds'] = config.intervalSeconds;
    }
    if (typeof config.maxDetailsPerModel === 'number') {
      payload['max-details-per-model'] = config.maxDetailsPerModel;
    }
    const response = await apiClient.put<UsagePersistenceConfigResponse>('/usage-persistence', payload, {
      timeout: USAGE_TIMEOUT_MS
    });
    return parseUsagePersistenceConfig(response?.['usage-persistence']);
  },

  /**
   * 获取 usage 持久化运行时状态
   */
  async getUsagePersistenceStatus(): Promise<UsagePersistenceStatus> {
    const response = await apiClient.get<{ status?: Record<string, unknown> }>(
      '/usage/persistence-status',
      { timeout: USAGE_TIMEOUT_MS }
    );
    return parseUsagePersistenceStatus(response?.status);
  },

  /**
   * 立即保存 usage 统计
   */
  async saveUsageStatistics(): Promise<UsagePersistenceStatus> {
    const response = await apiClient.post<{ status?: Record<string, unknown> }>(
      '/usage/save',
      {},
      { timeout: USAGE_TIMEOUT_MS }
    );
    return parseUsagePersistenceStatus(response?.status);
  },

  /**
   * 立即加载 usage 统计
   */
  async loadUsageStatistics(): Promise<{
    result: UsagePersistenceLoadResult;
    totalRequests?: number;
    failedRequests?: number;
  }> {
    const response = await apiClient.post<Record<string, unknown>>('/usage/load', {}, { timeout: USAGE_TIMEOUT_MS });
    return {
      result: parseUsagePersistenceLoadResult(response?.result),
      totalRequests:
        typeof response?.total_requests === 'number' ? response.total_requests : undefined,
      failedRequests:
        typeof response?.failed_requests === 'number' ? response.failed_requests : undefined
    };
  },

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
