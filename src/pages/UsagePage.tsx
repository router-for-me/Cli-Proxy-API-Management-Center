import { useEffect, useState, useCallback, useMemo, type CSSProperties } from 'react';
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
  Filler,
  type ChartOptions
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconDiamond, IconDollarSign, IconSatellite, IconTimer, IconTrendingUp } from '@/components/ui/icons';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useThemeStore } from '@/stores';
import { usageApi } from '@/services/api/usage';
import {
  formatTokensInMillions,
  formatPerMinuteValue,
  formatUsd,
  calculateTokenBreakdown,
  calculateRecentPerMinuteRates,
  calculateTotalCost,
  getModelNamesFromUsage,
  getApiStats,
  getModelStats,
  loadModelPrices,
  saveModelPrices,
  buildChartData,
  collectUsageDetails,
  extractTotalTokens,
  type ModelPrice
} from '@/utils/usage';
import styles from './UsagePage.module.scss';

// Register Chart.js components
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

interface UsagePayload {
  total_requests?: number;
  success_count?: number;
  failure_count?: number;
  total_tokens?: number;
  apis?: Record<string, unknown>;
  [key: string]: unknown;
}

export function UsagePage() {
  const { t } = useTranslation();
  const isMobile = useMediaQuery('(max-width: 768px)');
  const theme = useThemeStore((state) => state.theme);
  const isDark = theme === 'dark';

  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modelPrices, setModelPrices] = useState<Record<string, ModelPrice>>({});

  // Model price form state
  const [selectedModel, setSelectedModel] = useState('');
  const [promptPrice, setPromptPrice] = useState('');
  const [completionPrice, setCompletionPrice] = useState('');
  const [cachePrice, setCachePrice] = useState('');

  // Expanded sections
  const [expandedApis, setExpandedApis] = useState<Set<string>>(new Set());

  // Chart state
  const [requestsPeriod, setRequestsPeriod] = useState<'hour' | 'day'>('day');
  const [tokensPeriod, setTokensPeriod] = useState<'hour' | 'day'>('day');
  const [chartLines, setChartLines] = useState<string[]>(['all']);
  const MAX_CHART_LINES = 9;

  const loadUsage = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await usageApi.getUsage();
      const payload = data?.usage ?? data;
      setUsage(payload);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('usage_stats.loading_error');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadUsage();
    setModelPrices(loadModelPrices());
  }, [loadUsage]);

  // Calculate derived data
  const tokenBreakdown = usage ? calculateTokenBreakdown(usage) : { cachedTokens: 0, reasoningTokens: 0 };
  const rateStats = usage
    ? calculateRecentPerMinuteRates(30, usage)
    : { rpm: 0, tpm: 0, windowMinutes: 30, requestCount: 0, tokenCount: 0 };
  const totalCost = usage ? calculateTotalCost(usage, modelPrices) : 0;
  const modelNames = usage ? getModelNamesFromUsage(usage) : [];
  const apiStats = usage ? getApiStats(usage, modelPrices) : [];
  const modelStats = usage ? getModelStats(usage, modelPrices) : [];
  const hasPrices = Object.keys(modelPrices).length > 0;

  // Build chart data
  const requestsChartData = useMemo(() => {
    if (!usage) return { labels: [], datasets: [] };
    return buildChartData(usage, requestsPeriod, 'requests', chartLines);
  }, [usage, requestsPeriod, chartLines]);

  const tokensChartData = useMemo(() => {
    if (!usage) return { labels: [], datasets: [] };
    return buildChartData(usage, tokensPeriod, 'tokens', chartLines);
  }, [usage, tokensPeriod, chartLines]);

  const sparklineOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } },
      elements: { line: { tension: 0.45 }, point: { radius: 0 } }
    }),
    []
  );

  const buildLastHourSeries = useCallback(
    (metric: 'requests' | 'tokens'): { labels: string[]; data: number[] } => {
      if (!usage) return { labels: [], data: [] };
      const details = collectUsageDetails(usage);
      if (!details.length) return { labels: [], data: [] };

      const windowMinutes = 60;
      const now = Date.now();
      const windowStart = now - windowMinutes * 60 * 1000;
      const buckets = new Array(windowMinutes).fill(0);

      details.forEach(detail => {
        const timestamp = Date.parse(detail.timestamp);
        if (Number.isNaN(timestamp) || timestamp < windowStart) {
          return;
        }
        const minuteIndex = Math.min(
          windowMinutes - 1,
          Math.floor((timestamp - windowStart) / 60000)
        );
        const increment = metric === 'tokens' ? extractTotalTokens(detail) : 1;
        buckets[minuteIndex] += increment;
      });

      const labels = buckets.map((_, idx) => {
        const date = new Date(windowStart + (idx + 1) * 60000);
        const h = date.getHours().toString().padStart(2, '0');
        const m = date.getMinutes().toString().padStart(2, '0');
        return `${h}:${m}`;
      });

      return { labels, data: buckets };
    },
    [usage]
  );

  const buildSparkline = useCallback(
    (series: { labels: string[]; data: number[] }, color: string, backgroundColor: string) => {
      if (loading || !series?.data?.length) {
        return null;
      }
      const sliceStart = Math.max(series.data.length - 60, 0);
      const labels = series.labels.slice(sliceStart);
      const points = series.data.slice(sliceStart);
      return {
        data: {
          labels,
          datasets: [
            {
              data: points,
              borderColor: color,
              backgroundColor,
              fill: true,
              tension: 0.45,
              pointRadius: 0,
              borderWidth: 2
            }
          ]
        }
      };
    },
    [loading]
  );

  const requestsSparkline = useMemo(
    () => buildSparkline(buildLastHourSeries('requests'), '#3b82f6', 'rgba(59, 130, 246, 0.18)'),
    [buildLastHourSeries, buildSparkline]
  );
  const tokensSparkline = useMemo(
    () => buildSparkline(buildLastHourSeries('tokens'), '#8b5cf6', 'rgba(139, 92, 246, 0.18)'),
    [buildLastHourSeries, buildSparkline]
  );
  const rpmSparkline = useMemo(
    () => buildSparkline(buildLastHourSeries('requests'), '#22c55e', 'rgba(34, 197, 94, 0.18)'),
    [buildLastHourSeries, buildSparkline]
  );
  const tpmSparkline = useMemo(
    () => buildSparkline(buildLastHourSeries('tokens'), '#f97316', 'rgba(249, 115, 22, 0.18)'),
    [buildLastHourSeries, buildSparkline]
  );
  const costSparkline = useMemo(
    () => buildSparkline(buildLastHourSeries('tokens'), '#f59e0b', 'rgba(245, 158, 11, 0.18)'),
    [buildLastHourSeries, buildSparkline]
  );

  const buildChartOptions = useCallback(
    (period: 'hour' | 'day', labels: string[]): ChartOptions<'line'> => {
      const pointRadius = isMobile && period === 'hour' ? 0 : isMobile ? 2 : 4;
      const tickFontSize = isMobile ? 10 : 12;
      const maxTickLabelCount = isMobile ? (period === 'hour' ? 8 : 6) : period === 'hour' ? 12 : 10;
      const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(17, 24, 39, 0.06)';
      const axisBorderColor = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(17, 24, 39, 0.10)';
      const tickColor = isDark ? 'rgba(255, 255, 255, 0.72)' : 'rgba(17, 24, 39, 0.72)';
      const tooltipBg = isDark ? 'rgba(17, 24, 39, 0.92)' : 'rgba(255, 255, 255, 0.98)';
      const tooltipTitle = isDark ? '#ffffff' : '#111827';
      const tooltipBody = isDark ? 'rgba(255, 255, 255, 0.86)' : '#374151';
      const tooltipBorder = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(17, 24, 39, 0.10)';

      return {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tooltipBg,
            titleColor: tooltipTitle,
            bodyColor: tooltipBody,
            borderColor: tooltipBorder,
            borderWidth: 1,
            padding: 10,
            displayColors: true,
            usePointStyle: true
          }
        },
        scales: {
          x: {
            grid: {
              color: gridColor,
              drawTicks: false
            },
            border: {
              color: axisBorderColor
            },
            ticks: {
              color: tickColor,
              font: { size: tickFontSize },
              maxRotation: isMobile ? 0 : 45,
              minRotation: isMobile ? 0 : 0,
              autoSkip: true,
              maxTicksLimit: maxTickLabelCount,
              callback: (value) => {
                const index = typeof value === 'number' ? value : Number(value);
                const raw =
                  Number.isFinite(index) && labels[index] ? labels[index] : typeof value === 'string' ? value : '';

                if (period === 'hour') {
                  const [md, time] = raw.split(' ');
                  if (!time) return raw;
                  if (time.startsWith('00:')) {
                    return md ? [md, time] : time;
                  }
                  return time;
                }

                if (isMobile) {
                  const parts = raw.split('-');
                  if (parts.length === 3) {
                    return `${parts[1]}-${parts[2]}`;
                  }
                }
                return raw;
              }
            }
          },
          y: {
            beginAtZero: true,
            grid: {
              color: gridColor
            },
            border: {
              color: axisBorderColor
            },
            ticks: {
              color: tickColor,
              font: { size: tickFontSize }
            }
          }
        },
        elements: {
          line: {
            tension: 0.35,
            borderWidth: isMobile ? 1.5 : 2
          },
          point: {
            borderWidth: 2,
            radius: pointRadius,
            hoverRadius: 4
          }
        }
      };
    },
    [isDark, isMobile]
  );

  const requestsChartOptions = useMemo(
    () => buildChartOptions(requestsPeriod, requestsChartData.labels),
    [buildChartOptions, requestsPeriod, requestsChartData.labels]
  );

  const tokensChartOptions = useMemo(
    () => buildChartOptions(tokensPeriod, tokensChartData.labels),
    [buildChartOptions, tokensPeriod, tokensChartData.labels]
  );

  const getHourChartMinWidth = useCallback(
    (labelCount: number) => {
      if (!isMobile || labelCount <= 0) return undefined;
      // 24 小时标签在移动端需要更宽的画布，避免 X 轴与点位过度挤压
      const perPoint = 56;
      const minWidth = Math.min(labelCount * perPoint, 3000);
      return `${minWidth}px`;
    },
    [isMobile]
  );

  // Chart line management
  const handleAddChartLine = () => {
    if (chartLines.length >= MAX_CHART_LINES) return;
    const unusedModel = modelNames.find(m => !chartLines.includes(m));
    if (unusedModel) {
      setChartLines([...chartLines, unusedModel]);
    } else {
      setChartLines([...chartLines, 'all']);
    }
  };

  const handleRemoveChartLine = (index: number) => {
    if (chartLines.length <= 1) return;
    const newLines = [...chartLines];
    newLines.splice(index, 1);
    setChartLines(newLines);
  };

  const handleChartLineChange = (index: number, value: string) => {
    const newLines = [...chartLines];
    newLines[index] = value;
    setChartLines(newLines);
  };

  // Handle model price save
  const handleSavePrice = () => {
    if (!selectedModel) return;
    const prompt = parseFloat(promptPrice) || 0;
    const completion = parseFloat(completionPrice) || 0;
    const cache = cachePrice.trim() === '' ? prompt : parseFloat(cachePrice) || 0;
    const newPrices = { ...modelPrices, [selectedModel]: { prompt, completion, cache } };
    setModelPrices(newPrices);
    saveModelPrices(newPrices);
    setSelectedModel('');
    setPromptPrice('');
    setCompletionPrice('');
    setCachePrice('');
  };

  // Handle model price delete
  const handleDeletePrice = (model: string) => {
    const newPrices = { ...modelPrices };
    delete newPrices[model];
    setModelPrices(newPrices);
    saveModelPrices(newPrices);
  };

  // Handle edit price
  const handleEditPrice = (model: string) => {
    const price = modelPrices[model];
    setSelectedModel(model);
    setPromptPrice(price?.prompt?.toString() || '');
    setCompletionPrice(price?.completion?.toString() || '');
    setCachePrice(price?.cache?.toString() || '');
  };

  // Toggle API expansion
  const toggleApiExpand = (endpoint: string) => {
    setExpandedApis(prev => {
      const newSet = new Set(prev);
      if (newSet.has(endpoint)) {
        newSet.delete(endpoint);
      } else {
        newSet.add(endpoint);
      }
      return newSet;
    });
  };

  const statsCards = [
    {
      key: 'requests',
      label: t('usage_stats.total_requests'),
      icon: <IconSatellite size={16} />,
      accent: '#3b82f6',
      accentSoft: 'rgba(59, 130, 246, 0.18)',
      accentBorder: 'rgba(59, 130, 246, 0.35)',
      value: loading ? '-' : (usage?.total_requests ?? 0).toLocaleString(),
      meta: (
        <>
          <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: '#10b981' }} />
            {t('usage_stats.success_requests')}: {loading ? '-' : (usage?.success_count ?? 0)}
          </span>
          <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: '#ef4444' }} />
            {t('usage_stats.failed_requests')}: {loading ? '-' : (usage?.failure_count ?? 0)}
          </span>
        </>
      ),
      trend: requestsSparkline
    },
    {
      key: 'tokens',
      label: t('usage_stats.total_tokens'),
      icon: <IconDiamond size={16} />,
      accent: '#8b5cf6',
      accentSoft: 'rgba(139, 92, 246, 0.18)',
      accentBorder: 'rgba(139, 92, 246, 0.35)',
      value: loading ? '-' : formatTokensInMillions(usage?.total_tokens ?? 0),
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.cached_tokens')}: {loading ? '-' : formatTokensInMillions(tokenBreakdown.cachedTokens)}
          </span>
          <span className={styles.statMetaItem}>
            {t('usage_stats.reasoning_tokens')}: {loading ? '-' : formatTokensInMillions(tokenBreakdown.reasoningTokens)}
          </span>
        </>
      ),
      trend: tokensSparkline
    },
    {
      key: 'rpm',
      label: t('usage_stats.rpm_30m'),
      icon: <IconTimer size={16} />,
      accent: '#22c55e',
      accentSoft: 'rgba(34, 197, 94, 0.18)',
      accentBorder: 'rgba(34, 197, 94, 0.32)',
      value: loading ? '-' : formatPerMinuteValue(rateStats.rpm),
      meta: (
        <span className={styles.statMetaItem}>
          {t('usage_stats.total_requests')}: {loading ? '-' : rateStats.requestCount.toLocaleString()}
        </span>
      ),
      trend: rpmSparkline
    },
    {
      key: 'tpm',
      label: t('usage_stats.tpm_30m'),
      icon: <IconTrendingUp size={16} />,
      accent: '#f97316',
      accentSoft: 'rgba(249, 115, 22, 0.18)',
      accentBorder: 'rgba(249, 115, 22, 0.32)',
      value: loading ? '-' : formatPerMinuteValue(rateStats.tpm),
      meta: (
        <span className={styles.statMetaItem}>
          {t('usage_stats.total_tokens')}: {loading ? '-' : formatTokensInMillions(rateStats.tokenCount)}
        </span>
      ),
      trend: tpmSparkline
    },
    {
      key: 'cost',
      label: t('usage_stats.total_cost'),
      icon: <IconDollarSign size={16} />,
      accent: '#f59e0b',
      accentSoft: 'rgba(245, 158, 11, 0.18)',
      accentBorder: 'rgba(245, 158, 11, 0.32)',
      value: loading ? '-' : hasPrices ? formatUsd(totalCost) : '--',
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.total_tokens')}: {loading ? '-' : formatTokensInMillions(usage?.total_tokens ?? 0)}
          </span>
          {!hasPrices && (
            <span className={`${styles.statMetaItem} ${styles.statSubtle}`}>
              {t('usage_stats.cost_need_price')}
            </span>
          )}
        </>
      ),
      trend: hasPrices ? costSparkline : null
    }
  ];

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
        <Button
          variant="secondary"
          size="sm"
          onClick={loadUsage}
          disabled={loading}
        >
          {loading ? t('common.loading') : t('usage_stats.refresh')}
        </Button>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {/* Stats Overview Cards */}
      <div className={styles.statsGrid}>
        {statsCards.map(card => (
          <div
            key={card.key}
            className={styles.statCard}
            style={
              {
                '--accent': card.accent,
                '--accent-soft': card.accentSoft,
                '--accent-border': card.accentBorder
              } as CSSProperties
            }
          >
            <div className={styles.statCardHeader}>
              <div className={styles.statLabelGroup}>
                <span className={styles.statLabel}>{card.label}</span>
              </div>
              <span className={styles.statIconBadge}>
                {card.icon}
              </span>
            </div>
            <div className={styles.statValue}>{card.value}</div>
            {card.meta && <div className={styles.statMetaRow}>{card.meta}</div>}
            <div className={styles.statTrend}>
              {card.trend ? (
                <Line className={styles.sparkline} data={card.trend.data} options={sparklineOptions} />
              ) : (
                <div className={styles.statTrendPlaceholder}></div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Chart Line Selection */}
      <Card
        title={t('usage_stats.chart_line_actions_label')}
        extra={
          <div className={styles.chartLineHeader}>
            <span className={styles.chartLineCount}>
              {chartLines.length}/{MAX_CHART_LINES}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleAddChartLine}
              disabled={chartLines.length >= MAX_CHART_LINES}
            >
              {t('usage_stats.chart_line_add')}
            </Button>
          </div>
        }
      >
        <div className={styles.chartLineList}>
          {chartLines.map((line, index) => (
            <div key={index} className={styles.chartLineItem}>
              <span className={styles.chartLineLabel}>
                {t(`usage_stats.chart_line_label_${index + 1}`)}
              </span>
              <select
                value={line}
                onChange={(e) => handleChartLineChange(index, e.target.value)}
                className={styles.select}
              >
                <option value="all">{t('usage_stats.chart_line_all')}</option>
                {modelNames.map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              {chartLines.length > 1 && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleRemoveChartLine(index)}
                >
                  {t('usage_stats.chart_line_delete')}
                </Button>
              )}
            </div>
          ))}
        </div>
        <p className={styles.chartLineHint}>{t('usage_stats.chart_line_hint')}</p>
      </Card>

      <div className={styles.chartsGrid}>
        {/* Requests Chart */}
        <Card
          title={t('usage_stats.requests_trend')}
          extra={
            <div className={styles.periodButtons}>
              <Button
                variant={requestsPeriod === 'hour' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setRequestsPeriod('hour')}
              >
                {t('usage_stats.by_hour')}
              </Button>
              <Button
                variant={requestsPeriod === 'day' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setRequestsPeriod('day')}
              >
                {t('usage_stats.by_day')}
              </Button>
            </div>
          }
        >
          {loading ? (
            <div className={styles.hint}>{t('common.loading')}</div>
          ) : requestsChartData.labels.length > 0 ? (
            <div className={styles.chartWrapper}>
              <div className={styles.chartLegend} aria-label="Chart legend">
                {requestsChartData.datasets.map((dataset, index) => (
                  <div
                    key={`${dataset.label}-${index}`}
                    className={styles.legendItem}
                    title={dataset.label}
                  >
                    <span className={styles.legendDot} style={{ backgroundColor: dataset.borderColor }} />
                    <span className={styles.legendLabel}>{dataset.label}</span>
                  </div>
                ))}
              </div>
              <div className={styles.chartArea}>
                <div className={styles.chartScroller}>
                  <div
                    className={styles.chartCanvas}
                    style={
                      requestsPeriod === 'hour'
                        ? { minWidth: getHourChartMinWidth(requestsChartData.labels.length) }
                        : undefined
                    }
                  >
                    <Line data={requestsChartData} options={requestsChartOptions} />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.hint}>{t('usage_stats.no_data')}</div>
          )}
        </Card>

        {/* Tokens Chart */}
        <Card
          title={t('usage_stats.tokens_trend')}
          extra={
            <div className={styles.periodButtons}>
              <Button
                variant={tokensPeriod === 'hour' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setTokensPeriod('hour')}
              >
                {t('usage_stats.by_hour')}
              </Button>
              <Button
                variant={tokensPeriod === 'day' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setTokensPeriod('day')}
              >
                {t('usage_stats.by_day')}
              </Button>
            </div>
          }
        >
          {loading ? (
            <div className={styles.hint}>{t('common.loading')}</div>
          ) : tokensChartData.labels.length > 0 ? (
            <div className={styles.chartWrapper}>
              <div className={styles.chartLegend} aria-label="Chart legend">
                {tokensChartData.datasets.map((dataset, index) => (
                  <div
                    key={`${dataset.label}-${index}`}
                    className={styles.legendItem}
                    title={dataset.label}
                  >
                    <span className={styles.legendDot} style={{ backgroundColor: dataset.borderColor }} />
                    <span className={styles.legendLabel}>{dataset.label}</span>
                  </div>
                ))}
              </div>
              <div className={styles.chartArea}>
                <div className={styles.chartScroller}>
                  <div
                    className={styles.chartCanvas}
                    style={
                      tokensPeriod === 'hour'
                        ? { minWidth: getHourChartMinWidth(tokensChartData.labels.length) }
                        : undefined
                    }
                  >
                    <Line data={tokensChartData} options={tokensChartOptions} />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.hint}>{t('usage_stats.no_data')}</div>
          )}
        </Card>
      </div>

      <div className={styles.detailsGrid}>
        {/* API Key Statistics */}
        <Card title={t('usage_stats.api_details')}>
          {loading ? (
            <div className={styles.hint}>{t('common.loading')}</div>
          ) : apiStats.length > 0 ? (
            <div className={styles.apiList}>
              {apiStats.map((api) => (
                <div key={api.endpoint} className={styles.apiItem}>
                  <div
                    className={styles.apiHeader}
                    onClick={() => toggleApiExpand(api.endpoint)}
                  >
                    <div className={styles.apiInfo}>
                      <span className={styles.apiEndpoint}>{api.endpoint}</span>
                      <div className={styles.apiStats}>
                        <span className={styles.apiBadge}>
                          {t('usage_stats.requests_count')}: {api.totalRequests}
                        </span>
                        <span className={styles.apiBadge}>
                          Tokens: {formatTokensInMillions(api.totalTokens)}
                        </span>
                        {hasPrices && api.totalCost > 0 && (
                          <span className={styles.apiBadge}>
                            {t('usage_stats.total_cost')}: {formatUsd(api.totalCost)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={styles.expandIcon}>
                      {expandedApis.has(api.endpoint) ? '▼' : '▶'}
                    </span>
                  </div>
                  {expandedApis.has(api.endpoint) && (
                    <div className={styles.apiModels}>
                      {Object.entries(api.models).map(([model, stats]) => (
                        <div key={model} className={styles.modelRow}>
                          <span className={styles.modelName}>{model}</span>
                          <span className={styles.modelStat}>{stats.requests} {t('usage_stats.requests_count')}</span>
                          <span className={styles.modelStat}>{formatTokensInMillions(stats.tokens)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.hint}>{t('usage_stats.no_data')}</div>
          )}
        </Card>

        {/* Model Statistics */}
        <Card title={t('usage_stats.models')}>
          {loading ? (
            <div className={styles.hint}>{t('common.loading')}</div>
          ) : modelStats.length > 0 ? (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('usage_stats.model_name')}</th>
                    <th>{t('usage_stats.requests_count')}</th>
                    <th>{t('usage_stats.tokens_count')}</th>
                    {hasPrices && <th>{t('usage_stats.total_cost')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {modelStats.map((stat) => (
                    <tr key={stat.model}>
                      <td className={styles.modelCell}>{stat.model}</td>
                      <td>{stat.requests.toLocaleString()}</td>
                      <td>{formatTokensInMillions(stat.tokens)}</td>
                      {hasPrices && <td>{stat.cost > 0 ? formatUsd(stat.cost) : '--'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.hint}>{t('usage_stats.no_data')}</div>
          )}
        </Card>
      </div>

      {/* Model Pricing Configuration */}
      <Card title={t('usage_stats.model_price_settings')}>
        <div className={styles.pricingSection}>
          {/* Price Form */}
          <div className={styles.priceForm}>
            <div className={styles.formRow}>
              <div className={styles.formField}>
                <label>{t('usage_stats.model_name')}</label>
                <select
                  value={selectedModel}
                  onChange={(e) => {
                    setSelectedModel(e.target.value);
                    const price = modelPrices[e.target.value];
                    if (price) {
                      setPromptPrice(price.prompt.toString());
                      setCompletionPrice(price.completion.toString());
                      setCachePrice(price.cache.toString());
                    } else {
                      setPromptPrice('');
                      setCompletionPrice('');
                      setCachePrice('');
                    }
                  }}
                  className={styles.select}
                >
                  <option value="">{t('usage_stats.model_price_select_placeholder')}</option>
                  {modelNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formField}>
                <label>{t('usage_stats.model_price_prompt')} ($/1M)</label>
                <Input
                  type="number"
                  value={promptPrice}
                  onChange={(e) => setPromptPrice(e.target.value)}
                  placeholder="0.00"
                  step="0.0001"
                />
              </div>
              <div className={styles.formField}>
                <label>{t('usage_stats.model_price_completion')} ($/1M)</label>
                <Input
                  type="number"
                  value={completionPrice}
                  onChange={(e) => setCompletionPrice(e.target.value)}
                  placeholder="0.00"
                  step="0.0001"
                />
              </div>
              <div className={styles.formField}>
                <label>{t('usage_stats.model_price_cache')} ($/1M)</label>
                <Input
                  type="number"
                  value={cachePrice}
                  onChange={(e) => setCachePrice(e.target.value)}
                  placeholder="0.00"
                  step="0.0001"
                />
              </div>
              <Button
                variant="primary"
                onClick={handleSavePrice}
                disabled={!selectedModel}
              >
                {t('common.save')}
              </Button>
            </div>
          </div>

          {/* Saved Prices List */}
          <div className={styles.pricesList}>
            <h4 className={styles.pricesTitle}>{t('usage_stats.saved_prices')}</h4>
            {Object.keys(modelPrices).length > 0 ? (
              <div className={styles.pricesGrid}>
                {Object.entries(modelPrices).map(([model, price]) => (
                  <div key={model} className={styles.priceItem}>
                    <div className={styles.priceInfo}>
                      <span className={styles.priceModel}>{model}</span>
                      <div className={styles.priceMeta}>
                        <span>{t('usage_stats.model_price_prompt')}: ${price.prompt.toFixed(4)}/1M</span>
                        <span>{t('usage_stats.model_price_completion')}: ${price.completion.toFixed(4)}/1M</span>
                        <span>{t('usage_stats.model_price_cache')}: ${price.cache.toFixed(4)}/1M</span>
                      </div>
                    </div>
                    <div className={styles.priceActions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleEditPrice(model)}
                      >
                        {t('common.edit')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleDeletePrice(model)}
                      >
                        {t('common.delete')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.hint}>{t('usage_stats.model_price_empty')}</div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
