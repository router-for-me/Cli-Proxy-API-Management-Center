import type { ScriptableContext } from 'chart.js';
import type {
  ApiStats,
  ChartData,
  ChartDataset,
  CostSeries,
  LatencySeries,
  ModelPrice,
  ModelStatsSummary,
  TokenBreakdownSeries,
  TokenCategory
} from './usage';
import {
  formatDayLabel,
  formatHourLabel,
  maskUsageSensitiveValue,
  normalizeAuthIndex,
  normalizeUsageSourceId
} from './usage';
import type {
  UsageAggregateApiModelStat,
  UsageAggregateApiStat,
  UsageAggregateCostBasisSeries,
  UsageAggregateCredentialStat,
  UsageAggregateLatencySeries,
  UsageAggregateLatencyStats,
  UsageAggregateModelSeries,
  UsageAggregateModelStat,
  UsageAggregateSnapshot,
  UsageAggregateTokenSeries,
  UsageAggregateTokenStats,
  UsageAggregateTokenBreakdownSeries,
  UsageAggregateWindow
} from '@/types/usageAggregate';

const TOKENS_PER_PRICE_UNIT = 1_000_000;
const CHART_COLORS = [
  { borderColor: '#8b8680', backgroundColor: 'rgba(139, 134, 128, 0.15)' },
  { borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.15)' },
  { borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.15)' },
  { borderColor: '#c65746', backgroundColor: 'rgba(198, 87, 70, 0.15)' },
  { borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.15)' },
  { borderColor: '#06b6d4', backgroundColor: 'rgba(6, 182, 212, 0.15)' },
  { borderColor: '#ec4899', backgroundColor: 'rgba(236, 72, 153, 0.15)' },
  { borderColor: '#84cc16', backgroundColor: 'rgba(132, 204, 22, 0.15)' },
  { borderColor: '#f97316', backgroundColor: 'rgba(249, 115, 22, 0.15)' }
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const normalized = hex.trim().replace('#', '');
  if (normalized.length !== 6) {
    return null;
  }

  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if (![r, g, b].every((channel) => Number.isFinite(channel))) {
    return null;
  }

  return { r, g, b };
};

