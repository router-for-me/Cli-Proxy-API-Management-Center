import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  BarController,
  LineController,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useThemeStore } from '@/stores';
import { usageApi, providersApi, authFilesApi } from '@/services/api';
import { useSqliteUsage } from '@/hooks/useSqliteUsage';
import { sqliteRecordsToUsageData, bucketUsageRecords } from '@/utils/sqliteAdapter';
import { SQLITE_USAGE_REFRESH_MS, SQLITE_USAGE_DEFAULT_SINCE } from '@/utils/constants';
import { filterDataByApiFilter, filterDataByTimeRange, type DateRange } from '@/utils/monitor';
import { TimeRangeSelector, type TimeRange } from '@/components/monitor/TimeRangeSelector';
import { buildSourceInfoMap } from '@/utils/sourceResolver';
import { normalizeAuthIndex, loadModelPrices, type ModelPrice } from '@/utils/usage';
import { collectUsageDetails } from '@/utils/usage';
import type { CredentialInfo } from '@/types/sourceInfo';
import { KpiCards } from '@/components/monitor/KpiCards';
import { ModelDistributionChart } from '@/components/monitor/ModelDistributionChart';
import { DailyTrendChart } from '@/components/monitor/DailyTrendChart';
import { HourlyModelChart } from '@/components/monitor/HourlyModelChart';
import { HourlyTokenChart } from '@/components/monitor/HourlyTokenChart';
import { ChannelStats } from '@/components/monitor/ChannelStats';
import { FailureAnalysis } from '@/components/monitor/FailureAnalysis';
import { RequestLogs } from '@/components/monitor/RequestLogs';
import { ApiKeyModelHeatmap } from '@/components/monitor/ApiKeyModelHeatmap';
import { getErrorMessage } from '@/utils/error';
import styles from './MonitorPage.module.scss';

// 注册 Chart.js 组件
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  BarController,
  LineController,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);


export interface UsageDetail {
  timestamp: string;
  failed: boolean;
  source: string;
  auth_index: string;
  latency_ms?: number | string | null;
  suspiciousToken?: boolean;
  tokens: {
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    cached_tokens: number;
    total_tokens: number;
  };
}

export interface UsageData {
  apis: Record<string, {
    models: Record<string, {
      details: UsageDetail[];
    }>;
  }>;
}

