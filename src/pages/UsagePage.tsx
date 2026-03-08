import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Select } from '@/components/ui/Select';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useThemeStore, useConfigStore } from '@/stores';
import {
  StatCards,
  UsageChart,
  ChartLineSelector,
  ApiDetailsCard,
  ModelStatsCard,
  PriceSettingsCard,
  CredentialStatsCard,
  RequestEventsDetailsCard,
  TokenBreakdownChart,
  CostTrendChart,
  ServiceHealthCard,
  useUsageData,
  useSparklines,
  useChartData
} from '@/components/usage';
import {
  collectUsageDetails,
  filterUsageByDetail,
  filterUsageByTimeRange,
  getApiStats,
  getModelNamesFromUsage,
  getModelStats,
  type UsageTimeRange
} from '@/utils/usage';
import { buildSourceInfoMap, resolveProviderTypeFromUsageSource, resolveSourceInfo } from '@/utils/sourceResolver';
import styles from './UsagePage.module.scss';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const CHART_LINES_STORAGE_KEY = 'cli-proxy-usage-chart-lines-v1';
const TIME_RANGE_STORAGE_KEY = 'cli-proxy-usage-time-range-v1';
const ALL_FILTER_VALUE = 'all';
const DEFAULT_CHART_LINES = [ALL_FILTER_VALUE];
const DEFAULT_TIME_RANGE: UsageTimeRange = '24h';
const DEFAULT_PROVIDER_FILTER = ALL_FILTER_VALUE;
const DEFAULT_SUB_PROVIDER_FILTER = ALL_FILTER_VALUE;
const DEFAULT_MODEL_FILTER = ALL_FILTER_VALUE;
const MAX_CHART_LINES = 9;
const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: UsageTimeRange; labelKey: string }> = [
  { value: 'all', labelKey: 'usage_stats.range_all' },
  { value: '7h', labelKey: 'usage_stats.range_7h' },
  { value: '24h', labelKey: 'usage_stats.range_24h' },
  { value: '7d', labelKey: 'usage_stats.range_7d' },
];
const HOUR_WINDOW_BY_TIME_RANGE: Record<Exclude<UsageTimeRange, 'all'>, number> = {
  '7h': 7,
  '24h': 24,
  '7d': 7 * 24
};
const PROVIDER_LABEL_KEYS = {
  gemini: 'usage_stats.provider_option_gemini',
  claude: 'usage_stats.provider_option_claude',
  codex: 'usage_stats.provider_option_codex',
  vertex: 'usage_stats.provider_option_vertex',
  openai: 'usage_stats.provider_option_openai'
} as const;
const PROVIDER_TYPES: Array<keyof typeof PROVIDER_LABEL_KEYS> = [
  'gemini',
  'claude',
  'codex',
  'vertex',
  'openai'
];

type ProviderFilterValue = keyof typeof PROVIDER_LABEL_KEYS | typeof ALL_FILTER_VALUE;

const isUsageTimeRange = (value: unknown): value is UsageTimeRange =>
  value === '7h' || value === '24h' || value === '7d' || value === 'all';

const isProviderType = (value: string): value is keyof typeof PROVIDER_LABEL_KEYS =>
  value in PROVIDER_LABEL_KEYS;

const normalizeChartLines = (
  value: unknown,
  maxLines = MAX_CHART_LINES,
  allowedModelNames?: Iterable<string>
): string[] => {
  const allowed = allowedModelNames ? new Set(allowedModelNames) : null;
  if (!Array.isArray(value)) {
    return DEFAULT_CHART_LINES;
  }

  const filtered = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => {
      if (!item) {
        return false;
      }
      if (!allowed) {
        return true;
      }
      return item === ALL_FILTER_VALUE || allowed.has(item);
    })
    .slice(0, maxLines);

  return filtered.length ? filtered : DEFAULT_CHART_LINES;
};

const loadChartLines = (): string[] => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_CHART_LINES;
    }
    const raw = localStorage.getItem(CHART_LINES_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_CHART_LINES;
    }
    return normalizeChartLines(JSON.parse(raw));
  } catch {
    return DEFAULT_CHART_LINES;
  }
};

const loadTimeRange = (): UsageTimeRange => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_TIME_RANGE;
    }
    const raw = localStorage.getItem(TIME_RANGE_STORAGE_KEY);
    return isUsageTimeRange(raw) ? raw : DEFAULT_TIME_RANGE;
  } catch {
    return DEFAULT_TIME_RANGE;
  }
};

