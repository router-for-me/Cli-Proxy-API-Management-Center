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
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useThemeStore } from '@/stores';
import { usageApi, providersApi } from '@/services/api';
import { KpiCards } from '@/components/monitor/KpiCards';
import { ModelDistributionChart } from '@/components/monitor/ModelDistributionChart';
import { DailyTrendChart } from '@/components/monitor/DailyTrendChart';
import { HourlyModelChart } from '@/components/monitor/HourlyModelChart';
import { HourlyTokenChart } from '@/components/monitor/HourlyTokenChart';
import { ChannelStats } from '@/components/monitor/ChannelStats';
import { FailureAnalysis } from '@/components/monitor/FailureAnalysis';
import { RequestLogs } from '@/components/monitor/RequestLogs';
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

// 时间范围选项
type TimeRange = 1 | 7 | 14 | 30;

export interface UsageDetail {
  timestamp: string;
  failed: boolean;
  source: string;
  auth_index: string;
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

  // 状态
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usageData, setUsageData] = useState<UsageData | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>(7);
  const [apiFilter, setApiFilter] = useState('');
  const [providerMap, setProviderMap] = useState<Record<string, string>>({});
  const [providerModels, setProviderModels] = useState<Record<string, Set<string>>>({});
  const [providerTypeMap, setProviderTypeMap] = useState<Record<string, string>>({});

  // 加载渠道名称映射（支持所有提供商类型）
  const loadProviderMap = useCallback(async () => {
    try {
      const map: Record<string, string> = {};
      const modelsMap: Record<string, Set<string>> = {};
      const typeMap: Record<string, string> = {};

      // 并行加载所有提供商配置
      const [openaiProviders, geminiKeys, claudeConfigs, codexConfigs, vertexConfigs] = await Promise.all([
        providersApi.getOpenAIProviders().catch(() => []),
        providersApi.getGeminiKeys().catch(() => []),
        providersApi.getClaudeConfigs().catch(() => []),
        providersApi.getCodexConfigs().catch(() => []),
        providersApi.getVertexConfigs().catch(() => []),
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
    } catch (err) {
      console.warn('Monitor: Failed to load provider map:', err);
    }
  }, []);

  // 加载数据
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 并行加载使用数据和渠道映射
      const [response] = await Promise.all([
        usageApi.getUsage(),
        loadProviderMap()
      ]);
      // API 返回的数据可能在 response.usage 或直接在 response 中
      const data = response?.usage ?? response;
      setUsageData(data as UsageData);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      console.error('Monitor: Error loading data:', err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [t, loadProviderMap]);

  // 初始加载
  useEffect(() => {
    loadData();
  }, [loadData]);

  // 响应头部刷新
  useHeaderRefresh(loadData);

  // 根据时间范围过滤数据
  const filteredData = useMemo(() => {
    if (!usageData?.apis) {
      return null;
    }

    const now = new Date();
    const cutoffTime = new Date(now.getTime() - timeRange * 24 * 60 * 60 * 1000);

    const filtered: UsageData = { apis: {} };

    Object.entries(usageData.apis).forEach(([apiKey, apiData]) => {
      // 如果有 API 过滤器，检查是否匹配
      if (apiFilter && !apiKey.toLowerCase().includes(apiFilter.toLowerCase())) {
        return;
      }

      // 检查 apiData 是否有 models 属性
      if (!apiData?.models) {
        return;
      }

      const filteredModels: Record<string, { details: UsageDetail[] }> = {};

      Object.entries(apiData.models).forEach(([modelName, modelData]) => {
        // 检查 modelData 是否有 details 属性
        if (!modelData?.details || !Array.isArray(modelData.details)) {
          return;
        }

        const filteredDetails = modelData.details.filter((detail) => {
          const timestamp = new Date(detail.timestamp);
          return timestamp >= cutoffTime;
        });

        if (filteredDetails.length > 0) {
          filteredModels[modelName] = { details: filteredDetails };
        }
      });

      if (Object.keys(filteredModels).length > 0) {
        filtered.apis[apiKey] = { models: filteredModels };
      }
    });

    return filtered;
  }, [usageData, timeRange, apiFilter]);

  // 处理时间范围变化
  const handleTimeRangeChange = (range: TimeRange) => {
    setTimeRange(range);
  };

  // 处理 API 过滤应用（触发数据刷新）
  const handleApiFilterApply = () => {
    loadData();
  };

  return (
    <div className={styles.container}>
      {loading && !usageData && (
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
            onClick={loadData}
            disabled={loading}
          >
            {loading ? t('common.loading') : t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && <div className={styles.errorBox}>{error}</div>}

      {/* 时间范围和 API 过滤 */}
      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>{t('monitor.time_range')}</span>
          <div className={styles.timeButtons}>
            {([1, 7, 14, 30] as TimeRange[]).map((range) => (
              <button
                key={range}
                className={`${styles.timeButton} ${timeRange === range ? styles.active : ''}`}
                onClick={() => handleTimeRangeChange(range)}
              >
                {range === 1 ? t('monitor.today') : t('monitor.last_n_days', { n: range })}
              </button>
            ))}
          </div>
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
      <KpiCards data={filteredData} loading={loading} timeRange={timeRange} />

      {/* 图表区域 */}
      <div className={styles.chartsGrid}>
        <ModelDistributionChart data={filteredData} loading={loading} isDark={isDark} timeRange={timeRange} />
        <DailyTrendChart data={filteredData} loading={loading} isDark={isDark} timeRange={timeRange} />
      </div>

      {/* 小时级图表 */}
      <HourlyModelChart data={filteredData} loading={loading} isDark={isDark} />
      <HourlyTokenChart data={filteredData} loading={loading} isDark={isDark} />

      {/* 统计表格 */}
      <div className={styles.statsGrid}>
        <ChannelStats data={filteredData} loading={loading} providerMap={providerMap} providerModels={providerModels} />
        <FailureAnalysis data={filteredData} loading={loading} providerMap={providerMap} providerModels={providerModels} />
      </div>

      {/* 请求日志 */}
      <RequestLogs
        data={filteredData}
        loading={loading}
        providerMap={providerMap}
        providerTypeMap={providerTypeMap}
        apiFilter={apiFilter}
      />
    </div>
  );
}