export function MonitorPage() {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = resolvedTheme === 'dark';

  // SQLite 持久化数据（主数据源）
  const {
    records: sqliteRecords,
    sqliteEnabled,
    loading: sqliteLoading,
    error: sqliteError,
    refresh: refreshSqlite,
  } = useSqliteUsage({ refreshInterval: SQLITE_USAGE_REFRESH_MS, since: SQLITE_USAGE_DEFAULT_SINCE });

  // 状态
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>(7);
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [apiFilter, setApiFilter] = useState('');
  const [_heatmapFilter, setHeatmapFilter] = useState<{ source: string; model: string } | null>(null);
  const [providerMap, setProviderMap] = useState<Record<string, string>>({});
  const [providerModels, setProviderModels] = useState<Record<string, Set<string>>>({});
  const [providerTypeMap, setProviderTypeMap] = useState<Record<string, string>>({});
  const [sourceInfoMap, setSourceInfoMap] = useState<Map<string, import('@/types/sourceInfo').SourceInfo>>(new Map());
  const [authFileMap, setAuthFileMap] = useState<Map<string, CredentialInfo>>(new Map());
  const [modelPrices, setModelPrices] = useState<Record<string, ModelPrice>>({});
  const [providerLoadFailed, setProviderLoadFailed] = useState(false);

  // 加载模型价格（从 localStorage）
  useEffect(() => {
    setModelPrices(loadModelPrices());
  }, []);

  // 加载渠道名称映射（支持所有提供商类型）
  const loadProviderMap = useCallback(async () => {
    try {
      const map: Record<string, string> = {};
      const modelsMap: Record<string, Set<string>> = {};
      const typeMap: Record<string, string> = {};

      // 并行加载所有提供商配置和认证文件
      const [openaiProviders, geminiKeys, claudeConfigs, codexConfigs, vertexConfigs, authFilesResponse] = await Promise.all([
        providersApi.getOpenAIProviders().catch(() => []),
        providersApi.getGeminiKeys().catch(() => []),
        providersApi.getClaudeConfigs().catch(() => []),
        providersApi.getCodexConfigs().catch(() => []),
        providersApi.getVertexConfigs().catch(() => []),
        authFilesApi.list().catch(() => ({ files: [] })),
      ]);

      // 处理 OpenAI 兼容提供商
      openaiProviders.forEach((provider) => {
        const providerName = provider.headers?.['X-Provider'] || provider.name || 'unknown';
        const modelSet = new Set<string>();
        (provider.models || []).forEach((m) => {
          if (m.alias) modelSet.add(m.alias);
          if (m.name) modelSet.add(m.name);
        });
        const apiKeyEntries = provider.apiKeyEntries || [];
        apiKeyEntries.forEach((entry) => {
          const apiKey = entry.apiKey;
          if (apiKey) {
            map[apiKey] = providerName;
            modelsMap[apiKey] = modelSet;
            typeMap[apiKey] = 'OpenAI';
          }
        });
        if (provider.name) {
          map[provider.name] = providerName;
          modelsMap[provider.name] = modelSet;
          typeMap[provider.name] = 'OpenAI';
        }
      });

      // 处理 Gemini 提供商
      geminiKeys.forEach((config) => {
        const apiKey = config.apiKey;
        if (apiKey) {
          const providerName = config.prefix?.trim() || 'Gemini';
          map[apiKey] = providerName;
          typeMap[apiKey] = 'Gemini';
        }
      });

      // 处理 Claude 提供商
      claudeConfigs.forEach((config) => {
        const apiKey = config.apiKey;
        if (apiKey) {
          const providerName = config.prefix?.trim() || 'Claude';
          map[apiKey] = providerName;
          typeMap[apiKey] = 'Claude';
          // 存储模型集合
          if (config.models && config.models.length > 0) {
            const modelSet = new Set<string>();
            config.models.forEach((m) => {
              if (m.alias) modelSet.add(m.alias);
              if (m.name) modelSet.add(m.name);
            });
            modelsMap[apiKey] = modelSet;
          }
        }
      });

      // 处理 Codex 提供商
      codexConfigs.forEach((config) => {
        const apiKey = config.apiKey;
        if (apiKey) {
          const providerName = config.prefix?.trim() || 'Codex';
          map[apiKey] = providerName;
          typeMap[apiKey] = 'Codex';
          if (config.models && config.models.length > 0) {
            const modelSet = new Set<string>();
            config.models.forEach((m) => {
              if (m.alias) modelSet.add(m.alias);
              if (m.name) modelSet.add(m.name);
            });
            modelsMap[apiKey] = modelSet;
          }
        }
      });

      // 处理 Vertex 提供商
      vertexConfigs.forEach((config) => {
        const apiKey = config.apiKey;
        if (apiKey) {
          const providerName = config.prefix?.trim() || 'Vertex';
          map[apiKey] = providerName;
          typeMap[apiKey] = 'Vertex';
          if (config.models && config.models.length > 0) {
            const modelSet = new Set<string>();
            config.models.forEach((m) => {
              if (m.alias) modelSet.add(m.alias);
              if (m.name) modelSet.add(m.name);
            });
            modelsMap[apiKey] = modelSet;
          }
        }
      });

      setProviderMap(map);
      setProviderModels(modelsMap);
      setProviderTypeMap(typeMap);

      // 构建 sourceInfoMap（与请求事件明细相同的解析逻辑）
      setSourceInfoMap(buildSourceInfoMap({
        geminiApiKeys: geminiKeys,
        claudeApiKeys: claudeConfigs,
        codexApiKeys: codexConfigs,
        vertexApiKeys: vertexConfigs,
        openaiCompatibility: openaiProviders,
      }));

      // 构建 authFileMap（认证文件索引 → 凭证信息）
      const credMap = new Map<string, CredentialInfo>();
      const files = (authFilesResponse as { files?: unknown[] })?.files || [];
      files.forEach((file) => {
        if (!file || typeof file !== 'object') return;
        const f = file as Record<string, unknown>;
        const credKey = normalizeAuthIndex(f['auth_index'] ?? f['authIndex']);
        if (credKey) {
          credMap.set(credKey, {
            name: String(f.name || credKey),
            type: String(f.type || f.provider || ''),
          });
        }
      });
      setAuthFileMap(credMap);
      setProviderLoadFailed(false);
    } catch (err) {
      console.warn('Monitor: Failed to load provider map:', err);
      setProviderLoadFailed(true);
    }
  }, []);

  // 加载数据：SQLite 优先，fallback 到旧 API
  const loadData = useCallback(async () => {
    setError(null);
    // 渠道映射并行加载，但不阻塞主数据展示
    loadProviderMap();

    // SQLite 已启用 → 使用持久化数据
    if (sqliteEnabled && sqliteRecords.length > 0) {
      setUsageData(sqliteRecordsToUsageData(sqliteRecords));
      setLoading(false);
      return;
    }

    // SQLite 启用但尚无数据 → 等待 SQLite 加载
    if (sqliteEnabled && sqliteLoading) {
      return;
    }

    // Fallback: 旧版内存队列 API
    setLoading(true);
    try {
      const response = await usageApi.getUsage();
      const data = response?.usage ?? response;
      setUsageData(data as UsageData);
    } catch (err) {
      const message = getErrorMessage(err) || t('common.unknown_error');
      console.error('Monitor: Error loading data:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [t, loadProviderMap, sqliteEnabled, sqliteRecords, sqliteLoading]);

  // SQLite 数据变化时自动更新 usageData
  useEffect(() => {
    if (sqliteEnabled && sqliteRecords.length > 0) {
      setUsageData(sqliteRecordsToUsageData(sqliteRecords));
      setLoading(false);
    }
  }, [sqliteEnabled, sqliteRecords]);

  // 初始加载：SQLite 优先
  useEffect(() => {
    if (!sqliteLoading) {
      loadData();
    }
  }, [sqliteLoading, loadData]);

  // 响应头部刷新：SQLite 模式用 refreshSqlite，旧模式用 loadData
  useHeaderRefresh(() => {
    if (sqliteEnabled) {
      refreshSqlite();
    } else {
      loadData();
    }
  });

  // 根据时间范围过滤数据
  const apiFilteredData = useMemo(() => {
    return filterDataByApiFilter(usageData, apiFilter);
  }, [usageData, apiFilter]);

  const filteredData = useMemo(() => {
    return filterDataByTimeRange(apiFilteredData, timeRange, customRange);
  }, [apiFilteredData, timeRange, customRange]);

  // Usage 明细（用于热力图等组件）
  const usageDetails = useMemo(() => collectUsageDetails(filteredData), [filteredData]);

  const usageBuckets = useMemo(() => {
    if (sqliteEnabled && sqliteRecords.length > 0) {
      return bucketUsageRecords(sqliteRecords, 10, 20);
    }
    return [];
  }, [sqliteEnabled, sqliteRecords]);

  // 处理时间范围变化
  const handleTimeRangeChange = (range: TimeRange, cr?: DateRange) => {
    setTimeRange(range);
    if (cr) setCustomRange(cr);
  };

  // 处理 API 过滤应用（触发数据刷新）
  const handleApiFilterApply = () => {
    if (sqliteEnabled) {
      refreshSqlite();
    } else {
      loadData();
    }
  };

  // 合并错误（SQLite 或旧 API）
  const displayError = sqliteError || error;

  // 合并加载状态
  const isLoading = sqliteEnabled ? (sqliteLoading && sqliteRecords.length === 0) : loading;
  // 静默刷新：已有数据但在后台更新
  const isSilentRefreshing = sqliteEnabled ? (sqliteLoading && sqliteRecords.length > 0) : (loading && !!usageData);

  return (
    <div className={styles.container}>
      {isLoading && !usageData && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingOverlayContent}>
            <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
            <span className={styles.loadingOverlayText}>{t('common.loading')}</span>
          </div>
        </div>
      )}

      {/* 页面标题 */}
      <div className={styles.header}>
        <h1 className={styles.pageTitle}>{t('monitor.title')}</h1>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { if (sqliteEnabled) { refreshSqlite(); } else { loadData(); } }}
            disabled={isLoading}
          >
            {isSilentRefreshing ? (
              <span className={styles.refreshHint}>{t('common.refreshing')}</span>
            ) : isLoading ? t('common.loading') : t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* 错误提示 */}
      {displayError && <div className={styles.errorBox}>{displayError}</div>}

      {/* 提供商加载失败警告（有数据时显示，提示渠道名称可能缺失） */}
      {providerLoadFailed && (usageData || sqliteRecords.length > 0) && (
        <div className={styles.warningBox}>{t('monitor.provider_load_warning')}</div>
      )}

      {/* 空状态：区分"无数据"vs"加载失败" */}
      {!isLoading && !usageData && sqliteRecords.length === 0 && (
        <div className={styles.emptyState}>
          {providerLoadFailed
            ? t('monitor.provider_load_failed')
            : t('monitor.no_data')}
        </div>
      )}

      {/* 时间范围和 API 过滤 */}
      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>{t('monitor.time_range')}</span>
          <TimeRangeSelector value={timeRange} onChange={handleTimeRangeChange} customRange={customRange} />
        </div>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>{t('monitor.api_filter')}</span>
          <input
            type="text"
            className={styles.filterInput}
            placeholder={t('monitor.api_filter_placeholder')}
            value={apiFilter}
            onChange={(e) => setApiFilter(e.target.value)}
          />
          <Button variant="secondary" size="sm" onClick={handleApiFilterApply}>
            {t('monitor.apply')}
          </Button>
        </div>
      </div>

      {/* KPI 卡片 */}
      <KpiCards data={filteredData} loading={isLoading} timeRange={timeRange} buckets={usageBuckets} modelPrices={modelPrices} />

      {/* 图表区域 */}
      <div className={styles.chartsGrid}>
        <ModelDistributionChart data={filteredData} loading={isLoading} isDark={isDark} timeRange={timeRange} />
        <DailyTrendChart data={filteredData} loading={isLoading} isDark={isDark} timeRange={timeRange} />
      </div>

      {/* 小时级图表 */}
      <HourlyModelChart data={apiFilteredData} loading={isLoading} isDark={isDark} />
      <HourlyTokenChart data={apiFilteredData} loading={isLoading} isDark={isDark} />

      {/* 统计表格 */}
      <div className={styles.statsGrid}>
        <ChannelStats data={filteredData} loading={isLoading} providerMap={providerMap} providerModels={providerModels} sourceInfoMap={sourceInfoMap} authFileMap={authFileMap} />
        <FailureAnalysis data={filteredData} loading={isLoading} providerMap={providerMap} providerModels={providerModels} sourceInfoMap={sourceInfoMap} authFileMap={authFileMap} />
      </div>

      {/* API Key × Model 热力图 */}
      <Card title={t('monitor.heatmap.title')} subtitle={t('monitor.heatmap.subtitle')}>
        <ApiKeyModelHeatmap
          details={usageDetails}
          providerMap={providerMap}
          sourceInfoMap={sourceInfoMap}
          authFileMap={authFileMap}
          metric="tokens"
          maxRows={20}
          maxCols={15}
          loading={isLoading}
          onCellClick={(source, model) => setHeatmapFilter({ source, model })}
        />
      </Card>

      {/* 请求日志 */}
      <RequestLogs
        data={filteredData}
        loading={isLoading}
        providerMap={providerMap}
        providerTypeMap={providerTypeMap}
        sourceInfoMap={sourceInfoMap}
        authFileMap={authFileMap}
        apiFilter={apiFilter}
      />
    </div>
  );
}