export function UsagePage() {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const isDark = resolvedTheme === 'dark';
  const config = useConfigStore((state) => state.config);

  const {
    usage,
    loading,
    error,
    lastRefreshedAt,
    modelPrices,
    setModelPrices,
    loadUsage,
    handleExport,
    handleImport,
    handleImportChange,
    importInputRef,
    exporting,
    importing
  } = useUsageData();

  useHeaderRefresh(loadUsage);

  const [chartLines, setChartLines] = useState<string[]>(loadChartLines);
  const [timeRange, setTimeRange] = useState<UsageTimeRange>(loadTimeRange);
  const [providerFilter, setProviderFilter] = useState<ProviderFilterValue>(DEFAULT_PROVIDER_FILTER);
  const [subProviderFilter, setSubProviderFilter] = useState<string>(DEFAULT_SUB_PROVIDER_FILTER);
  const [modelFilter, setModelFilter] = useState<string>(DEFAULT_MODEL_FILTER);

  const timeRangeOptions = useMemo(
    () =>
      TIME_RANGE_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey)
      })),
    [t]
  );

  const sourceInfoMap = useMemo(() => buildSourceInfoMap(config ?? {}), [config]);

  const timeRangedUsage = useMemo(
    () => (usage ? filterUsageByTimeRange(usage, timeRange) : null),
    [usage, timeRange]
  );
  const hourWindowHours =
    timeRange === 'all' ? undefined : HOUR_WINDOW_BY_TIME_RANGE[timeRange];

  const timeRangedDetails = useMemo(
    () => collectUsageDetails(timeRangedUsage),
    [timeRangedUsage]
  );

  const providerOptions = useMemo(() => {
    const availableProviders = new Set<keyof typeof PROVIDER_LABEL_KEYS>();

    timeRangedDetails.forEach((detail) => {
      const providerType = resolveProviderTypeFromUsageSource(detail.source, sourceInfoMap);
      if (providerType && isProviderType(providerType)) {
        availableProviders.add(providerType);
      }
    });

    return [
      { value: ALL_FILTER_VALUE, label: t('usage_stats.filter_all') },
      ...PROVIDER_TYPES.filter((providerType) => availableProviders.has(providerType)).map(
        (providerType) => ({
          value: providerType,
          label: t(PROVIDER_LABEL_KEYS[providerType])
        })
      )
    ];
  }, [sourceInfoMap, t, timeRangedDetails]);

  const effectiveProviderFilter =
    providerFilter !== ALL_FILTER_VALUE && providerOptions.some((option) => option.value === providerFilter)
      ? providerFilter
      : DEFAULT_PROVIDER_FILTER;

  const filterUsageByProvider = useCallback(
    (usageData: typeof timeRangedUsage, provider: ProviderFilterValue) => {
      if (!usageData || provider === ALL_FILTER_VALUE) {
        return usageData;
      }

      return filterUsageByDetail(
        usageData,
        (detail) => resolveProviderTypeFromUsageSource(detail.source, sourceInfoMap) === provider
      );
    },
    [sourceInfoMap]
  );

  const providerScopedUsage = useMemo(
    () => filterUsageByProvider(timeRangedUsage, effectiveProviderFilter),
    [effectiveProviderFilter, filterUsageByProvider, timeRangedUsage]
  );

  const subProviderOptions = useMemo(() => {
    const available = new Set<string>();
    timeRangedDetails.forEach((detail) => {
      const info = resolveSourceInfo(detail.source, sourceInfoMap);
      if (
        info &&
        (effectiveProviderFilter === ALL_FILTER_VALUE || info.type === effectiveProviderFilter)
      ) {
        available.add(info.displayName);
      }
    });
    return [
      { value: ALL_FILTER_VALUE, label: t('usage_stats.filter_all') },
      ...Array.from(available).map((name) => ({ value: name, label: name }))
    ];
  }, [effectiveProviderFilter, sourceInfoMap, t, timeRangedDetails]);

  const effectiveSubProviderFilter =
    subProviderFilter !== ALL_FILTER_VALUE &&
    subProviderOptions.some((o) => o.value === subProviderFilter)
      ? subProviderFilter
      : DEFAULT_SUB_PROVIDER_FILTER;

  const subProviderScopedUsage = useMemo(() => {
    if (!providerScopedUsage || effectiveSubProviderFilter === ALL_FILTER_VALUE) {
      return providerScopedUsage;
    }
    return filterUsageByDetail(providerScopedUsage, (detail) =>
      resolveSourceInfo(detail.source, sourceInfoMap)?.displayName === effectiveSubProviderFilter
    );
  }, [effectiveSubProviderFilter, providerScopedUsage, sourceInfoMap]);

  const modelOptions = useMemo(() => {
    const names = getModelNamesFromUsage(subProviderScopedUsage);
    return [
      { value: ALL_FILTER_VALUE, label: t('usage_stats.filter_all') },
      ...names.map((name) => ({ value: name, label: name }))
    ];
  }, [subProviderScopedUsage, t]);

  const effectiveModelFilter =
    modelFilter !== ALL_FILTER_VALUE && modelOptions.some((option) => option.value === modelFilter)
      ? modelFilter
      : DEFAULT_MODEL_FILTER;

  const filteredUsage = useMemo(() => {
    if (!subProviderScopedUsage || effectiveModelFilter === ALL_FILTER_VALUE) {
      return subProviderScopedUsage;
    }

    return filterUsageByDetail(subProviderScopedUsage, (detail) => detail.__modelName === effectiveModelFilter);
  }, [effectiveModelFilter, subProviderScopedUsage]);

  const rawModelNames = useMemo(() => getModelNamesFromUsage(usage), [usage]);
  const filteredModelNames = useMemo(() => getModelNamesFromUsage(filteredUsage), [filteredUsage]);
  const sanitizedChartLines = useMemo(
    () => normalizeChartLines(chartLines, MAX_CHART_LINES, filteredModelNames),
    [chartLines, filteredModelNames]
  );

  const handleProviderFilterChange = useCallback(
    (value: string) => {
      const nextProvider = value as ProviderFilterValue;
      setProviderFilter(nextProvider);
      setSubProviderFilter(DEFAULT_SUB_PROVIDER_FILTER);

      const providerScoped = filterUsageByProvider(timeRangedUsage, nextProvider);
      const nextModelNames = getModelNamesFromUsage(providerScoped);
      if (modelFilter !== ALL_FILTER_VALUE && !nextModelNames.includes(modelFilter)) {
        setModelFilter(DEFAULT_MODEL_FILTER);
      }
    },
    [filterUsageByProvider, modelFilter, timeRangedUsage]
  );

  const handleSubProviderFilterChange = useCallback(
    (value: string) => {
      setSubProviderFilter(value);
      if (modelFilter !== ALL_FILTER_VALUE) {
        const nextSubProviderScopedUsage =
          value === ALL_FILTER_VALUE
            ? providerScopedUsage
            : filterUsageByDetail(
                providerScopedUsage,
                (detail) => resolveSourceInfo(detail.source, sourceInfoMap)?.displayName === value
              );
        const nextModelNames = getModelNamesFromUsage(nextSubProviderScopedUsage);
        if (!nextModelNames.includes(modelFilter)) {
          setModelFilter(DEFAULT_MODEL_FILTER);
        }
      }
    },
    [modelFilter, providerScopedUsage, sourceInfoMap]
  );

  const handleModelFilterChange = useCallback((value: string) => {
    setModelFilter(value);
  }, []);

  const handleChartLinesChange = useCallback(
    (lines: string[]) => {
      setChartLines(normalizeChartLines(lines, MAX_CHART_LINES, filteredModelNames));
    },
    [filteredModelNames]
  );

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(CHART_LINES_STORAGE_KEY, JSON.stringify(sanitizedChartLines));
    } catch {
      // Ignore storage errors.
    }
  }, [sanitizedChartLines]);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(TIME_RANGE_STORAGE_KEY, timeRange);
    } catch {
      // Ignore storage errors.
    }
  }, [timeRange]);

  const nowMs = lastRefreshedAt?.getTime() ?? 0;

  const {
    requestsSparkline,
    tokensSparkline,
    rpmSparkline,
    tpmSparkline,
    costSparkline
  } = useSparklines({ usage: filteredUsage, loading, nowMs });

  const {
    requestsPeriod,
    setRequestsPeriod,
    tokensPeriod,
    setTokensPeriod,
    requestsChartData,
    tokensChartData,
    requestsChartOptions,
    tokensChartOptions
  } = useChartData({ usage: filteredUsage, chartLines: sanitizedChartLines, isDark, isMobile, hourWindowHours });

  const apiStats = useMemo(
    () => getApiStats(filteredUsage, modelPrices),
    [filteredUsage, modelPrices]
  );
  const modelStats = useMemo(
    () => getModelStats(filteredUsage, modelPrices),
    [filteredUsage, modelPrices]
  );
  const hasPrices = Object.keys(modelPrices).length > 0;

  return (
    <div className={styles.container}>
      {loading && !usage && (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingOverlayContent}>
            <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
            <span className={styles.loadingOverlayText}>{t('common.loading')}</span>
          </div>
        </div>
      )}

      <div className={styles.header}>
        <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
        <div className={styles.headerActions}>
          <div className={styles.headerFilters}>
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>{t('usage_stats.range_filter')}</span>
              <Select
                value={timeRange}
                options={timeRangeOptions}
                onChange={(value) => setTimeRange(value as UsageTimeRange)}
                className={styles.filterSelectControl}
                ariaLabel={t('usage_stats.range_filter')}
                fullWidth={false}
              />
            </div>
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>{t('usage_stats.provider_filter')}</span>
              <Select
                value={effectiveProviderFilter}
                options={providerOptions}
                onChange={handleProviderFilterChange}
                className={styles.filterSelectControl}
                ariaLabel={t('usage_stats.provider_filter')}
                fullWidth={false}
              />
            </div>
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>{t('usage_stats.sub_provider_filter')}</span>
              <Select
                value={effectiveSubProviderFilter}
                options={subProviderOptions}
                onChange={handleSubProviderFilterChange}
                className={styles.filterSelectControl}
                ariaLabel={t('usage_stats.sub_provider_filter')}
                fullWidth={false}
              />
            </div>
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>{t('usage_stats.model_filter')}</span>
              <Select
                value={effectiveModelFilter}
                options={modelOptions}
                onChange={handleModelFilterChange}
                className={styles.filterSelectControl}
                ariaLabel={t('usage_stats.model_filter')}
                fullWidth={false}
              />
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            loading={exporting}
            disabled={loading || importing}
          >
            {t('usage_stats.export')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleImport}
            loading={importing}
            disabled={loading || exporting}
          >
            {t('usage_stats.import')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadUsage().catch(() => {})}
            disabled={loading || exporting || importing}
          >
            {loading ? t('common.loading') : t('usage_stats.refresh')}
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={handleImportChange}
          />
          {lastRefreshedAt && (
            <span className={styles.lastRefreshed}>
              {t('usage_stats.last_updated')}: {lastRefreshedAt.toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <StatCards
        usage={filteredUsage}
        loading={loading}
        modelPrices={modelPrices}
        nowMs={nowMs}
        sparklines={{
          requests: requestsSparkline,
          tokens: tokensSparkline,
          rpm: rpmSparkline,
          tpm: tpmSparkline,
          cost: costSparkline
        }}
      />

      <ChartLineSelector
        chartLines={sanitizedChartLines}
        modelNames={filteredModelNames}
        maxLines={MAX_CHART_LINES}
        onChange={handleChartLinesChange}
      />

      <ServiceHealthCard usage={filteredUsage} loading={loading} />

      <div className={styles.chartsGrid}>
        <UsageChart
          title={t('usage_stats.requests_trend')}
          period={requestsPeriod}
          onPeriodChange={setRequestsPeriod}
          chartData={requestsChartData}
          chartOptions={requestsChartOptions}
          loading={loading}
          isMobile={isMobile}
          emptyText={t('usage_stats.no_data')}
        />
        <UsageChart
          title={t('usage_stats.tokens_trend')}
          period={tokensPeriod}
          onPeriodChange={setTokensPeriod}
          chartData={tokensChartData}
          chartOptions={tokensChartOptions}
          loading={loading}
          isMobile={isMobile}
          emptyText={t('usage_stats.no_data')}
        />
      </div>

      <TokenBreakdownChart
        usage={filteredUsage}
        loading={loading}
        isDark={isDark}
        isMobile={isMobile}
        hourWindowHours={hourWindowHours}
      />

      <CostTrendChart
        usage={filteredUsage}
        loading={loading}
        isDark={isDark}
        isMobile={isMobile}
        modelPrices={modelPrices}
        hourWindowHours={hourWindowHours}
      />

      <div className={styles.detailsGrid}>
        <ApiDetailsCard apiStats={apiStats} loading={loading} hasPrices={hasPrices} />
        <ModelStatsCard modelStats={modelStats} loading={loading} hasPrices={hasPrices} />
      </div>

      <RequestEventsDetailsCard
        usage={filteredUsage}
        loading={loading}
        geminiKeys={config?.geminiApiKeys || []}
        claudeConfigs={config?.claudeApiKeys || []}
        codexConfigs={config?.codexApiKeys || []}
        vertexConfigs={config?.vertexApiKeys || []}
        openaiProviders={config?.openaiCompatibility || []}
      />

      <CredentialStatsCard
        usage={filteredUsage}
        loading={loading}
        geminiKeys={config?.geminiApiKeys || []}
        claudeConfigs={config?.claudeApiKeys || []}
        codexConfigs={config?.codexApiKeys || []}
        vertexConfigs={config?.vertexApiKeys || []}
        openaiProviders={config?.openaiCompatibility || []}
      />

      <PriceSettingsCard
        modelNames={rawModelNames}
        modelPrices={modelPrices}
        onPricesChange={setModelPrices}
      />
    </div>
  );
}
