import { useDeferredValue, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Chart as ChartJS,
  CategoryScale,
  Decimation,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useConfigStore, useThemeStore } from '@/stores';
import {
  ApiDetailsCard,
  UsageAnalysisSection,
  ChartLineSelector,
  CredentialStatsCard,
  ModelStatsCard,
  PriceSettingsCard,
  StatCards,
  UsagePageHero,
  UsageSectionIntro,
  UsageChart,
  useChartData,
  useSparklines,
  useUsageData,
  useUsageViewState,
} from '@/components/usage';
import {
  filterUsageByTimeRange,
  getApiStats,
  getModelNamesFromUsage,
  getModelStats,
} from '@/utils/usage';
import styles from './UsagePage.module.scss';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  Decimation
);

export function UsagePage() {
  const { t } = useTranslation();
  const [trendsCollapsed, setTrendsCollapsed] = useState(true);
  const [analysisCollapsed, setAnalysisCollapsed] = useState(true);
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isDark = useThemeStore((state) => state.resolvedTheme === 'dark');
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
    importing,
  } = useUsageData();

  const {
    chartLines,
    deferredChartLines,
    deferredTimeRange,
    handleChartLinesChange,
    handleTimeRangeChange,
    hourWindowHours,
    preferredChartPeriod,
    selectedRangeLabel,
    timeRange,
    timeRangeOptions,
  } = useUsageViewState();

  useHeaderRefresh(loadUsage);

  const filteredUsage = useMemo(
    () => (usage ? filterUsageByTimeRange(usage, deferredTimeRange) : null),
    [deferredTimeRange, usage]
  );
  const deferredFilteredUsage = useDeferredValue(filteredUsage);

  const nowMs = lastRefreshedAt?.getTime() ?? 0;
  const allModelNames = useMemo(() => getModelNamesFromUsage(usage), [usage]);
  const visibleModelNames = useMemo(
    () => getModelNamesFromUsage(deferredFilteredUsage ?? usage),
    [deferredFilteredUsage, usage]
  );

  const { requestsSparkline, tokensSparkline, rpmSparkline, tpmSparkline, costSparkline } =
    useSparklines({ usage: deferredFilteredUsage, loading, nowMs });

  const {
    requestsPeriod,
    requestsChartData,
    requestsChartOptions,
    setRequestsPeriod,
    setTokensPeriod,
    tokensChartData,
    tokensChartOptions,
    tokensPeriod,
  } = useChartData({
    usage: deferredFilteredUsage,
    chartLines: deferredChartLines,
    isDark,
    isMobile,
    hourWindowHours,
    preferredPeriod: preferredChartPeriod,
    allModelsLabel: t('usage_stats.chart_line_all'),
  });

  const apiStats = useMemo(
    () => getApiStats(deferredFilteredUsage, modelPrices),
    [deferredFilteredUsage, modelPrices]
  );
  const modelStats = useMemo(
    () => getModelStats(deferredFilteredUsage, modelPrices),
    [deferredFilteredUsage, modelPrices]
  );

  const hasPrices = Object.keys(modelPrices).length > 0;
  const showComparePanel = visibleModelNames.length > 1;

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

      <UsagePageHero
        timeRange={timeRange}
        timeRangeOptions={timeRangeOptions}
        selectedRangeLabel={selectedRangeLabel}
        visibleModelCount={visibleModelNames.length}
        selectedSeriesCount={chartLines.length}
        lastRefreshedAt={lastRefreshedAt}
        loading={loading}
        exporting={exporting}
        importing={importing}
        onTimeRangeChange={handleTimeRangeChange}
        onExport={handleExport}
        onImport={handleImport}
        onRefresh={() => void loadUsage().catch(() => {})}
        importInputRef={importInputRef}
        onImportChange={handleImportChange}
      />

      {error && <div className={styles.errorBox}>{error}</div>}

      <section className={styles.section}>
        <UsageSectionIntro
          title={t('usage_stats.overview_title')}
          description={t('usage_stats.overview_desc')}
        />
        <StatCards
          usage={deferredFilteredUsage}
          loading={loading}
          modelPrices={modelPrices}
          nowMs={nowMs}
          sparklines={{
            requests: requestsSparkline,
            tokens: tokensSparkline,
            rpm: rpmSparkline,
            tpm: tpmSparkline,
            cost: costSparkline,
          }}
        />
      </section>

      <section className={styles.section}>
        <UsageSectionIntro
          title={t('usage_stats.trends_title')}
          description={t('usage_stats.trends_desc')}
          action={
            <button
              type="button"
              className={styles.sectionToggle}
              aria-expanded={!trendsCollapsed}
              onClick={() => setTrendsCollapsed((current) => !current)}
            >
              <span className={styles.sectionToggleIcon} aria-hidden="true">
                {trendsCollapsed ? '+' : '-'}
              </span>
              <span>{t(trendsCollapsed ? 'common.expand' : 'common.collapse')}</span>
            </button>
          }
        />
        {!trendsCollapsed && (
          <div className={styles.trendGrid}>
            {showComparePanel && (
              <div className={styles.trendSidebar}>
                <ChartLineSelector
                  chartLines={chartLines}
                  modelNames={visibleModelNames}
                  onChange={handleChartLinesChange}
                />
              </div>
            )}

            <div
              className={[styles.trendCharts, !showComparePanel ? styles.trendChartsFull : '']
                .filter(Boolean)
                .join(' ')}
            >
              <UsageChart
                title={t('usage_stats.requests_trend')}
                period={requestsPeriod}
                onPeriodChange={setRequestsPeriod}
                chartData={requestsChartData}
                chartOptions={requestsChartOptions}
                loading={loading}
                isMobile={isMobile}
                emptyText={t('usage_stats.no_data')}
                tone="neutral"
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
                tone="violet"
              />
            </div>
          </div>
        )}
      </section>

      <UsageAnalysisSection
        usage={deferredFilteredUsage}
        loading={loading}
        isDark={isDark}
        isMobile={isMobile}
        hourWindowHours={hourWindowHours}
        modelPrices={modelPrices}
        collapsed={analysisCollapsed}
        onToggleCollapse={() => setAnalysisCollapsed((current) => !current)}
      />

      <section className={styles.section}>
        <UsageSectionIntro
          title={t('usage_stats.details_title')}
          description={t('usage_stats.details_desc')}
        />
        <div className={styles.detailsGrid}>
          <ApiDetailsCard apiStats={apiStats} loading={loading} hasPrices={hasPrices} />
          <ModelStatsCard modelStats={modelStats} loading={loading} hasPrices={hasPrices} />
        </div>
      </section>

      <div className={styles.supportStack}>
        <CredentialStatsCard
          usage={deferredFilteredUsage}
          loading={loading}
          geminiKeys={config?.geminiApiKeys || []}
          claudeConfigs={config?.claudeApiKeys || []}
          codexConfigs={config?.codexApiKeys || []}
          vertexConfigs={config?.vertexApiKeys || []}
          openaiProviders={config?.openaiCompatibility || []}
        />

        <PriceSettingsCard
          modelNames={allModelNames}
          modelPrices={modelPrices}
          onPricesChange={setModelPrices}
        />
      </div>
    </div>
  );
}
