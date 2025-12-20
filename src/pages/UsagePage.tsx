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
import { IconDiamond, IconDollarSign, IconRefreshCw, IconSatellite, IconTimer, IconTrendingUp } from '@/components/ui/icons';
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
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#10b981' }} />
            {t('usage_stats.success_requests')}: {loading ? '-' : (usage?.success_count ?? 0)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: '#ef4444' }} />
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
          <span className="block">
            {t('usage_stats.cached_tokens')}: {loading ? '-' : formatTokensInMillions(tokenBreakdown.cachedTokens)}
          </span>
          <span className="block">
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
        <span className="block">
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
        <span className="block">
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
          <span className="block">
            {t('usage_stats.total_tokens')}: {loading ? '-' : formatTokensInMillions(usage?.total_tokens ?? 0)}
          </span>
          {!hasPrices && (
            <span className="block text-amber-500">
              {t('usage_stats.cost_need_price')}
            </span>
          )}
        </>
      ),
      trend: hasPrices ? costSparkline : null
    }
  ];

  return (
    <div className="space-y-4">
      {loading && !usage && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center" aria-busy="true">
          <div className="flex flex-col items-center gap-3">
            <LoadingSpinner size={28} />
            <span className="text-sm text-muted-foreground">{t('common.loading')}</span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={loadUsage}
          disabled={loading}
          title={t('usage_stats.refresh')}
        >
          <IconRefreshCw size={16} />
        </Button>
      </div>

      {error && <div className="text-destructive text-sm bg-destructive/10 px-3 py-2 rounded">{error}</div>}

      {/* Stats Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {statsCards.map(card => (
          <div
            key={card.key}
            className="bg-card border border-border p-4 rounded-lg relative overflow-hidden"
            style={
              {
                '--accent': card.accent,
                '--accent-soft': card.accentSoft,
                '--accent-border': card.accentBorder
              } as CSSProperties
            }
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <span className="text-xs text-muted-foreground">{card.label}</span>
              </div>
              <span className="text-muted-foreground" style={{ color: 'var(--accent)' }}>
                {card.icon}
              </span>
            </div>
            <div className="text-2xl font-bold mb-2" style={{ color: 'var(--accent)' }}>{card.value}</div>
            {card.meta && <div className="text-xs text-muted-foreground space-y-1">{card.meta}</div>}
            <div className="h-10 mt-3">
              {card.trend ? (
                <Line className="w-full h-full" data={card.trend.data} options={sparklineOptions} />
              ) : (
                <div className="w-full h-full bg-muted/30 rounded"></div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Chart Line Selection */}
      <Card
        title={t('usage_stats.chart_line_actions_label')}
        extra={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
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
        <div className="space-y-2">
          {chartLines.map((line, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-16">
                {t(`usage_stats.chart_line_label_${index + 1}`)}
              </span>
              <select
                value={line}
                onChange={(e) => handleChartLineChange(index, e.target.value)}
                className="flex-1 bg-input border border-border rounded px-2 py-1 text-sm"
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
        <p className="text-xs text-muted-foreground mt-3">{t('usage_stats.chart_line_hint')}</p>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Requests Chart */}
        <Card
          title={t('usage_stats.requests_trend')}
          extra={
            <div className="flex gap-1">
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
            <div className="text-sm text-muted-foreground py-8 text-center">{t('common.loading')}</div>
          ) : requestsChartData.labels.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2" aria-label="Chart legend">
                {requestsChartData.datasets.map((dataset, index) => (
                  <div
                    key={`${dataset.label}-${index}`}
                    className="flex items-center gap-1.5 text-xs"
                    title={dataset.label}
                  >
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: dataset.borderColor }} />
                    <span className="text-muted-foreground truncate max-w-[100px]">{dataset.label}</span>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <div className="min-h-[200px]">
                  <div
                    className="h-[200px]"
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
            <div className="text-sm text-muted-foreground py-8 text-center">{t('usage_stats.no_data')}</div>
          )}
        </Card>

        {/* Tokens Chart */}
        <Card
          title={t('usage_stats.tokens_trend')}
          extra={
            <div className="flex gap-1">
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
            <div className="text-sm text-muted-foreground py-8 text-center">{t('common.loading')}</div>
          ) : tokensChartData.labels.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2" aria-label="Chart legend">
                {tokensChartData.datasets.map((dataset, index) => (
                  <div
                    key={`${dataset.label}-${index}`}
                    className="flex items-center gap-1.5 text-xs"
                    title={dataset.label}
                  >
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: dataset.borderColor }} />
                    <span className="text-muted-foreground truncate max-w-[100px]">{dataset.label}</span>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <div className="min-h-[200px]">
                  <div
                    className="h-[200px]"
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
            <div className="text-sm text-muted-foreground py-8 text-center">{t('usage_stats.no_data')}</div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* API Key Statistics */}
        <Card title={t('usage_stats.api_details')}>
          {loading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">{t('common.loading')}</div>
          ) : apiStats.length > 0 ? (
            <div className="space-y-2">
              {apiStats.map((api) => (
                <div key={api.endpoint} className="border border-border rounded">
                  <div
                    className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => toggleApiExpand(api.endpoint)}
                  >
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">{api.endpoint}</span>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground mt-1">
                        <span className="">
                          {t('usage_stats.requests_count')}: {api.totalRequests}
                        </span>
                        <span className="">
                          Tokens: {formatTokensInMillions(api.totalTokens)}
                        </span>
                        {hasPrices && api.totalCost > 0 && (
                          <span className="text-amber-500">
                            {t('usage_stats.total_cost')}: {formatUsd(api.totalCost)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-muted-foreground ml-2">
                      {expandedApis.has(api.endpoint) ? '▼' : '▶'}
                    </span>
                  </div>
                  {expandedApis.has(api.endpoint) && (
                    <div className="border-t border-border p-3 bg-muted/30 space-y-1">
                      {Object.entries(api.models).map(([model, stats]) => (
                        <div key={model} className="flex items-center justify-between text-xs">
                          <span className="text-foreground truncate flex-1">{model}</span>
                          <span className="text-muted-foreground ml-2">{stats.requests} {t('usage_stats.requests_count')}</span>
                          <span className="text-muted-foreground ml-2">{formatTokensInMillions(stats.tokens)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center">{t('usage_stats.no_data')}</div>
          )}
        </Card>

        {/* Model Statistics */}
        <Card title={t('usage_stats.models')}>
          {loading ? (
            <div className="text-sm text-muted-foreground py-8 text-center">{t('common.loading')}</div>
          ) : modelStats.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-2 pr-4">{t('usage_stats.model_name')}</th>
                    <th className="py-2 pr-4">{t('usage_stats.requests_count')}</th>
                    <th className="py-2 pr-4">{t('usage_stats.tokens_count')}</th>
                    {hasPrices && <th className="py-2">{t('usage_stats.total_cost')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {modelStats.map((stat) => (
                    <tr key={stat.model} className="border-b border-border/50">
                      <td className="py-2 pr-4 font-medium">{stat.model}</td>
                      <td className="py-2 pr-4">{stat.requests.toLocaleString()}</td>
                      <td className="py-2 pr-4">{formatTokensInMillions(stat.tokens)}</td>
                      {hasPrices && <td className="py-2">{stat.cost > 0 ? formatUsd(stat.cost) : '--'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center">{t('usage_stats.no_data')}</div>
          )}
        </Card>
      </div>

      {/* Model Pricing Configuration */}
      <Card title={t('usage_stats.model_price_settings')}>
        <div className="space-y-6">
          {/* Price Form */}
          <div className="bg-muted/30 p-4 rounded">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('usage_stats.model_name')}</label>
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
                  className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm"
                >
                  <option value="">{t('usage_stats.model_price_select_placeholder')}</option>
                  {modelNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('usage_stats.model_price_prompt')} ($/1M)</label>
                <Input
                  type="number"
                  value={promptPrice}
                  onChange={(e) => setPromptPrice(e.target.value)}
                  placeholder="0.00"
                  step="0.0001"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('usage_stats.model_price_completion')} ($/1M)</label>
                <Input
                  type="number"
                  value={completionPrice}
                  onChange={(e) => setCompletionPrice(e.target.value)}
                  placeholder="0.00"
                  step="0.0001"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{t('usage_stats.model_price_cache')} ($/1M)</label>
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
          <div className="space-y-3">
            <h4 className="text-sm font-medium">{t('usage_stats.saved_prices')}</h4>
            {Object.keys(modelPrices).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(modelPrices).map(([model, price]) => (
                  <div key={model} className="flex items-center justify-between p-3 border border-border rounded">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium block truncate">{model}</span>
                      <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground mt-1">
                        <span>{t('usage_stats.model_price_prompt')}: ${price.prompt.toFixed(4)}/1M</span>
                        <span>{t('usage_stats.model_price_completion')}: ${price.completion.toFixed(4)}/1M</span>
                        <span>{t('usage_stats.model_price_cache')}: ${price.cache.toFixed(4)}/1M</span>
                      </div>
                    </div>
                    <div className="flex gap-1 ml-2">
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
              <div className="text-sm text-muted-foreground py-4 text-center">{t('usage_stats.model_price_empty')}</div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
