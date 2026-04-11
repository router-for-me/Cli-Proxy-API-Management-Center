import { useCallback } from 'react';
import { useInterval } from '@/hooks/useInterval';
import { USAGE_STATS_STALE_TIME_MS, useUsageStatsStore } from '@/stores';
import type { KeyStats, UsageDetail } from '@/utils/usage';

const EMPTY_KEY_STATS: KeyStats = { bySource: {}, byAuthIndex: {} };
const EMPTY_USAGE_DETAILS: UsageDetail[] = [];

export type UseProviderStatsOptions = {
  enabled?: boolean;
};

export const useProviderStats = (options: UseProviderStatsOptions = {}) => {
  const enabled = options.enabled ?? true;
  const keyStats = useUsageStatsStore((state) => (enabled ? state.keyStats : EMPTY_KEY_STATS));
  const usageDetails = useUsageStatsStore((state) =>
    enabled ? state.usageDetails : EMPTY_USAGE_DETAILS
  );
  const isLoading = useUsageStatsStore((state) => (enabled ? state.loading : false));
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);

  // 首次进入页面优先复用缓存，避免跨页面重复拉取 /usage。
  const loadKeyStats = useCallback(async () => {
    await loadUsageStats({ staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, [loadUsageStats]);

  // 定时器触发时强制刷新共享 usage。
  const refreshKeyStats = useCallback(async () => {
    await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, [loadUsageStats]);

  useInterval(() => {
    void refreshKeyStats().catch(() => {});
  }, enabled ? 240_000 : null);

  return { keyStats, usageDetails, loadKeyStats, refreshKeyStats, isLoading };
};
