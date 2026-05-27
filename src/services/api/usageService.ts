import axios from 'axios';
import type { UsagePayload } from '@/features/monitoring/hooks/useUsageData';
import { normalizeApiBase } from '@/utils/connection';
import type { ModelPrice } from '@/utils/usage';

const USAGE_SERVICE_ERROR_CODES = new Set([
  'request_failed',
  'connection_env_managed',
  'cpa_connection_required',
  'cpa_connection_required_for_monitoring',
  'management_api_validation_failed',
  'management_api_config_failed',
  'cpa_usage_retention_invalid',
  'poll_interval_exceeds_retention',
  'enable_cpa_usage_statistics_failed',
  'setup_env_managed',
  'invalid_existing_management_key',
  'invalid_management_key',
  'usage_service_not_configured',
  'prices_required',
  'api_key_aliases_required',
  'api_key_alias_duplicate',
  'model_price_sync_failed',
  'method_not_allowed',
]);

export interface UsageServiceApiError extends Error {
  status?: number;
  code?: string;
  details?: unknown;
  data?: unknown;
}

export interface UsageQuery {
  startMs?: number;
  endMs?: number;
  account?: string;
  provider?: string;
  model?: string;
  channel?: string;
  apiKeyHash?: string;
  status?: 'success' | 'failed';
  search?: string;
  searchApiKeyHash?: string;
}

export type UsagePageKind = 'accounts' | 'api-keys' | 'realtime' | 'models';

export interface UsagePageQuery {
  page: number;
  pageSize: number;
  sortKey?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface UsagePageResponse {
  page: number;
  page_size: number;
  total_items: number;
  usage: UsagePayload;
  items?: unknown[];
}

export interface UsageServiceInfo {
  service?: string;
  mode?: string;
  startedAt?: number;
  configured?: boolean;
}

export interface UsageServiceCollectorStatus {
  collector?: string;
  upstream?: string;
  mode?: string;
  transport?: string;
  queue?: string;
  lastConsumedAt?: number;
  lastInsertedAt?: number;
  totalInserted?: number;
  totalSkipped?: number;
  deadLetters?: number;
  lastError?: string;
}

export interface UsageServiceStatus {
  service?: string;
  dbPath?: string;
  events?: number;
  deadLetters?: number;
  collector?: UsageServiceCollectorStatus;
}

export interface UsageServiceSetupRequest {
  cpaBaseUrl: string;
  managementKey: string;
  collectorMode?: string;
  queue?: string;
  popSide?: string;
  batchSize?: number;
  pollIntervalMs?: number;
  queryLimit?: number;
  tlsSkipVerify?: boolean;
  ensureUsageStatisticsEnabled?: boolean;
  requestMonitoringEnabled?: boolean;
}

export interface ManagerCPAConnectionConfig {
  cpaBaseUrl: string;
  managementKey?: string;
}

export interface ManagerCollectorConfig {
  enabled?: boolean;
  collectorMode: string;
  queue: string;
  popSide: string;
  batchSize: number;
  pollIntervalMs: number;
  queryLimit: number;
  tlsSkipVerify?: boolean;
}

export interface ManagerExternalUsageServiceConfig {
  enabled: boolean;
  serviceBase: string;
}

export interface ManagerConfig {
  cpaConnection: ManagerCPAConnectionConfig;
  collector: ManagerCollectorConfig;
  externalUsageService: ManagerExternalUsageServiceConfig;
  updatedAtMs?: number;
}

export interface CPAUsageConfig {
  usageStatisticsEnabled: boolean;
  redisUsageQueueRetentionSeconds: number;
  retentionSourceDefault?: boolean;
}

export interface ManagerConfigResponse {
  config: ManagerConfig;
  source?: 'env' | 'db' | '';
  cpaUsage?: CPAUsageConfig;
}

export interface ModelPricesResponse {
  prices: Record<string, ModelPrice>;
}

export interface ModelPriceSyncResponse extends ModelPricesResponse {
  source?: string;
  imported: number;
  skipped: number;
  unmatched?: string[];
}

export interface ApiKeyAlias {
  apiKeyHash: string;
  alias: string;
  updatedAtMs?: number;
}

export interface ApiKeyAliasesResponse {
  items: ApiKeyAlias[];
}

export interface UsageImportResponse {
  format?: string;
  added: number;
  skipped: number;
  total: number;
  failed: number;
  unsupported?: number;
  warnings?: string[];
}

export interface UsageExportResponse {
  blob: Blob;
  filename: string;
}

const USAGE_SERVICE_TIMEOUT_MS = 15 * 1000;
const USAGE_SERVICE_TRANSFER_TIMEOUT_MS = 60 * 1000;
export const USAGE_SERVICE_ID = 'cpa-manager';
export const LEGACY_USAGE_SERVICE_ID = 'cpa-usage-service';
export const USAGE_SERVICE_LAST_CPA_BASE_KEY = 'cpa-manager:last-cpa-base';
export const LEGACY_USAGE_SERVICE_LAST_CPA_BASE_KEY = 'cpa-usage-service:last-cpa-base';

export const isUsageServiceId = (service?: string): boolean =>
  service === USAGE_SERVICE_ID || service === LEGACY_USAGE_SERVICE_ID;

export const normalizeUsageServiceBase = (input: string): string => normalizeApiBase(input);

const buildUrl = (base: string, path: string): string => {
  const normalized = normalizeUsageServiceBase(base).replace(/\/+$/, '');
  return `${normalized}${path}`;
};

const authHeaders = (managementKey?: string) =>
  managementKey ? { Authorization: `Bearer ${managementKey}` } : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object';

const readUsageServiceErrorCode = (value: unknown): string => {
  if (!isRecord(value) || typeof value.code !== 'string') return '';
  return USAGE_SERVICE_ERROR_CODES.has(value.code) ? value.code : '';
};

const fallbackUsageServiceCodeByStatus = (status?: number): string => {
  switch (status) {
    case 401:
      return 'invalid_management_key';
    case 405:
      return 'method_not_allowed';
    case 412:
      return 'usage_service_not_configured';
    default:
      return '';
  }
};

export const getUsageServiceErrorCode = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    return (
      readUsageServiceErrorCode(error.response?.data) ||
      fallbackUsageServiceCodeByStatus(error.response?.status)
    );
  }

  if (!isRecord(error)) return '';
  const code = typeof error.code === 'string' ? error.code : '';
  if (USAGE_SERVICE_ERROR_CODES.has(code)) return code;
  return readUsageServiceErrorCode(error.data) || readUsageServiceErrorCode(error.details);
};

