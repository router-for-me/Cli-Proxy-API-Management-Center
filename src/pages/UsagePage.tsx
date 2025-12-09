import { useEffect, useState, useCallback, useMemo } from 'react';
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
import { Line } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
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
  apis?: Record<string, any>;
  [key: string]: any;
}

export function UsagePage() {
  const { t } = useTranslation();

  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modelPrices, setModelPrices] = useState<Record<string, ModelPrice>>({});

  // Model price form state
  const [selectedModel, setSelectedModel] = useState('');
  const [promptPrice, setPromptPrice] = useState('');
  const [completionPrice, setCompletionPrice] = useState('');

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
    } catch (err: any) {
      setError(err?.message || t('usage_stats.loading_error'));
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
  const rateStats = usage ? calculateRecentPerMinuteRates(30, usage) : { rpm: 0, tpm: 0 };
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

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false
    },
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        align: 'start' as const,
        labels: {
          usePointStyle: true
        }
      }
    },
    scales: {
      y: {
        beginAtZero: true
      }
    },
    elements: {
      line: {
        tension: 0.35,
        borderWidth: 2
      },
      point: {
        borderWidth: 2,
        radius: 4
      }
    }
  };

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
    const newPrices = { ...modelPrices, [selectedModel]: { prompt, completion } };
    setModelPrices(newPrices);
    saveModelPrices(newPrices);
    setSelectedModel('');
    setPromptPrice('');
    setCompletionPrice('');
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

  return (
    <div className={styles.container}>
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
        {/* Total Requests Card */}
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <span className={styles.statIcon}>📊</span>
            <span className={styles.statLabel}>{t('usage_stats.total_requests')}</span>
          </div>
          <div className={styles.statValue}>
            {loading ? '-' : (usage?.total_requests ?? 0).toLocaleString()}
          </div>
          <div className={styles.statMeta}>
            <span className={styles.statSuccess}>
              ✓ {t('usage_stats.success_requests')}: {loading ? '-' : (usage?.success_count ?? 0)}
            </span>
            <span className={styles.statFailure}>
              ✗ {t('usage_stats.failed_requests')}: {loading ? '-' : (usage?.failure_count ?? 0)}
            </span>
          </div>
        </div>

        {/* Total Tokens Card */}
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <span className={styles.statIcon}>🔤</span>
            <span className={styles.statLabel}>{t('usage_stats.total_tokens')}</span>
          </div>
          <div className={styles.statValue}>
            {loading ? '-' : formatTokensInMillions(usage?.total_tokens ?? 0)}
          </div>
          <div className={styles.statMeta}>
            <span className={styles.statNeutral}>
              💾 {t('usage_stats.cached_tokens')}: {loading ? '-' : formatTokensInMillions(tokenBreakdown.cachedTokens)}
            </span>
            <span className={styles.statNeutral}>
              🧠 {t('usage_stats.reasoning_tokens')}: {loading ? '-' : formatTokensInMillions(tokenBreakdown.reasoningTokens)}
            </span>
          </div>
        </div>

        {/* RPM/TPM Card */}
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <span className={styles.statIcon}>⚡</span>
            <span className={styles.statLabel}>{t('usage_stats.rate_30m')}</span>
          </div>
          <div className={styles.statValueRow}>
            <div className={styles.statValueSmall}>
              <span className={styles.statValueLabel}>{t('usage_stats.rpm_30m')}</span>
              <span className={styles.statValueNum}>{loading ? '-' : formatPerMinuteValue(rateStats.rpm)}</span>
            </div>
            <div className={styles.statValueSmall}>
              <span className={styles.statValueLabel}>{t('usage_stats.tpm_30m')}</span>
              <span className={styles.statValueNum}>{loading ? '-' : formatPerMinuteValue(rateStats.tpm)}</span>
            </div>
          </div>
        </div>

        {/* Total Cost Card */}
        <div className={styles.statCard}>
          <div className={styles.statHeader}>
            <span className={styles.statIcon}>💰</span>
            <span className={styles.statLabel}>{t('usage_stats.total_cost')}</span>
          </div>
          <div className={styles.statValue}>
            {loading ? '-' : hasPrices ? formatUsd(totalCost) : '--'}
          </div>
          {!hasPrices && (
            <div className={styles.statMeta}>
              <span className={styles.statHint}>{t('usage_stats.cost_need_price')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Chart Line Selection */}
      <Card title={t('usage_stats.chart_line_actions_label')}>
        <div className={styles.chartLineControls}>
          <div className={styles.chartLineList}>
            {chartLines.map((line, index) => (
              <div key={index} className={styles.chartLineItem}>
                <span className={styles.chartLineLabel}>
                  {t(`usage_stats.chart_line_label_${index + 1}`)}:
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
          <div className={styles.chartLineActions}>
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
        </div>
        <p className={styles.chartLineHint}>{t('usage_stats.chart_line_hint')}</p>
      </Card>

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
            <Line data={requestsChartData} options={chartOptions} />
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
            <Line data={tokensChartData} options={chartOptions} />
          </div>
        ) : (
          <div className={styles.hint}>{t('usage_stats.no_data')}</div>
        )}
      </Card>

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
                    } else {
                      setPromptPrice('');
                      setCompletionPrice('');
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
