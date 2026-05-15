/**
 * SQLite 持久化使用量 Hook
 * 轮询 CLIProxyAPI 后端 /v0/management/usage-sqlite/* 端点
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getErrorMessage } from '@/utils/error';
import { usageSqliteApi, type UsageStats, type UsageRecord, type ModelStat, type DailyStat } from '@/services/api/usageSqlite';
import { SQLITE_USAGE_DEFAULT_LIMIT, SQLITE_USAGE_DEFAULT_SINCE } from '@/utils/constants';

interface UseSqliteUsageOptions {
  /** 自动刷新间隔（毫秒），0 表示不自动刷新 */
  refreshInterval?: number;
  /** 查询时间范围，Go duration 格式，如 "24h", "7d" */
  since?: string;
}

interface UseSqliteUsageReturn {
  /** 聚合统计 */
  stats: UsageStats | null;
  /** 使用记录 */
  records: UsageRecord[];
  /** 按模型统计 */
  modelStats: ModelStat[];
  /** 按日统计 */
  dailyStats: DailyStat[];
  /** SQLite 是否启用 */
  sqliteEnabled: boolean;
  /** 是否加载中 */
  loading: boolean;
  /** 错误信息 */
  error: string | null;
  /** 手动刷新 */
  refresh: () => void;
  /** 加载更多记录 */
  loadMoreRecords: (limit?: number, offset?: number) => Promise<void>;
  /** 记录总数 */
  totalRecords: number;
}

export function useSqliteUsage(options: UseSqliteUsageOptions = {}): UseSqliteUsageReturn {
  const { refreshInterval = 0, since = SQLITE_USAGE_DEFAULT_SINCE } = options;
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [modelStats, setModelStats] = useState<ModelStat[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [sqliteEnabled, setSqliteEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalRecords, setTotalRecords] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [enabledRes, statsRes, modelRes, dailyRes, recordsRes] = await Promise.all([
        usageSqliteApi.getEnabled().catch(() => ({ enabled: false })),
        usageSqliteApi.getStats(since).catch(() => null),
        usageSqliteApi.getModelStats(since).catch(() => []),
        usageSqliteApi.getDailyStats(since).catch(() => []),
        usageSqliteApi.getRecords({ since, limit: SQLITE_USAGE_DEFAULT_LIMIT }).catch(() => ({ records: [], total: 0, limit: SQLITE_USAGE_DEFAULT_LIMIT, offset: 0 })),
      ]);

      setSqliteEnabled(enabledRes.enabled);
      if (statsRes) setStats(statsRes);
      if (modelRes) setModelStats(modelRes);
      if (dailyRes) setDailyStats(dailyRes);
      if (recordsRes) {
        setRecords(recordsRes.records);
        setTotalRecords(recordsRes.total);
      }
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err) || 'Failed to fetch SQLite usage data');
    } finally {
      setLoading(false);
    }
  }, [since]);

  const loadMoreRecords = useCallback(async (limit = SQLITE_USAGE_DEFAULT_LIMIT, offset?: number) => {
    try {
      const o = offset ?? records.length;
      const res = await usageSqliteApi.getRecords({ since, limit, offset: o });
      setRecords(prev => [...prev, ...res.records]);
      setTotalRecords(res.total);
    } catch (err) {
      setError(getErrorMessage(err) || 'Failed to load more records');
    }
  }, [since, records.length]);

  useEffect(() => {
    fetchAll();
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(fetchAll, refreshInterval);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAll, refreshInterval]);

  return {
    stats,
    records,
    modelStats,
    dailyStats,
    sqliteEnabled,
    loading,
    error,
    refresh: fetchAll,
    loadMoreRecords,
    totalRecords,
  };
}