const readUsageServiceErrorMessage = (value: unknown): string => {
  if (!isRecord(value)) return '';
  if (typeof value.error === 'string') return value.error;
  if (typeof value.message === 'string') return value.message;
  return '';
};

const toUsageServiceApiError = (error: unknown): UsageServiceApiError => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data;
    const message =
      readUsageServiceErrorMessage(data) || error.message || 'Usage Service request failed';
    const apiError = new Error(message) as UsageServiceApiError;
    apiError.name = 'UsageServiceApiError';
    apiError.status = error.response?.status;
    apiError.code = getUsageServiceErrorCode(error) || error.code;
    apiError.details = data;
    apiError.data = data;
    return apiError;
  }

  if (error instanceof Error) return error as UsageServiceApiError;
  const fallback = new Error(
    typeof error === 'string' ? error : 'Usage Service request failed'
  ) as UsageServiceApiError;
  fallback.name = 'UsageServiceApiError';
  return fallback;
};

const withUsageServiceError = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw toUsageServiceApiError(error);
  }
};

const readHeader = (headers: unknown, name: string): string => {
  if (!headers || typeof headers !== 'object') return '';
  const getter = (headers as { get?: (key: string) => unknown }).get;
  if (typeof getter === 'function') {
    const value = getter.call(headers, name);
    return value === undefined || value === null ? '' : String(value);
  }
  const target = name.toLowerCase();
  const entries = Object.entries(headers as Record<string, unknown>);
  const match = entries.find(([key]) => key.toLowerCase() === target);
  return match?.[1] === undefined || match?.[1] === null ? '' : String(match[1]);
};

const parseContentDispositionFilename = (value: string): string => {
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }
  const quotedMatch = value.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) return quotedMatch[1].trim();
  const plainMatch = value.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() || '';
};