const withAlpha = (hex: string, alpha: number) => {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return hex;
  }

  const clamped = clamp(alpha, 0, 1);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`;
};

const buildAreaGradient = (
  context: ScriptableContext<'line'>,
  baseHex: string,
  fallback: string
) => {
  const chart = context.chart;
  const area = chart.chartArea;
  if (!area) {
    return fallback;
  }

  const gradient = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
  gradient.addColorStop(0, withAlpha(baseHex, 0.28));
  gradient.addColorStop(0.6, withAlpha(baseHex, 0.12));
  gradient.addColorStop(1, withAlpha(baseHex, 0.02));
  return gradient;
};

const asNumber = (value: unknown): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const normalizeTokenStats = (tokens?: UsageAggregateTokenStats): Required<UsageAggregateTokenStats> => {
  const input = Math.max(asNumber(tokens?.input_tokens), 0);
  const output = Math.max(asNumber(tokens?.output_tokens), 0);
  const reasoning = Math.max(asNumber(tokens?.reasoning_tokens), 0);
  const cached = Math.max(asNumber(tokens?.cached_tokens), 0);
  const total = Math.max(asNumber(tokens?.total_tokens), input + output + reasoning + cached);

  return {
    input_tokens: input,
    output_tokens: output,
    reasoning_tokens: reasoning,
    cached_tokens: cached,
    total_tokens: total
  };
};

const calculateCostForTokens = (
  tokens: UsageAggregateTokenStats | undefined,
  price: ModelPrice | undefined
) => {
  if (!price) {
    return 0;
  }

  const normalized = normalizeTokenStats(tokens);
  const cachedTokens = normalized.cached_tokens;
  const promptTokens = Math.max(normalized.input_tokens - cachedTokens, 0);
  const promptCost = (promptTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.prompt) || 0);
  const cachedCost = (cachedTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.cache) || 0);
  const completionCost =
    (normalized.output_tokens / TOKENS_PER_PRICE_UNIT) * (Number(price.completion) || 0);
  const total = promptCost + cachedCost + completionCost;
  return Number.isFinite(total) && total > 0 ? total : 0;
};

const averageLatencyMs = (latency?: UsageAggregateLatencyStats): number | null => {
  const count = asNumber(latency?.count);
  const totalMs = asNumber(latency?.total_ms);
  if (count <= 0 || totalMs <= 0) {
    return null;
  }
  return totalMs / count;
};

const formatMinuteLabel = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
};

const formatPeriodLabels = (timestamps: string[] | undefined, period: 'hour' | 'day') =>
  (timestamps ?? []).map((timestamp) => {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return period === 'hour' ? formatHourLabel(date) : formatDayLabel(date);
  });

const sumNumberArrays = (arrays: number[][], size: number) => {
  const result = new Array(size).fill(0);
  arrays.forEach((values) => {
    values.forEach((value, index) => {
      result[index] += asNumber(value);
    });
  });
  return result;
};

const buildPeriodSeries = (
  periodSeries: UsageAggregateModelSeries | undefined,
  selectedModels: string[]
): ChartData => {
  const labels = formatPeriodLabels(periodSeries?.timestamps, 'hour');
  const dataByModel = periodSeries?.series ?? {};
  const modelsToShow = selectedModels.length > 0 ? selectedModels : ['all'];
  const allSeries = sumNumberArrays(Object.values(dataByModel), labels.length);

  const datasets: ChartDataset[] = modelsToShow.map((model, index) => {
    const isAll = model === 'all';
    const data = isAll
      ? allSeries
      : (dataByModel[model] ?? new Array(labels.length).fill(0)).map((value) => asNumber(value));
    const style = CHART_COLORS[index % CHART_COLORS.length];
    const shouldFill = modelsToShow.length === 1 || (isAll && modelsToShow.length > 1);

    return {
      label: isAll ? 'All Models' : model,
      data,
      borderColor: style.borderColor,
      backgroundColor: shouldFill
        ? (ctx) => buildAreaGradient(ctx, style.borderColor, style.backgroundColor)
        : style.backgroundColor,
      pointBackgroundColor: style.borderColor,
      pointBorderColor: style.borderColor,
      fill: shouldFill,
      tension: 0.35
    };
  });

  return { labels, datasets };
};

const buildCategorySeries = (
  timestamps: string[] | undefined,
  period: 'hour' | 'day',
  source: UsageAggregateTokenBreakdownSeries | undefined
): TokenBreakdownSeries => {
  const labels = formatPeriodLabels(timestamps, period);
  const dataByCategory: Record<TokenCategory, number[]> = {
    input: (source?.input ?? []).map((value) => asNumber(value)),
    output: (source?.output ?? []).map((value) => asNumber(value)),
    cached: (source?.cached ?? []).map((value) => asNumber(value)),
    reasoning: (source?.reasoning ?? []).map((value) => asNumber(value))
  };

  const hasData = Object.values(dataByCategory).some((values) =>
    values.some((value) => value > 0)
  );

  return { labels, dataByCategory, hasData };
};

const buildLatencySeries = (
  timestamps: string[] | undefined,
  period: 'hour' | 'day',
  source: UsageAggregateLatencySeries | undefined
): LatencySeries => {
  const labels = formatPeriodLabels(timestamps, period);
  const data = (source?.values ?? []).map((value) =>
    value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value)
  );
  const hasData = data.some((value) => typeof value === 'number' && value >= 0);

  return { labels, data, hasData };
};

const calculateSeriesCost = (
  series: UsageAggregateTokenSeries | undefined,
  price: ModelPrice | undefined,
  length: number
) => {
  const input = series?.input ?? [];
  const output = series?.output ?? [];
  const cached = series?.cached ?? [];
  const reasoning = series?.reasoning ?? [];

  return Array.from({ length }, (_, index) =>
    calculateCostForTokens(
      {
        input_tokens: input[index],
        output_tokens: output[index],
        cached_tokens: cached[index],
        reasoning_tokens: reasoning[index]
      },
      price
    )
  );
};

export const getAggregateModelNames = (snapshot: UsageAggregateSnapshot | null) =>
  (snapshot?.model_names ?? []).filter((value): value is string => typeof value === 'string');

export const getAggregateWindowModelNames = (window: UsageAggregateWindow | null) =>
  (window?.model_names ?? []).filter((value): value is string => typeof value === 'string');

export const calculateAggregateWindowCost = (
  window: UsageAggregateWindow | null,
  modelPrices: Record<string, ModelPrice>
) =>
  (window?.models ?? []).reduce((sum, stat) => {
    const modelName = typeof stat.model === 'string' ? stat.model : '';
    return sum + calculateCostForTokens(stat.token_breakdown, modelPrices[modelName]);
  }, 0);

export const getAggregateRateStats = (window: UsageAggregateWindow | null) => ({
  rpm: asNumber(window?.rate_30m?.rpm),
  tpm: asNumber(window?.rate_30m?.tpm),
  windowMinutes: Math.max(asNumber(window?.rate_30m?.window_minutes), 30),
  requestCount: asNumber(window?.rate_30m?.request_count),
  tokenCount: asNumber(window?.rate_30m?.token_count)
});

export const getAggregateLatencySummary = (window: UsageAggregateWindow | null) => {
  const averageMs = averageLatencyMs(window?.latency);
  return {
    averageMs,
    totalMs: asNumber(window?.latency?.total_ms) || null,
    sampleCount: asNumber(window?.latency?.count)
  };
};

export const getAggregateTokenBreakdown = (window: UsageAggregateWindow | null) => {
  const tokenBreakdown = normalizeTokenStats(window?.token_breakdown);
  return {
    cachedTokens: tokenBreakdown.cached_tokens,
    reasoningTokens: tokenBreakdown.reasoning_tokens
  };
};

export const buildAggregateSparklines = (window: UsageAggregateWindow | null) => {
  const timestamps = window?.sparklines?.timestamps ?? [];
  const requests = (window?.sparklines?.requests ?? []).map((value) => asNumber(value));
  const tokens = (window?.sparklines?.tokens ?? []).map((value) => asNumber(value));
  const labels = timestamps.map((timestamp) => formatMinuteLabel(timestamp));

  return { labels, requests, tokens };
};

export const buildAggregateChartData = (
  window: UsageAggregateWindow | null,
  period: 'hour' | 'day',
  metric: 'requests' | 'tokens',
  selectedModels: string[]
): ChartData => {
  const metricSeries = metric === 'requests' ? window?.requests : window?.tokens;
  const periodSeries = period === 'hour' ? metricSeries?.hour : metricSeries?.day;
  const chartData = buildPeriodSeries(periodSeries, selectedModels);

  if (period === 'day') {
    chartData.labels = formatPeriodLabels(periodSeries?.timestamps, 'day');
  }

  return chartData;
};

export const buildAggregateTokenBreakdown = (
  window: UsageAggregateWindow | null,
  period: 'hour' | 'day'
): TokenBreakdownSeries => {
  const periodSeries =
    period === 'hour' ? window?.token_breakdown_series?.hour : window?.token_breakdown_series?.day;
  return buildCategorySeries(periodSeries?.timestamps, period, periodSeries);
};

export const buildAggregateLatencyTrend = (
  window: UsageAggregateWindow | null,
  period: 'hour' | 'day'
): LatencySeries => {
  const periodSeries = period === 'hour' ? window?.latency_series?.hour : window?.latency_series?.day;
  return buildLatencySeries(periodSeries?.timestamps, period, periodSeries);
};

export const buildAggregateCostTrend = (
  window: UsageAggregateWindow | null,
  modelPrices: Record<string, ModelPrice>,
  period: 'hour' | 'day'
): CostSeries => {
  const periodSeries: UsageAggregateCostBasisSeries | undefined =
    period === 'hour' ? window?.cost_basis?.hour : window?.cost_basis?.day;
  const timestamps = periodSeries?.timestamps ?? [];
  const labels = formatPeriodLabels(timestamps, period);
  const length = timestamps.length;
  const data = new Array(length).fill(0);

  Object.entries(periodSeries?.models ?? {}).forEach(([modelName, series]) => {
    const modelSeries = calculateSeriesCost(series, modelPrices[modelName], length);
    modelSeries.forEach((value, index) => {
      data[index] += value;
    });
  });

  return {
    labels,
    data,
    hasData: data.some((value) => value > 0)
  };
};

const mapApiModelStats = (modelStat: UsageAggregateApiModelStat) => ({
  requests: asNumber(modelStat.requests),
  successCount: asNumber(modelStat.success_count),
  failureCount: asNumber(modelStat.failure_count),
  tokens: asNumber(modelStat.tokens)
});

export const getAggregateApiStats = (
  window: UsageAggregateWindow | null,
  modelPrices: Record<string, ModelPrice>
): ApiStats[] =>
  (window?.apis ?? []).map((stat: UsageAggregateApiStat) => {
    const models = Object.fromEntries(
      Object.entries(stat.models ?? {}).map(([modelName, modelStat]) => [
        modelName,
        mapApiModelStats(modelStat)
      ])
    );

    const totalCost = Object.entries(stat.models ?? {}).reduce((sum, [modelName, modelStat]) => {
      return sum + calculateCostForTokens(modelStat.token_breakdown, modelPrices[modelName]);
    }, 0);

    return {
      endpoint: maskUsageSensitiveValue(stat.endpoint ?? '') || stat.endpoint || '',
      totalRequests: asNumber(stat.total_requests),
      successCount: asNumber(stat.success_count),
      failureCount: asNumber(stat.failure_count),
      totalTokens: asNumber(stat.total_tokens),
      totalCost,
      models
    };
  });

export const getAggregateModelStats = (
  window: UsageAggregateWindow | null,
  modelPrices: Record<string, ModelPrice>
): ModelStatsSummary[] =>
  (window?.models ?? []).map((stat: UsageAggregateModelStat) => {
    const modelName = stat.model ?? '';
    return {
      model: modelName,
      requests: asNumber(stat.requests),
      successCount: asNumber(stat.success_count),
      failureCount: asNumber(stat.failure_count),
      tokens: asNumber(stat.tokens),
      cost: calculateCostForTokens(stat.token_breakdown, modelPrices[modelName]),
      averageLatencyMs: averageLatencyMs(stat.latency),
      totalLatencyMs: asNumber(stat.latency?.total_ms) || null,
      latencySampleCount: asNumber(stat.latency?.count)
    };
  });

export const normalizeAggregateCredentialKey = (credential: UsageAggregateCredentialStat) => ({
  source: normalizeUsageSourceId(credential.source),
  authIndex: normalizeAuthIndex(credential.auth_index)
});
