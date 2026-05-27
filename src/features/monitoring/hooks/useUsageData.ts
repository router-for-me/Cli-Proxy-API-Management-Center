import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isUsageServiceId,
  normalizeUsageServiceBase,
  usageServiceApi,
  type ApiKeyAlias,
  type ApiKeyAliasesResponse,
  type ModelPricesResponse,
  type ModelPriceSyncResponse,
  type UsagePageQuery,
  type UsagePageResponse,
  type UsageQuery,
  type UsageExportResponse,
  type UsageImportResponse,
} from '@/services/api/usageService';
import { useAuthStore, useUsageServiceStore } from '@/stores';
import { detectApiBaseFromLocation } from '@/utils/connection';
import {
  clearModelPrices,
  loadModelPrices as loadStoredModelPrices,
  saveModelPrices,
  type ModelPrice,
} from '@/utils/usage';

export interface UsagePayload {
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  total_tokens?: number;
  apis?: Record<string, unknown>;
  [key: string]: unknown;
}

export type UsagePageQueries = {
  accounts?: UsagePageQuery;
  apiKeys?: UsagePageQuery;
  realtime?: UsagePageQuery;
  models?: UsagePageQuery;
};

export type UsagePages = {
  accounts?: UsagePageResponse;
  apiKeys?: UsagePageResponse;
  realtime?: UsagePageResponse;
  models?: UsagePageResponse;
};

export interface UseUsageDataReturn {
  usage: UsagePayload | null;
  usagePages: UsagePages | null;
  loading: boolean;
  error: string;
  lastRefreshedAt: Date | null;
  modelPrices: Record<string, ModelPrice>;
  apiKeyAliases: ApiKeyAlias[];
  usageServiceAvailable: boolean;
  setModelPrices: (prices: Record<string, ModelPrice>) => Promise<void>;
  loadModelPrices: () => Promise<void>;
  loadApiKeyAliases: () => Promise<void>;
  syncModelPrices: (models?: string[]) => Promise<ModelPriceSyncResponse>;
  exportUsage: () => Promise<UsageExportResponse>;
  importUsage: (file: File) => Promise<UsageImportResponse>;
  loadUsage: (queryOverride?: UsageQuery) => Promise<void>;
}

const isUsagePageFallbackError = (error: unknown) => {
  if (!(error instanceof Error)) return false;
  const status = (error as { status?: number }).status;
  const code = (error as { code?: string }).code;
  return status === 404 || status === 405 || code === 'method_not_allowed';
};

const readUsageNumber = (value: unknown) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const mergeTokenTotals = (target: Record<string, unknown>, source: Record<string, unknown>) => {
  const tokenKeys = [
    'input_tokens',
    'output_tokens',
    'reasoning_tokens',
    'cached_tokens',
    'cache_tokens',
    'total_tokens',
  ];
  tokenKeys.forEach((key) => {
    target[key] = readUsageNumber(target[key]) + readUsageNumber(source[key]);
  });
};

export const mergeUsagePayloads = (payloads: UsagePayload[]): UsagePayload => {
  const merged: UsagePayload = { apis: {}, tokens: {} };
  payloads.forEach((payload) => {
    merged.total_requests =
      readUsageNumber(merged.total_requests) + readUsageNumber(payload.total_requests);
    merged.success_count =
      readUsageNumber(merged.success_count) + readUsageNumber(payload.success_count);
    merged.failure_count =
      readUsageNumber(merged.failure_count) + readUsageNumber(payload.failure_count);
    merged.total_tokens =
      readUsageNumber(merged.total_tokens) + readUsageNumber(payload.total_tokens);
    merged.latency_sum_ms =
      readUsageNumber(merged.latency_sum_ms) + readUsageNumber(payload.latency_sum_ms);
    merged.latency_count =
      readUsageNumber(merged.latency_count) + readUsageNumber(payload.latency_count);
    const latencyCount = readUsageNumber(merged.latency_count);
    if (latencyCount > 0) {
      merged.latency_ms = readUsageNumber(merged.latency_sum_ms) / latencyCount;
    }
    if (payload.tokens && typeof payload.tokens === 'object' && !Array.isArray(payload.tokens)) {
      mergeTokenTotals(
        merged.tokens as Record<string, unknown>,
        payload.tokens as Record<string, unknown>
      );
    }
    if (payload.apis && typeof payload.apis === 'object') {
      Object.entries(payload.apis).forEach(([endpoint, api]) => {
        if (!api || typeof api !== 'object' || Array.isArray(api)) return;
        const sourceModels = (api as { models?: unknown }).models;
        if (!sourceModels || typeof sourceModels !== 'object' || Array.isArray(sourceModels))
          return;
        const mergedApis = merged.apis as Record<string, { models: Record<string, unknown> }>;
        const target = mergedApis[endpoint] ?? { models: {} };
        Object.entries(sourceModels).forEach(([model, aggregate]) => {
          if (!aggregate || typeof aggregate !== 'object' || Array.isArray(aggregate)) return;
          const existing = (target.models[model] as { details?: unknown[] } | undefined) ?? {
            details: [],
          };
          const sourceDetails = (aggregate as { details?: unknown }).details;
          existing.details = [
            ...(Array.isArray(existing.details) ? existing.details : []),
            ...(Array.isArray(sourceDetails) ? sourceDetails : []),
          ];
          target.models[model] = existing;
        });
        mergedApis[endpoint] = target;
      });
    }
  });
  return merged;
};