const appendUsageQueryParams = (params: URLSearchParams, query?: UsageQuery) => {
  const startMs = query?.startMs;
  const endMs = query?.endMs;
  if (Number.isFinite(startMs)) {
    params.set('start_ms', String(Math.trunc(startMs as number)));
  }
  if (Number.isFinite(endMs)) {
    params.set('end_ms', String(Math.trunc(endMs as number)));
  }
  if (query?.account) params.set('account', query.account);
  if (query?.provider) params.set('provider', query.provider);
  if (query?.model) params.set('model', query.model);
  if (query?.channel) params.set('channel', query.channel);
  if (query?.apiKeyHash) params.set('api_key_hash', query.apiKeyHash);
  if (query?.status) params.set('status', query.status);
  if (query?.search) params.set('search', query.search);
  if (query?.searchApiKeyHash) params.set('search_api_key_hash', query.searchApiKeyHash);
};

const isMissingUsageSummaryEndpoint = (error: unknown) => {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === 404 || status === 405;
};

export const usageServiceApi = {
  getInfo: async (base: string): Promise<UsageServiceInfo> => {
    return withUsageServiceError(async () => {
      const response = await axios.get<UsageServiceInfo>(buildUrl(base, '/usage-service/info'), {
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      });
      return response.data;
    });
  },

  setup: async (base: string, payload: UsageServiceSetupRequest): Promise<void> => {
    await withUsageServiceError(async () => {
      await axios.post(buildUrl(base, '/setup'), payload, {
        timeout: USAGE_SERVICE_TIMEOUT_MS,
      });
    });
  },

  getManagerConfig: async (
    base: string,
    managementKey?: string
  ): Promise<ManagerConfigResponse> => {
    return withUsageServiceError(async () => {
      const response = await axios.get<ManagerConfigResponse>(
        buildUrl(base, '/usage-service/config'),
        {
          timeout: USAGE_SERVICE_TIMEOUT_MS,
          headers: authHeaders(managementKey),
        }
      );
      return response.data;
    });
  },

  saveManagerConfig: async (
    base: string,
    config: ManagerConfig,
    managementKey?: string
  ): Promise<ManagerConfigResponse> => {
    return withUsageServiceError(async () => {
      const response = await axios.put<ManagerConfigResponse>(
        buildUrl(base, '/usage-service/config'),
        { config },
        {
          timeout: USAGE_SERVICE_TIMEOUT_MS,
          headers: authHeaders(managementKey),
        }
      );
      return response.data;
    });
  },

  getStatus: async (base: string, managementKey?: string): Promise<UsageServiceStatus> => {
    return withUsageServiceError(async () => {
      const response = await axios.get<UsageServiceStatus>(buildUrl(base, '/status'), {
        timeout: USAGE_SERVICE_TIMEOUT_MS,
        headers: authHeaders(managementKey),
      });
      return response.data;
    });
  },

  getUsage: async (
    base: string,
    managementKey?: string,
    query?: UsageQuery
  ): Promise<UsagePayload> => {
    return withUsageServiceError(async () => {
      const headers = authHeaders(managementKey);
      const params = new URLSearchParams();
      appendUsageQueryParams(params, query);
      const summaryPath = `/v0/management/usage/summary${params.size > 0 ? `?${params}` : ''}`;
      try {
        const response = await axios.get<UsagePayload>(buildUrl(base, summaryPath), {
          timeout: USAGE_SERVICE_TIMEOUT_MS,
          headers,
        });
        return response.data;
      } catch (error) {
        if (!isMissingUsageSummaryEndpoint(error)) {
          throw error;
        }
      }
      const response = await axios.get<UsagePayload>(buildUrl(base, '/v0/management/usage'), {
        timeout: USAGE_SERVICE_TIMEOUT_MS,
        headers,
      });
      return response.data;
    });
  },

  getUsagePage: async (
    base: string,
    managementKey: string | undefined,
    kind: UsagePageKind,
    query: UsageQuery | undefined,
    pageQuery: UsagePageQuery
  ): Promise<UsagePageResponse> => {
    return withUsageServiceError(async () => {
      const params = new URLSearchParams();
      appendUsageQueryParams(params, query);
      params.set('page', String(Math.max(1, Math.trunc(pageQuery.page))));
      params.set('page_size', String(Math.max(1, Math.trunc(pageQuery.pageSize))));
      if (pageQuery.sortKey) params.set('sort_key', pageQuery.sortKey);
      if (pageQuery.sortDirection) params.set('sort_direction', pageQuery.sortDirection);
      const response = await axios.get<UsagePageResponse>(
        buildUrl(base, `/v0/management/usage/${kind}?${params}`),
        {
          timeout: USAGE_SERVICE_TIMEOUT_MS,
          headers: authHeaders(managementKey),
        }
      );
      return response.data;
    });
  },

  getModelPrices: async (base: string, managementKey?: string): Promise<ModelPricesResponse> => {
    return withUsageServiceError(async () => {
      const response = await axios.get<ModelPricesResponse>(
        buildUrl(base, '/v0/management/model-prices'),
        {
          timeout: USAGE_SERVICE_TIMEOUT_MS,
          headers: authHeaders(managementKey),
        }
      );
      return response.data;
    });
  },

  saveModelPrices: async (
    base: string,
    prices: Record<string, ModelPrice>,
    managementKey?: string
  ): Promise<ModelPricesResponse> => {
    return withUsageServiceError(async () => {
      const response = await axios.put<ModelPricesResponse>(
        buildUrl(base, '/v0/management/model-prices'),
        { prices },
        {
          timeout: USAGE_SERVICE_TIMEOUT_MS,
          headers: authHeaders(managementKey),
        }
      );
      return response.data;
    });
  },

  getApiKeyAliases: async (
    base: string,
    managementKey?: string
  ): Promise<ApiKeyAliasesResponse> => {
    return withUsageServiceError(async () => {
      const response = await axios.get<ApiKeyAliasesResponse>(
        buildUrl(base, '/v0/management/api-key-aliases'),
        {
          timeout: USAGE_SERVICE_TIMEOUT_MS,
          headers: authHeaders(managementKey),
        }
      );
      return response.data;
    });
  },

  saveApiKeyAliases: async (
    base: string,
    items: ApiKeyAlias[],
    managementKey?: string,
    activeApiKeyHashes?: string[]
  ): Promise<ApiKeyAliasesResponse> => {
    return withUsageServiceError(async () => {
      const body: { items: ApiKeyAlias[]; activeApiKeyHashes?: string[] } = { items };
      if (activeApiKeyHashes && activeApiKeyHashes.length > 0) {
        body.activeApiKeyHashes = activeApiKeyHashes;
      }
      const response = await axios.put<ApiKeyAliasesResponse>(
        buildUrl(base, '/v0/management/api-key-aliases'),
        body,
        {
          timeout: USAGE_SERVICE_TIMEOUT_MS,
          headers: authHeaders(managementKey),
        }
      );
      return response.data;
    });
  },

  deleteApiKeyAlias: async (
    base: string,
    apiKeyHash: string,
    managementKey?: string
  ): Promise<void> => {
    await withUsageServiceError(async () => {
      await axios.delete(
        buildUrl(base, `/v0/management/api-key-aliases/${encodeURIComponent(apiKeyHash)}`),
        {
          timeout: USAGE_SERVICE_TIMEOUT_MS,
          headers: authHeaders(managementKey),
        }
      );
    });
  },

  syncModelPrices: async (
    base: string,
    managementKey?: string,
    models?: string[]
  ): Promise<ModelPriceSyncResponse> => {
    return withUsageServiceError(async () => {
      const response = await axios.post<ModelPriceSyncResponse>(
        buildUrl(base, '/v0/management/model-prices/sync'),
        models ? { models } : {},
        {
          timeout: 30 * 1000,
          headers: authHeaders(managementKey),
        }
      );
      return response.data;
    });
  },

  exportUsage: async (base: string, managementKey?: string): Promise<UsageExportResponse> => {
    return withUsageServiceError(async () => {
      const response = await axios.get<Blob>(buildUrl(base, '/v0/management/usage/export'), {
        timeout: USAGE_SERVICE_TRANSFER_TIMEOUT_MS,
        headers: authHeaders(managementKey),
        responseType: 'blob',
      });
      const contentDisposition = readHeader(response.headers, 'content-disposition');
      return {
        blob: response.data,
        filename: parseContentDispositionFilename(contentDisposition) || 'usage-events.jsonl',
      };
    });
  },

  importUsage: async (
    base: string,
    payload: Blob | string,
    managementKey?: string
  ): Promise<UsageImportResponse> => {
    return withUsageServiceError(async () => {
      const response = await axios.post<UsageImportResponse>(
        buildUrl(base, '/v0/management/usage/import'),
        payload,
        {
          timeout: USAGE_SERVICE_TRANSFER_TIMEOUT_MS,
          headers: authHeaders(managementKey),
        }
      );
      return response.data;
    });
  },
};
