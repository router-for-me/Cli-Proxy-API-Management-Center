/**
 * Dashboard data (fork): credentials (traffic, status, quota headers), inline
 * API-key usage, the routing strategy and the latest recorded quota samples.
 * Credentials refresh every 30 seconds while the page is open.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useProviderRecentRequests } from '@/components/providers/hooks/useProviderRecentRequests';
import { useInterval } from '@/hooks/useInterval';
import { useNow } from '@/hooks/useNow';
import { authFilesApi } from '@/services/api';
import { quotaHistoryApi, type QuotaHistory } from '@/services/api/quotaHistory';
import { useAuthStore, useConfigStore } from '@/stores';
import type { AuthFileItem } from '@/types/authFile';
import { HOUR_MS } from '@/utils/time/durations';
import { parseTimestampMs } from '@/utils/timestamp';
import { buildTraffic, credentialProvider, type TrafficSource } from './model';

const CREDENTIALS_REFRESH_MS = 30_000;
const HISTORY_REFRESH_MS = 5 * 60_000;
/** Enough history to hold each window's newest sample (the collector polls every 10 minutes). */
const HISTORY_LOOKBACK_MS = 2 * HOUR_MS;

type Credentials = { files: AuthFileItem[]; serverNowMs: number };

/** `api-key-usage` keys look like `<baseUrl>|<apiKey>`. */
const apiKeyOf = (compositeKey: string): string => {
  const separator = compositeKey.indexOf('|');
  return separator < 0 ? '' : compositeKey.slice(separator + 1).trim();
};

export function useProxDashboard() {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const connected = connectionStatus === 'connected';
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const { usageByProvider, refreshRecentRequests } = useProviderRecentRequests({
    enabled: connected,
  });
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [history, setHistory] = useState<QuotaHistory | null>(null);
  const now = useNow();

  const loadCredentials = useCallback(async () => {
    if (!connected) return;
    try {
      const response = await authFilesApi.list();
      const observed = parseTimestampMs(response.observedAt);
      setCredentials({
        files: response.files,
        serverNowMs: Number.isFinite(observed) ? observed : Date.now(),
      });
    } catch {
      // Keep the last good snapshot; the next tick retries.
    }
  }, [connected]);

  const loadHistory = useCallback(async () => {
    if (!connected) return;
    try {
      const now = Date.now();
      setHistory(await quotaHistoryApi.get(now - HISTORY_LOOKBACK_MS, now));
    } catch {
      // Official backends have no history endpoint; quota headers still fill the rows.
      setHistory(null);
    }
  }, [connected]);

  useEffect(() => {
    if (!connected) return;
    void fetchConfig().catch(() => undefined);
    void loadCredentials();
    void loadHistory();
  }, [connected, fetchConfig, loadCredentials, loadHistory]);

  useInterval(() => void loadCredentials(), connected ? CREDENTIALS_REFRESH_MS : null);
  useInterval(() => void loadHistory(), connected ? HISTORY_REFRESH_MS : null);

  const refresh = useCallback(async () => {
    if (!connected) return;
    await Promise.allSettled([
      fetchConfig(true),
      loadCredentials(),
      loadHistory(),
      refreshRecentRequests(),
    ]);
  }, [connected, fetchConfig, loadCredentials, loadHistory, refreshRecentRequests]);

  const traffic = useMemo(() => {
    const sources: TrafficSource[] = [];
    const usageKeys = new Set<string>();
    usageByProvider.forEach((entries, provider) => {
      entries.forEach((entry, compositeKey) => {
        const apiKey = apiKeyOf(compositeKey);
        if (apiKey) usageKeys.add(apiKey);
        sources.push({ provider, buckets: entry.recentRequests });
      });
    });
    (credentials?.files ?? []).forEach((file) => {
      // API-key credentials already counted through api-key-usage.
      const accountType = String(file['account_type'] ?? '')
        .trim()
        .toLowerCase();
      const account = String(file['account'] ?? '').trim();
      if (accountType === 'api_key' && account && usageKeys.has(account)) return;
      sources.push({
        provider: credentialProvider(file),
        buckets: file.recentRequests ?? [],
      });
    });
    return buildTraffic(sources, credentials?.serverNowMs ?? now);
  }, [usageByProvider, credentials, now]);

  return {
    connectionStatus,
    connected,
    routingStrategy: config?.routingStrategy ?? '',
    files: credentials?.files ?? null,
    history,
    traffic,
    refresh,
  };
}
