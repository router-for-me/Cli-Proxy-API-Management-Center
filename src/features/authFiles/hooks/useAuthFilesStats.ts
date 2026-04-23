import { useCallback, useEffect, useMemo, useState } from 'react';
import { USAGE_STATS_STALE_TIME_MS, useUsageStatsStore } from '@/stores';
import {
  computeKeyUsageStatsFromDetails,
  loadModelPrices,
  type KeyStats,
  type KeyUsageStats,
  type ModelPrice,
  type UsageDetail,
} from '@/utils/usage';

export type UseAuthFilesStatsResult = {
  keyStats: KeyStats;
  keyUsageStats: KeyUsageStats;
  usageDetails: UsageDetail[];
  loadKeyStats: () => Promise<void>;
  refreshKeyStats: () => Promise<void>;
};

const createEmptyKeyUsageStats = (): KeyUsageStats => ({ bySource: {}, byAuthIndex: {} });

export function useAuthFilesStats(): UseAuthFilesStatsResult {
  const keyStats = useUsageStatsStore((state) => state.keyStats);
  const usageDetails = useUsageStatsStore((state) => state.usageDetails);
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);
  const [modelPrices, setModelPrices] = useState<Record<string, ModelPrice>>(() => loadModelPrices());

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const syncModelPrices = () => {
      setModelPrices(loadModelPrices());
    };

    window.addEventListener('storage', syncModelPrices);
    return () => {
      window.removeEventListener('storage', syncModelPrices);
    };
  }, []);

  const keyUsageStats = useMemo(() => {
    if (!usageDetails.length) {
      return createEmptyKeyUsageStats();
    }
    return computeKeyUsageStatsFromDetails(usageDetails, modelPrices);
  }, [modelPrices, usageDetails]);

  const loadKeyStats = useCallback(async () => {
    await loadUsageStats({ staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, [loadUsageStats]);

  const refreshKeyStats = useCallback(async () => {
    await loadUsageStats({ force: true, staleTimeMs: USAGE_STATS_STALE_TIME_MS });
  }, [loadUsageStats]);

  return { keyStats, keyUsageStats, usageDetails, loadKeyStats, refreshKeyStats };
}