export function useUsageData(
  usageQuery?: UsageQuery,
  usagePageQueries?: UsagePageQueries
): UseUsageDataReturn {
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const usageServiceEnabled = useUsageServiceStore((state) => state.enabled);
  const usageServiceBase = useUsageServiceStore((state) => state.serviceBase);
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [usagePages, setUsagePages] = useState<UsagePages | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [modelPrices, setModelPricesState] = useState<Record<string, ModelPrice>>({});
  const [apiKeyAliases, setApiKeyAliases] = useState<ApiKeyAlias[]>([]);
  const [usageServiceAvailable, setUsageServiceAvailable] = useState(false);
  const requestIdRef = useRef(0);
  const aliasRequestIdRef = useRef(0);

  const resolveUsageServiceBase = useCallback(async (): Promise<string> => {
    if (usageServiceEnabled && usageServiceBase) {
      return usageServiceBase;
    }

    const candidates = Array.from(
      new Set(
        [apiBase, detectApiBaseFromLocation()]
          .map((value) => normalizeUsageServiceBase(value || ''))
          .filter(Boolean)
      )
    );

    for (const candidate of candidates) {
      try {
        const info = await usageServiceApi.getInfo(candidate);
        if (isUsageServiceId(info.service)) {
          return candidate;
        }
      } catch {
        // The regular CPA management API does not expose Usage Service metadata.
      }
    }

    return '';
  }, [apiBase, usageServiceBase, usageServiceEnabled]);

  const getModelPricesFromApi = useCallback(async (): Promise<ModelPricesResponse> => {
    const serviceBase = await resolveUsageServiceBase();
    if (!serviceBase) {
      return { prices: {} };
    }
    return usageServiceApi.getModelPrices(serviceBase, managementKey);
  }, [managementKey, resolveUsageServiceBase]);

  const getApiKeyAliasesFromApi = useCallback(async (): Promise<ApiKeyAliasesResponse> => {
    const serviceBase = await resolveUsageServiceBase();
    if (!serviceBase) {
      return { items: [] };
    }
    return usageServiceApi.getApiKeyAliases(serviceBase, managementKey);
  }, [managementKey, resolveUsageServiceBase]);

  const saveModelPricesToApi = useCallback(
    async (prices: Record<string, ModelPrice>): Promise<ModelPricesResponse> => {
      const serviceBase = await resolveUsageServiceBase();
      if (!serviceBase) {
        throw new Error('model_price_api_unavailable');
      }
      return usageServiceApi.saveModelPrices(serviceBase, prices, managementKey);
    },
    [managementKey, resolveUsageServiceBase]
  );

  const syncModelPricesFromApi = useCallback(
    async (models?: string[]): Promise<ModelPriceSyncResponse> => {
      const serviceBase = await resolveUsageServiceBase();
      if (!serviceBase) {
        throw new Error('model_price_sync_requires_usage_service');
      }
      return usageServiceApi.syncModelPrices(serviceBase, managementKey, models);
    },
    [managementKey, resolveUsageServiceBase]
  );

  const exportUsageFromApi = useCallback(async (): Promise<UsageExportResponse> => {
    const serviceBase = await resolveUsageServiceBase();
    if (!serviceBase) {
      throw new Error('usage_import_export_requires_usage_service');
    }
    return usageServiceApi.exportUsage(serviceBase, managementKey);
  }, [managementKey, resolveUsageServiceBase]);

  const importUsageToApi = useCallback(
    async (file: File): Promise<UsageImportResponse> => {
      const serviceBase = await resolveUsageServiceBase();
      if (!serviceBase) {
        throw new Error('usage_import_export_requires_usage_service');
      }
      return usageServiceApi.importUsage(serviceBase, file, managementKey);
    },
    [managementKey, resolveUsageServiceBase]
  );

  const loadModelPrices = useCallback(async () => {
    const fallbackPrices = loadStoredModelPrices();
    try {
      const response = await getModelPricesFromApi();
      const apiPrices = response.prices ?? {};
      if (Object.keys(apiPrices).length > 0) {
        setModelPricesState(apiPrices);
        clearModelPrices();
        return;
      }
      if (Object.keys(fallbackPrices).length > 0) {
        const migrated = await saveModelPricesToApi(fallbackPrices);
        setModelPricesState(migrated.prices ?? fallbackPrices);
        clearModelPrices();
        return;
      }
      setModelPricesState({});
    } catch {
      setModelPricesState(fallbackPrices);
    }
  }, [getModelPricesFromApi, saveModelPricesToApi]);

  const loadUsagePages = useCallback(
    async (serviceBase: string, queryOverride?: UsageQuery): Promise<UsagePages | null> => {
      if (!usagePageQueries) return null;
      const activeUsageQuery = queryOverride ?? usageQuery;
      try {
        const loadModelPages = async () => {
          if (!usagePageQueries.models) return undefined;
          const firstQuery = { ...usagePageQueries.models, page: 1 };
          const first = await usageServiceApi.getUsagePage(
            serviceBase,
            managementKey,
            'models',
            activeUsageQuery,
            firstQuery
          );
          const totalItems = Math.max(0, Math.trunc(Number(first.total_items) || 0));
          const pageSize = Math.max(1, Math.trunc(Number(first.page_size) || 1));
          const pageCount = Math.ceil(totalItems / pageSize);
          if (pageCount <= 1) return first;

          const rest = await Promise.all(
            Array.from({ length: pageCount - 1 }, (_, index) =>
              usageServiceApi.getUsagePage(serviceBase, managementKey, 'models', activeUsageQuery, {
                ...usagePageQueries.models,
                page: index + 2,
                pageSize,
              })
            )
          );
          return {
            ...first,
            page: 1,
            usage: mergeUsagePayloads([first, ...rest].map((page) => page.usage)),
          };
        };

        const [accounts, apiKeys, realtime, models] = await Promise.all([
          usagePageQueries.accounts
            ? usageServiceApi.getUsagePage(
                serviceBase,
                managementKey,
                'accounts',
                activeUsageQuery,
                usagePageQueries.accounts
              )
            : Promise.resolve(undefined),
          usagePageQueries.apiKeys
            ? usageServiceApi.getUsagePage(
                serviceBase,
                managementKey,
                'api-keys',
                activeUsageQuery,
                usagePageQueries.apiKeys
              )
            : Promise.resolve(undefined),
          usagePageQueries.realtime
            ? usageServiceApi.getUsagePage(
                serviceBase,
                managementKey,
                'realtime',
                activeUsageQuery,
                usagePageQueries.realtime
              )
            : Promise.resolve(undefined),
          loadModelPages(),
        ]);
        return { accounts, apiKeys, realtime, models };
      } catch (error) {
        if (isUsagePageFallbackError(error)) {
          return null;
        }
        throw error;
      }
    },
    [
      managementKey,
      usagePageQueries,
      usageQuery,
    ]
  );

  const loadApiKeyAliases = useCallback(async () => {
    const requestId = aliasRequestIdRef.current + 1;
    aliasRequestIdRef.current = requestId;
    try {
      const response = await getApiKeyAliasesFromApi();
      if (aliasRequestIdRef.current !== requestId) return;
      setApiKeyAliases(Array.isArray(response.items) ? response.items : []);
    } catch {
      if (aliasRequestIdRef.current !== requestId) return;
      setApiKeyAliases([]);
    }
  }, [getApiKeyAliasesFromApi]);

  const loadUsage = useCallback(
    async (queryOverride?: UsageQuery) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      setError('');

      try {
        const serviceBase = await resolveUsageServiceBase();
        if (!serviceBase) {
          setUsageServiceAvailable(false);
          setUsage(null);
          setUsagePages(null);
          setLastRefreshedAt(null);
          return;
        }
        setUsageServiceAvailable(true);
        const activeUsageQuery = queryOverride ?? usageQuery;
        const [payload, pages] = await Promise.all([
          usageServiceApi.getUsage(serviceBase, managementKey, activeUsageQuery),
          loadUsagePages(serviceBase, activeUsageQuery),
        ]);
        if (requestIdRef.current !== requestId) return;
        setUsage(payload ?? null);
        setUsagePages(pages);
        setLastRefreshedAt(new Date());
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [
      loadUsagePages,
      managementKey,
      resolveUsageServiceBase,
      usageQuery,
    ]
  );

  useEffect(() => {
    void loadModelPrices();
    void loadApiKeyAliases();
    void loadUsage();
  }, [loadApiKeyAliases, loadModelPrices, loadUsage]);

  const setModelPrices = useCallback(
    async (prices: Record<string, ModelPrice>) => {
      setModelPricesState(prices);
      try {
        const response = await saveModelPricesToApi(prices);
        setModelPricesState(response.prices ?? prices);
        clearModelPrices();
      } catch {
        saveModelPrices(prices);
      }
    },
    [saveModelPricesToApi]
  );

  const syncModelPrices = useCallback(
    async (models?: string[]) => {
      const response = await syncModelPricesFromApi(models);
      setModelPricesState(response.prices ?? {});
      clearModelPrices();
      return response;
    },
    [syncModelPricesFromApi]
  );

  return {
    usage,
    usagePages,
    loading,
    error,
    lastRefreshedAt,
    modelPrices,
    apiKeyAliases,
    usageServiceAvailable,
    setModelPrices,
    loadModelPrices,
    loadApiKeyAliases,
    syncModelPrices,
    exportUsage: exportUsageFromApi,
    importUsage: importUsageToApi,
    loadUsage,
  };
}
