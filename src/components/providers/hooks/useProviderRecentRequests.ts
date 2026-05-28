import { useCallback, useEffect, useState } from 'react';
import { useInterval } from '@/hooks/useInterval';
import { apiKeyUsageApi } from '@/services/api';
import {
  normalizeRecentRequestUsageEntry,
  type ApiKeyUsageResponse,
  type RecentRequestUsageEntry,
} from '@/utils/recentRequests';

const PROVIDER_RECENT_REQUESTS_STALE_TIME_MS = 240_000;

export type ProviderRecentRequests = Map<string, Map<string, RecentRequestUsageEntry>>;

export type UseProviderRecentRequestsOptions = {
  enabled?: boolean;
};

const EMPTY_USAGE_BY_PROVIDER: ProviderRecentRequests = new Map();

let cachedUsageByProvider: ProviderRecentRequests = EMPTY_USAGE_BY_PROVIDER;
let cachedAt = 0;
let inFlightRequest: Promise<ProviderRecentRequests> | null = null;

const normalizeProviderKey = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const normalizeApiKeyUsageResponse = (payload: ApiKeyUsageResponse): ProviderRecentRequests => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return EMPTY_USAGE_BY_PROVIDER;
  }

  const usageByProvider: ProviderRecentRequests = new Map();

  Object.entries(payload).forEach(([provider, entries]) => {
    const providerKey = normalizeProviderKey(provider);
    if (!providerKey || !entries || typeof entries !== 'object' || Array.isArray(entries)) {
      return;
    }

    const usageByCompositeKey = new Map<string, RecentRequestUsageEntry>();
    Object.entries(entries).forEach(([compositeKey, entry]) => {
      usageByCompositeKey.set(compositeKey, normalizeRecentRequestUsageEntry(entry));
    });

    usageByProvider.set(providerKey, usageByCompositeKey);
  });

  return usageByProvider;
};

const fetchProviderRecentRequests = async (): Promise<ProviderRecentRequests> => {
  if (!inFlightRequest) {
    inFlightRequest = apiKeyUsageApi
      .getUsage()
      .then((payload) => {
        const normalized = normalizeApiKeyUsageResponse(payload);
        cachedUsageByProvider = normalized;
        cachedAt = Date.now();
        return normalized;
      })
      .finally(() => {
        inFlightRequest = null;
      });
  }

  return inFlightRequest;
};

export function useProviderRecentRequests(options: UseProviderRecentRequestsOptions = {}) {
  const enabled = options.enabled ?? true;
  const [usageByProvider, setUsageByProvider] = useState<ProviderRecentRequests>(
    cachedUsageByProvider
  );
  const [isLoading, setIsLoading] = useState(false);

  const loadRecentRequests = useCallback(
    async (loadOptions: { force?: boolean } = {}) => {
      if (!enabled) {
        return EMPTY_USAGE_BY_PROVIDER;
      }

      const hasFreshCache =
        cachedAt > 0 &&
        Date.now() - cachedAt < PROVIDER_RECENT_REQUESTS_STALE_TIME_MS;

      if (!loadOptions.force && hasFreshCache) {
        setUsageByProvider(cachedUsageByProvider);
        return cachedUsageByProvider;
      }

      setIsLoading(true);
      try {
        const nextUsage = await fetchProviderRecentRequests();
        setUsageByProvider(nextUsage);
        return nextUsage;
      } catch {
        if (cachedAt > 0) {
          setUsageByProvider(cachedUsageByProvider);
        }
        return cachedUsageByProvider;
      } finally {
        setIsLoading(false);
      }
    },
    [enabled]
  );

  const refreshRecentRequests = useCallback(
    async () => loadRecentRequests({ force: true }),
    [loadRecentRequests]
  );

  useEffect(() => {
    setUsageByProvider(enabled ? cachedUsageByProvider : EMPTY_USAGE_BY_PROVIDER);
  }, [enabled]);

  useInterval(() => {
    void refreshRecentRequests().catch(() => {});
  }, enabled ? PROVIDER_RECENT_REQUESTS_STALE_TIME_MS : null);

  return {
    usageByProvider: enabled ? usageByProvider : EMPTY_USAGE_BY_PROVIDER,
    isLoading: enabled ? isLoading : false,
    loadRecentRequests,
    refreshRecentRequests,
  };
}
