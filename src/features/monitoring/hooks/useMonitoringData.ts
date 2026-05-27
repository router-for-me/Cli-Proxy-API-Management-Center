import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import type { ApiKeyAlias } from '@/services/api/usageService';
import type { AuthFileItem } from '@/types/authFile';
import type { Config } from '@/types/config';
import type { CredentialInfo } from '@/types/sourceInfo';
import { buildSourceInfoMap, resolveSourceDisplay } from '@/utils/sourceResolver';
import { sha256Hex } from '@/utils/apiKeyHash';
import { maskApiKey, maskSensitiveText } from '@/utils/format';
import { buildLegacyAuthIndexAliases } from '../legacyAuthIndexAliases';
import {
  buildModelPriceIndex,
  calculateCost,
  collectUsageDetailsWithEndpoint,
  extractTotalTokens,
  normalizeAuthIndex,
  type ModelPrice,
  type ModelPriceIndex,
  type UsageDetailWithEndpoint,
} from '@/utils/usage';

type RecordLike = Record<string, unknown>;

const isRecord = (value: unknown): value is RecordLike =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const padNumber = (value: number) => String(value).padStart(2, '0');

const buildLocalDayKey = (timestampMs: number) => {
  const date = new Date(timestampMs);
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
};

const buildHourLabel = (timestampMs: number) => `${padNumber(new Date(timestampMs).getHours())}:00`;

const buildDayLabel = (dayKey: string) => dayKey.slice(5).replace('-', '/');

const startOfTodayMs = (nowMs: number) => {
  const now = new Date(nowMs);
  now.setHours(0, 0, 0, 0);
  return now.getTime();
};

const isValidCustomTimeRange = (
  range: MonitoringCustomTimeRange | null | undefined
): range is MonitoringCustomTimeRange =>
  Boolean(
    range &&
    Number.isFinite(range.startMs) &&
    Number.isFinite(range.endMs) &&
    range.startMs <= range.endMs
  );

export const getRangeBounds = (
  range: MonitoringTimeRange,
  nowMs: number,
  customRange?: MonitoringCustomTimeRange | null
) => {
  if (range === 'custom') {
    return isValidCustomTimeRange(customRange)
      ? { startMs: customRange.startMs, endMs: customRange.endMs }
      : null;
  }

  const todayStart = startOfTodayMs(nowMs);

  switch (range) {
    case 'today':
      return { startMs: todayStart, endMs: nowMs };
    case '7d':
      return { startMs: todayStart - 6 * 24 * 60 * 60 * 1000, endMs: nowMs };
    case '14d':
      return { startMs: todayStart - 13 * 24 * 60 * 60 * 1000, endMs: nowMs };
    case '30d':
      return { startMs: todayStart - 29 * 24 * 60 * 60 * 1000, endMs: nowMs };
    case 'all':
    default:
      return { startMs: Number.NEGATIVE_INFINITY, endMs: nowMs };
  }
};

const shouldUseHourlyTimeline = (
  range: MonitoringTimeRange,
  customRange?: MonitoringCustomTimeRange | null
) =>
  range === 'today' ||
  (range === 'custom' &&
    isValidCustomTimeRange(customRange) &&
    buildLocalDayKey(customRange.startMs) === buildLocalDayKey(customRange.endMs));

const maskEmailLike = (value: string) => {
  const trimmed = value.trim();
  const match = trimmed.match(/^([^@\s]{1,3})[^@\s]*@(.+)$/);
  if (!match) return trimmed;
  return `${match[1]}***@${match[2]}`;
};

const maskAuthIndex = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '-') return '-';
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
};

const parseBoolean = (value: unknown) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(normalized);
  }
  return false;
};

const readString = (value: unknown) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text;
};

const readFiniteNumber = (value: unknown) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
};

const normalizeFacetStrings = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(readString).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right)
  );
};

const normalizeFacetOptions = (
  value: unknown,
  displayMap?: Map<string, ApiKeyDisplayInfo>
): MonitoringFilterOption[] => {
  if (!Array.isArray(value)) return [];
  const options = new Map<string, string>();
  value.forEach((item) => {
    const record = isRecord(item) ? item : null;
    const rawValue = record ? record.value : item;
    const optionValue = readString(rawValue);
    if (!optionValue || options.has(optionValue)) return;
    const display = displayMap?.get(optionValue.toLowerCase());
    const fallbackLabel = record ? readString(record.label) : optionValue;
    options.set(
      optionValue,
      sanitizeApiKeyDisplayText(display?.label || fallbackLabel || optionValue, optionValue)
    );
  });
  return Array.from(options.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
};

export const buildMonitoringFilterFacetsFromSummary = (
  payload: unknown,
  apiKeyDisplayMap?: Map<string, ApiKeyDisplayInfo>
): MonitoringFilterFacets => {
  const facets = isRecord(payload) && isRecord(payload.facets) ? payload.facets : {};
  return {
    providers: normalizeFacetStrings(facets.providers),
    accounts: normalizeFacetOptions(facets.accounts),
    models: normalizeFacetStrings(facets.models),
    channels: normalizeFacetStrings(facets.channels),
    apiKeys: normalizeFacetOptions(facets.api_keys ?? facets.apiKeys, apiKeyDisplayMap),
  };
};

const extractArrayPayload = (payload: unknown, key: string): unknown[] => {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  const candidate = payload[key] ?? payload.items ?? payload.data ?? payload;
  return Array.isArray(candidate) ? candidate : [];
};

const extractHost = (baseUrl: string) => {
  const trimmed = readString(baseUrl);
  if (!trimmed) return '-';

  try {
    return new URL(trimmed).host || trimmed;
  } catch {
    return trimmed.replace(/^https?:\/\//i, '').split('/')[0] || trimmed;
  }
};

const joinUnique = (values: Iterable<string>, limit = 3) => {
  const unique = Array.from(
    new Set(
      Array.from(values)
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
  if (unique.length <= limit) {
    return unique.join(', ');
  }
  return `${unique.slice(0, limit).join(', ')} +${unique.length - limit}`;
};

const buildSearchText = (...parts: Array<string | number | boolean | null | undefined>) =>
  parts
    .map((part) => (part === null || part === undefined ? '' : String(part).trim().toLowerCase()))
    .filter(Boolean)
    .join(' ');

const formatApiKeyHashLabel = (apiKeyHash: string) =>
  apiKeyHash ? `sha256:${apiKeyHash.slice(0, 12)}` : '-';

const UNKNOWN_API_KEY_GROUP_PREFIX = 'unknown-client-api-key';

const sanitizeApiKeyDisplayText = (value: string, fallback = '') => {
  const trimmed = readString(value);
  if (!trimmed) return fallback;
  return maskSensitiveText(trimmed) || fallback;
};

export type ApiKeyDisplayInfo = {
  label: string;
  masked: string;
};

export const buildApiKeyDisplayMap = (
  apiKeys: string[] = [],
  apiKeyAliases: ApiKeyAlias[] = []
): Map<string, ApiKeyDisplayInfo> => {
  const map = new Map<string, ApiKeyDisplayInfo>();
  apiKeys.forEach((apiKey) => {
    const hash = sha256Hex(apiKey).toLowerCase();
    if (!hash || map.has(hash)) return;
    const masked = maskApiKey(apiKey) || formatApiKeyHashLabel(hash);
    map.set(hash, { label: masked, masked });
  });
  apiKeyAliases.forEach((entry) => {
    const hash = readString(entry.apiKeyHash).toLowerCase();
    const alias = sanitizeApiKeyDisplayText(readString(entry.alias));
    if (!hash || !alias) return;
    const existing = map.get(hash);
    map.set(hash, {
      label: alias,
      masked: existing?.masked || existing?.label || formatApiKeyHashLabel(hash),
    });
  });
  return map;
};

const shouldIncludeInStats = (
  row: Pick<MonitoringEventRow, 'failed' | 'inputTokens' | 'outputTokens'>
) => row.failed || row.inputTokens > 0 || row.outputTokens > 0;

const isEffectiveLabel = (value: string) => {
  const trimmed = value.trim();
  return Boolean(trimmed) && trimmed !== '-';
};

const looksLikeMaskedUsageSource = (value: string) => {
  const trimmed = value.trim();
  return trimmed.startsWith('m:') || trimmed.startsWith('k:');
};

const resolveAccountDisplayName = (account: string, channels: Iterable<string>) => {
  const channelLabels = Array.from(new Set(Array.from(channels).filter(isEffectiveLabel)));
  if (looksLikeMaskedUsageSource(account) && channelLabels.length === 1) {
    return channelLabels[0];
  }
  return account || channelLabels[0] || '-';
};

type MonitoringChannelMeta = {
  key: string;
  name: string;
  baseUrl: string;
  host: string;
  disabled: boolean;
  authIndices: string[];
  modelNames: string[];
};

type MonitoringAuthMeta = {
  authIndex: string;
  label: string;
  account: string;
  provider: string;
  status: string;
  disabled: boolean;
  unavailable: boolean;
  runtimeOnly: boolean;
  planType: string;
  updatedAt: string;
};

export type MonitoringTimeRange = 'today' | '7d' | '14d' | '30d' | 'all' | 'custom';

export type MonitoringCustomTimeRange = {
  startMs: number;
  endMs: number;
};

export type MonitoringStatusTone = 'good' | 'warn' | 'bad';

export type MonitoringStatusChip = {
  key: string;
  label: string;
  value: string;
  tone: MonitoringStatusTone;
};

export type MonitoringKpi = {
  key: string;
  label: string;
  value: number;
  meta: number;
};

export type MonitoringTimelinePoint = {
  label: string;
  requests: number;
  tokens: number;
  cost: number;
};

export type MonitoringModelShareRow = {
  model: string;
  requests: number;
  totalTokens: number;
  totalCost: number;
  successRate: number;
};

export type MonitoringChannelRow = {
  id: string;
  label: string;
  host: string;
  provider: string;
  planTypes: string[];
  disabled: boolean;
  authCount: number;
  modelCount: number;
  requests: number;
  failures: number;
  successRate: number;
  totalTokens: number;
  totalCost: number;
  averageLatencyMs: number | null;
  authLabels: string[];
};

export type MonitoringModelRow = {
  model: string;
  requests: number;
  failures: number;
  successRate: number;
  totalTokens: number;
  totalCost: number;
  averageLatencyMs: number | null;
  sources: number;
  channels: number;
};

export type MonitoringFailureSourceRow = {
  id: string;
  label: string;
  channel: string;
  failures: number;
  totalRequests: number;
  failureRate: number;
  lastSeenAt: number;
  averageLatencyMs: number | null;
};

export type MonitoringTaskBucketRow = {
  id: string;
  timestampMs: number;
  timestamp: string;
  source: string;
  sourceMasked: string;
  channel: string;
  authLabel: string;
  planType: string;
  calls: number;
  failedCalls: number;
  failed: boolean;
  modelsText: string;
  totalTokens: number;
  totalCost: number;
  averageLatencyMs: number | null;
  maxLatencyMs: number | null;
  endpointsText: string;
};

export type MonitoringFailureRow = {
  id: string;
  timestampMs: number;
  timestamp: string;
  model: string;
  source: string;
  channel: string;
  authIndex: string;
  latencyMs: number | null;
};

export type MonitoringEventRow = {
  id: string;
  timestamp: string;
  timestampMs: number;
  dayKey: string;
  hourLabel: string;
  model: string;
  resolvedModel?: string;
  endpoint: string;
  endpointMethod: string;
  endpointPath: string;
  sourceKey: string;
  source: string;
  sourceMasked: string;
  account: string;
  accountMasked: string;
  authIndex: string;
  authIndexMasked: string;
  authLabel: string;
  apiKeyHash: string;
  apiKeyLabel: string;
  apiKeyMasked: string;
  provider: string;
  projectId: string;
  planType: string;
  channel: string;
  channelHost: string;
  channelDisabled: boolean;
  failed: boolean;
  requestCount: number;
  successCalls: number;
  failureCalls: number;
  statsIncluded: boolean;
  latencyMs: number | null;
  latencySumMs: number;
  latencyCount: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  totalCost: number;
  taskKey: string;
  searchText: string;
};

export type MonitoringSummary = {
  totalCalls: number;
  successCalls: number;
  failureCalls: number;
  successRate: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
  totalCost: number;
  averageLatencyMs: number | null;
  rpm30m: number;
  tpm30m: number;
  avgDailyRequests: number;
  avgDailyTokens: number;
  approxTasks: number;
  approxTaskFailures: number;
  approxTaskSuccessRate: number;
  zeroTokenCalls: number;
  zeroTokenModels: string[];
};

export type MonitoringAccountModelSpendRow = {
  model: string;
  totalCalls: number;
  successCalls: number;
  failureCalls: number;
  successRate: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  totalCost: number;
  lastSeenAt: number;
};

export type MonitoringAccountRow = {
  id: string;
  account: string;
  displayAccount: string;
  accountMasked: string;
  authLabels: string[];
  authIndices: string[];
  channels: string[];
  totalCalls: number;
  successCalls: number;
  failureCalls: number;
  successRate: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  totalCost: number;
  averageLatencyMs: number | null;
  lastSeenAt: number;
  recentPattern: boolean[];
  models: MonitoringAccountModelSpendRow[];
};

export type MonitoringApiKeyModelSpendRow = MonitoringAccountModelSpendRow;

export type MonitoringApiKeyRow = {
  id: string;
  apiKeyHash: string;
  apiKeyLabel: string;
  apiKeyMasked: string;
  isUnknown: boolean;
  authLabels: string[];
  sourceLabels: string[];
  channels: string[];
  totalCalls: number;
  successCalls: number;
  failureCalls: number;
  successRate: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  totalCost: number;
  averageLatencyMs: number | null;
  lastSeenAt: number;
  models: MonitoringApiKeyModelSpendRow[];
};

export type MonitoringFilterOption = {
  value: string;
  label: string;
};

export type MonitoringFilterFacets = {
  providers: string[];
  accounts: MonitoringFilterOption[];
  models: string[];
  channels: string[];
  apiKeys: MonitoringFilterOption[];
};

export type MonitoringRealtimeRow = {
  id: string;
  account: string;
  accountMasked: string;
  authLabel: string;
  authIndexMasked: string;
  provider: string;
  requestType: string;
  model: string;
  channel: string;
  latestFailed: boolean;
  successRate: number;
  totalCalls: number;
  successCalls: number;
  failureCalls: number;
  averageLatencyMs: number | null;
  latestLatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  totalCost: number;
  lastSeenAt: number;
  recentPattern: boolean[];
};

export type MonitoringMetadata = {
  totalAuthFiles: number;
  activeAuthFiles: number;
  unavailableAuthFiles: number;
  runtimeOnlyAuthFiles: number;
  totalChannels: number;
  enabledChannels: number;
  configuredModels: number;
  planTypes: string[];
};

export interface UseMonitoringDataParams {
  usage: unknown;
  usagePages?: {
    accounts?: { usage?: unknown; items?: unknown[] } | null;
    apiKeys?: { usage?: unknown; items?: unknown[] } | null;
    realtime?: { usage?: unknown; items?: unknown[] } | null;
    models?: { usage?: unknown } | null;
  } | null;
  config: Config | null | undefined;
  modelPrices: Record<string, ModelPrice>;
  apiKeyAliases?: ApiKeyAlias[];
  timeRange: MonitoringTimeRange;
  customTimeRange?: MonitoringCustomTimeRange | null;
  searchQuery: string;
  searchApiKeyHash?: string;
}

export interface UseMonitoringDataReturn {
  loading: boolean;
  error: string;
  authFiles: AuthFileItem[];
  channels: MonitoringChannelMeta[];
  summary: MonitoringSummary;
  metadata: MonitoringMetadata;
  statusChips: MonitoringStatusChip[];
  timeline: MonitoringTimelinePoint[];
  timelineGranularity: 'hour' | 'day';
  hourlyDistribution: MonitoringTimelinePoint[];
  modelShareRows: MonitoringModelShareRow[];
  channelRows: MonitoringChannelRow[];
  modelRows: MonitoringModelRow[];
  failureSourceRows: MonitoringFailureSourceRow[];
  taskBuckets: MonitoringTaskBucketRow[];
  recentFailures: MonitoringFailureRow[];
  filteredRows: MonitoringEventRow[];
  accountPageRows: MonitoringAccountRow[] | null;
  apiKeyPageRows: MonitoringApiKeyRow[] | null;
  realtimePageRows: MonitoringEventRow[] | null;
  filterFacets: MonitoringFilterFacets;
  refreshMeta: (showLoading?: boolean) => Promise<void>;
}

type MonitoringMetaPayload = {
  authFiles: AuthFileItem[];
  channels: MonitoringChannelMeta[];
  error: string;
};

const normalizeOpenAIChannel = (value: unknown, index: number): MonitoringChannelMeta | null => {
  if (!isRecord(value)) return null;

  const name = readString(value.name || value.id) || `openai-${index + 1}`;
  const baseUrl = readString(value['base-url'] ?? value.baseUrl);
  if (!baseUrl) return null;

  const authIndices = new Set<string>();
  const providerAuthIndex = normalizeAuthIndex(
    value['auth-index'] ?? value.authIndex ?? value['auth_index']
  );
  if (providerAuthIndex) {
    authIndices.add(providerAuthIndex);
  }

  const apiKeyEntries = Array.isArray(value['api-key-entries']) ? value['api-key-entries'] : [];
  apiKeyEntries.forEach((entry) => {
    if (!isRecord(entry)) return;
    const authIndex = normalizeAuthIndex(
      entry['auth-index'] ?? entry.authIndex ?? entry['auth_index']
    );
    if (authIndex) {
      authIndices.add(authIndex);
    }
  });

  const modelNames = Array.isArray(value.models)
    ? value.models
        .map((item) => {
          if (typeof item === 'string') return readString(item);
          if (!isRecord(item)) return '';
          return readString(item.name ?? item.alias ?? item.id ?? item.model);
        })
        .filter(Boolean)
    : [];

  return {
    key: `${name}:${index}`,
    name,
    baseUrl,
    host: extractHost(baseUrl),
    disabled: parseBoolean(value.disabled),
    authIndices: Array.from(authIndices),
    modelNames: Array.from(new Set(modelNames)),
  };
};

const readAuthTimestamp = (entry: AuthFileItem) =>
  readString(entry['updated_at'] ?? entry.updatedAt ?? entry['modtime'] ?? entry.modified);

const normalizeAuthMeta = (entry: AuthFileItem): MonitoringAuthMeta | null => {
  const authIndex = normalizeAuthIndex(entry['auth_index'] ?? entry.authIndex);
  if (!authIndex) return null;

  const label =
    readString(entry.label) ||
    readString(entry.name) ||
    readString(entry.email) ||
    readString(entry.account) ||
    authIndex;

  const planType = readString(
    isRecord(entry.id_token) ? entry.id_token.plan_type : entry['plan_type']
  );

  return {
    authIndex,
    label,
    account: readString(entry.account) || readString(entry.email) || label,
    provider: readString(entry.provider) || readString(entry.type) || '-',
    status: readString(entry.status) || 'unknown',
    disabled: parseBoolean(entry.disabled),
    unavailable: parseBoolean(entry.unavailable),
    runtimeOnly: parseBoolean(entry.runtime_only ?? entry.runtimeOnly),
    planType: planType || '-',
    updatedAt: readAuthTimestamp(entry),
  };
};

export const buildMonitoringAuthMetaMap = (
  authFiles: AuthFileItem[]
): Map<string, MonitoringAuthMeta> => {
  const map = new Map<string, MonitoringAuthMeta>();
  authFiles.forEach((entry) => {
    const normalized = normalizeAuthMeta(entry);
    if (!normalized) return;

    map.set(normalized.authIndex, normalized);
    buildLegacyAuthIndexAliases(entry).forEach((alias) => {
      if (!map.has(alias)) {
        map.set(alias, normalized);
      }
    });
  });
  return map;
};

export const buildRangeFilteredRows = (
  rows: MonitoringEventRow[],
  timeRange: MonitoringTimeRange,
  customTimeRange: MonitoringCustomTimeRange | null | undefined,
  searchQuery: string,
  searchApiKeyHash?: string
) => {
  const nowMs = Date.now();
  const bounds = getRangeBounds(timeRange, nowMs, customTimeRange);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const normalizedSearchApiKeyHash = String(searchApiKeyHash || '')
    .trim()
    .toLowerCase();
  if (!bounds) return [];

  return rows.filter((row) => {
    if (row.timestampMs < bounds.startMs || row.timestampMs > bounds.endMs) {
      return false;
    }

    if (normalizedQuery || normalizedSearchApiKeyHash) {
      const matchesText = normalizedQuery ? row.searchText.includes(normalizedQuery) : false;
      const matchesAPIKeyHash = normalizedSearchApiKeyHash
        ? row.apiKeyHash === normalizedSearchApiKeyHash
        : false;
      if (!matchesText && !matchesAPIKeyHash) {
        return false;
      }
    }

    return true;
  });
};

const buildTimeline = (
  rows: MonitoringEventRow[],
  timeRange: MonitoringTimeRange,
  customTimeRange?: MonitoringCustomTimeRange | null
): { granularity: 'hour' | 'day'; points: MonitoringTimelinePoint[] } => {
  if (shouldUseHourlyTimeline(timeRange, customTimeRange)) {
    const map = new Map<string, MonitoringTimelinePoint>();

    for (let hour = 0; hour < 24; hour += 1) {
      const label = `${padNumber(hour)}:00`;
      map.set(label, { label, requests: 0, tokens: 0, cost: 0 });
    }

    rows.forEach((row) => {
      const bucket = map.get(row.hourLabel);
      if (!bucket) return;
      bucket.requests += row.requestCount;
      bucket.tokens += row.totalTokens;
      bucket.cost += row.totalCost;
    });

    return { granularity: 'hour', points: Array.from(map.values()) };
  }

  const grouped = new Map<string, MonitoringTimelinePoint>();

  rows.forEach((row) => {
    const existing = grouped.get(row.dayKey) ?? {
      label: buildDayLabel(row.dayKey),
      requests: 0,
      tokens: 0,
      cost: 0,
    };
    existing.requests += row.requestCount;
    existing.tokens += row.totalTokens;
    existing.cost += row.totalCost;
    grouped.set(row.dayKey, existing);
  });

  const sortedKeys = Array.from(grouped.keys()).sort((left, right) => left.localeCompare(right));
  const limitedKeys =
    sortedKeys.length > 30 ? sortedKeys.slice(sortedKeys.length - 30) : sortedKeys;

  return {
    granularity: 'day',
    points: limitedKeys.map((key) => grouped.get(key)!).filter(Boolean),
  };
};

const buildHourlyDistribution = (rows: MonitoringEventRow[]) => {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    label: `${padNumber(hour)}:00`,
    requests: 0,
    tokens: 0,
    cost: 0,
  }));

  rows.forEach((row) => {
    const hour = Number(row.hourLabel.slice(0, 2));
    const bucket = Number.isFinite(hour) ? buckets[hour] : null;
    if (!bucket) return;
    bucket.requests += row.requestCount;
    bucket.tokens += row.totalTokens;
    bucket.cost += row.totalCost;
  });

  return buckets;
};

const buildRecentPattern = (rows: MonitoringEventRow[], limit = 10) =>
  rows
    .slice()
    .sort((left, right) => right.timestampMs - left.timestampMs)
    .slice(0, limit)
    .reverse()
    .map((row) => !row.failed);

export const buildMonitoringSummary = (rows: MonitoringEventRow[]): MonitoringSummary => {
  const totalCalls = rows.reduce((sum, row) => sum + row.requestCount, 0);
  const failureCalls = rows.reduce((sum, row) => sum + row.failureCalls, 0);
  const successCalls = Math.max(totalCalls - failureCalls, 0);
  const inputTokens = rows.reduce((sum, row) => sum + row.inputTokens, 0);
  const outputTokens = rows.reduce((sum, row) => sum + row.outputTokens, 0);
  const reasoningTokens = rows.reduce((sum, row) => sum + row.reasoningTokens, 0);
  const cachedTokens = rows.reduce((sum, row) => sum + row.cachedTokens, 0);
  const totalTokens = rows.reduce((sum, row) => sum + row.totalTokens, 0);
  const totalCost = rows.reduce((sum, row) => sum + row.totalCost, 0);

  let latencySum = 0;
  let latencyCount = 0;
  rows.forEach((row) => {
    latencySum += row.latencySumMs;
    latencyCount += row.latencyCount;
  });

  const taskMap = new Map<string, boolean>();
  rows.forEach((row) => {
    const existing = taskMap.get(row.taskKey) ?? false;
    taskMap.set(row.taskKey, existing || row.failed);
  });

  const approxTasks = taskMap.size;
  const approxTaskFailures = Array.from(taskMap.values()).filter(Boolean).length;
  const zeroTokenRows = rows.filter((row) => row.totalTokens === 0);

  const activeDays = new Set(rows.map((row) => row.dayKey));
  const activeDayCount = Math.max(activeDays.size, 1);
  const nowMs = Date.now();
  const windowStart = nowMs - 30 * 60 * 1000;
  const recentRows = rows.filter(
    (row) => row.timestampMs >= windowStart && row.timestampMs <= nowMs
  );
  const recentCalls = recentRows.reduce((sum, row) => sum + row.requestCount, 0);
  const recentTokens = recentRows.reduce((sum, row) => sum + row.totalTokens, 0);

  return {
    totalCalls,
    successCalls,
    failureCalls,
    successRate: totalCalls > 0 ? successCalls / totalCalls : 1,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens,
    totalTokens,
    totalCost,
    averageLatencyMs: latencyCount > 0 ? latencySum / latencyCount : null,
    rpm30m: recentCalls / 30,
    tpm30m: recentTokens / 30,
    avgDailyRequests: totalCalls / activeDayCount,
    avgDailyTokens: totalTokens / activeDayCount,
    approxTasks,
    approxTaskFailures,
    approxTaskSuccessRate:
      approxTasks > 0 ? Math.max(approxTasks - approxTaskFailures, 0) / approxTasks : 1,
    zeroTokenCalls: zeroTokenRows.reduce((sum, row) => sum + row.requestCount, 0),
    zeroTokenModels: Array.from(new Set(zeroTokenRows.map((row) => row.model))).sort(),
  };
};

const buildAggregateMonitoringSummary = (
  usage: unknown,
  modelRows: MonitoringEventRow[] | null,
  fallbackRows: MonitoringEventRow[]
): MonitoringSummary => {
  const rowsSummary = buildMonitoringSummary(modelRows ?? fallbackRows);
  if (!modelRows || !isRecord(usage)) {
    return rowsSummary;
  }

  const tokens = isRecord(usage.tokens) ? usage.tokens : {};
  const totalCalls = readFiniteNumber(usage.total_requests);
  const successCalls = readFiniteNumber(usage.success_count);
  const failureCalls = readFiniteNumber(usage.failure_count);
  const inputTokens = readFiniteNumber(tokens.input_tokens);
  const outputTokens = readFiniteNumber(tokens.output_tokens);
  const reasoningTokens = readFiniteNumber(tokens.reasoning_tokens);
  const cachedTokens = Math.max(
    readFiniteNumber(tokens.cached_tokens),
    readFiniteNumber(tokens.cache_tokens)
  );
  const totalTokens = readFiniteNumber(usage.total_tokens ?? tokens.total_tokens);
  const latencyCount = readFiniteNumber(usage.latency_count);
  const latencySum = readFiniteNumber(usage.latency_sum_ms);
  const averageLatencyMs =
    latencyCount > 0
      ? latencySum / latencyCount
      : Number.isFinite(Number(usage.latency_ms))
        ? Number(usage.latency_ms)
        : null;

  return {
    ...rowsSummary,
    totalCalls,
    successCalls,
    failureCalls,
    successRate: totalCalls > 0 ? successCalls / totalCalls : 1,
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedTokens,
    totalTokens,
    averageLatencyMs,
  };
};

export const buildAccountRows = (rows: MonitoringEventRow[]): MonitoringAccountRow[] => {
  const grouped = new Map<
    string,
    {
      id: string;
      account: string;
      accountMasked: string;
      authLabels: Set<string>;
      authIndices: Set<string>;
      channels: Set<string>;
      modelMap: Map<
        string,
        {
          model: string;
          totalCalls: number;
          successCalls: number;
          failureCalls: number;
          inputTokens: number;
          outputTokens: number;
          cachedTokens: number;
          totalTokens: number;
          totalCost: number;
          lastSeenAt: number;
        }
      >;
      rows: MonitoringEventRow[];
      totalCalls: number;
      successCalls: number;
      failureCalls: number;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      totalTokens: number;
      totalCost: number;
      latencySum: number;
      latencyCount: number;
      lastSeenAt: number;
    }
  >();

  rows.forEach((row) => {
    const accountKey = row.account || row.authLabel || row.source;
    const existing = grouped.get(accountKey) ?? {
      id: accountKey,
      account: row.account,
      accountMasked: row.accountMasked,
      authLabels: new Set<string>(),
      authIndices: new Set<string>(),
      channels: new Set<string>(),
      modelMap: new Map(),
      rows: [] as MonitoringEventRow[],
      totalCalls: 0,
      successCalls: 0,
      failureCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      latencySum: 0,
      latencyCount: 0,
      lastSeenAt: 0,
    };

    existing.rows.push(row);
    existing.authLabels.add(row.authLabel);
    existing.authIndices.add(row.authIndex);
    existing.channels.add(row.channel);
    existing.totalCalls += row.requestCount;
    existing.successCalls += row.successCalls;
    existing.failureCalls += row.failureCalls;
    existing.inputTokens += row.inputTokens;
    existing.outputTokens += row.outputTokens;
    existing.cachedTokens += row.cachedTokens;
    existing.totalTokens += row.totalTokens;
    existing.totalCost += row.totalCost;
    existing.lastSeenAt = Math.max(existing.lastSeenAt, row.timestampMs);

    if (row.latencyMs !== null) {
      existing.latencySum += row.latencySumMs;
      existing.latencyCount += row.latencyCount;
    }

    const modelEntry = existing.modelMap.get(row.model) ?? {
      model: row.model,
      totalCalls: 0,
      successCalls: 0,
      failureCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      lastSeenAt: 0,
    };

    modelEntry.totalCalls += row.requestCount;
    modelEntry.successCalls += row.successCalls;
    modelEntry.failureCalls += row.failureCalls;
    modelEntry.inputTokens += row.inputTokens;
    modelEntry.outputTokens += row.outputTokens;
    modelEntry.cachedTokens += row.cachedTokens;
    modelEntry.totalTokens += row.totalTokens;
    modelEntry.totalCost += row.totalCost;
    modelEntry.lastSeenAt = Math.max(modelEntry.lastSeenAt, row.timestampMs);
    existing.modelMap.set(row.model, modelEntry);

    grouped.set(accountKey, existing);
  });

  return Array.from(grouped.values())
    .map((item) => {
      const channels = Array.from(item.channels).sort();
      return {
        id: item.id,
        account: item.account,
        displayAccount: resolveAccountDisplayName(item.account, channels),
        accountMasked: item.accountMasked,
        authLabels: Array.from(item.authLabels).sort(),
        authIndices: Array.from(item.authIndices).sort(),
        channels,
        totalCalls: item.totalCalls,
        successCalls: item.successCalls,
        failureCalls: item.failureCalls,
        successRate: item.totalCalls > 0 ? item.successCalls / item.totalCalls : 1,
        inputTokens: item.inputTokens,
        outputTokens: item.outputTokens,
        cachedTokens: item.cachedTokens,
        totalTokens: item.totalTokens,
        totalCost: item.totalCost,
        averageLatencyMs: item.latencyCount > 0 ? item.latencySum / item.latencyCount : null,
        lastSeenAt: item.lastSeenAt,
        recentPattern: buildRecentPattern(item.rows),
        models: Array.from(item.modelMap.values())
          .map((model) => ({
            ...model,
            successRate: model.totalCalls > 0 ? model.successCalls / model.totalCalls : 1,
          }))
          .sort(
            (left, right) => right.totalCost - left.totalCost || right.totalCalls - left.totalCalls
          ),
      };
    })
    .sort(
      (left, right) =>
        right.lastSeenAt - left.lastSeenAt ||
        right.totalCalls - left.totalCalls ||
        right.totalCost - left.totalCost
    );
};

const shouldPreferApiKeyAlias = (label: string, masked: string) =>
  Boolean(label) && label !== masked && !label.startsWith('sha256:');

export const buildApiKeyRows = (rows: MonitoringEventRow[]): MonitoringApiKeyRow[] => {
  const grouped = new Map<
    string,
    {
      id: string;
      apiKeyHash: string;
      apiKeyLabel: string;
      apiKeyMasked: string;
      isUnknown: boolean;
      authLabels: Set<string>;
      sourceLabels: Set<string>;
      channels: Set<string>;
      modelMap: Map<
        string,
        {
          model: string;
          totalCalls: number;
          successCalls: number;
          failureCalls: number;
          inputTokens: number;
          outputTokens: number;
          cachedTokens: number;
          totalTokens: number;
          totalCost: number;
          lastSeenAt: number;
        }
      >;
      totalCalls: number;
      successCalls: number;
      failureCalls: number;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      totalTokens: number;
      totalCost: number;
      latencySum: number;
      latencyCount: number;
      lastSeenAt: number;
    }
  >();

  rows.forEach((row) => {
    const hasKnownApiKey = Boolean(row.apiKeyHash || row.apiKeyLabel || row.apiKeyMasked);
    const apiKeyGroupKey = hasKnownApiKey
      ? row.apiKeyHash || row.apiKeyLabel || row.apiKeyMasked
      : `${UNKNOWN_API_KEY_GROUP_PREFIX}:${row.sourceKey}:${row.authIndex || row.authLabel || '-'}:${row.channel || '-'}:${row.provider || '-'}`;
    const existing = grouped.get(apiKeyGroupKey) ?? {
      id: apiKeyGroupKey,
      apiKeyHash: row.apiKeyHash,
      apiKeyLabel: sanitizeApiKeyDisplayText(row.apiKeyLabel),
      apiKeyMasked: sanitizeApiKeyDisplayText(row.apiKeyMasked),
      isUnknown: !hasKnownApiKey,
      authLabels: new Set<string>(),
      sourceLabels: new Set<string>(),
      channels: new Set<string>(),
      modelMap: new Map(),
      totalCalls: 0,
      successCalls: 0,
      failureCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      latencySum: 0,
      latencyCount: 0,
      lastSeenAt: 0,
    };

    if (!existing.apiKeyHash && row.apiKeyHash) {
      existing.apiKeyHash = row.apiKeyHash;
    }
    if (!existing.apiKeyMasked && row.apiKeyMasked) {
      existing.apiKeyMasked = sanitizeApiKeyDisplayText(row.apiKeyMasked);
    }
    if (
      shouldPreferApiKeyAlias(row.apiKeyLabel, row.apiKeyMasked) &&
      !shouldPreferApiKeyAlias(existing.apiKeyLabel, existing.apiKeyMasked)
    ) {
      existing.apiKeyLabel = sanitizeApiKeyDisplayText(row.apiKeyLabel, existing.apiKeyLabel);
    }
    existing.authLabels.add(row.authLabel);
    existing.sourceLabels.add(row.sourceMasked || row.source);
    existing.channels.add(row.channel);

    existing.totalCalls += row.requestCount;
    existing.successCalls += row.successCalls;
    existing.failureCalls += row.failureCalls;
    existing.inputTokens += row.inputTokens;
    existing.outputTokens += row.outputTokens;
    existing.cachedTokens += row.cachedTokens;
    existing.totalTokens += row.totalTokens;
    existing.totalCost += row.totalCost;
    existing.lastSeenAt = Math.max(existing.lastSeenAt, row.timestampMs);

    if (row.latencyMs !== null) {
      existing.latencySum += row.latencySumMs;
      existing.latencyCount += row.latencyCount;
    }

    const modelEntry = existing.modelMap.get(row.model) ?? {
      model: row.model,
      totalCalls: 0,
      successCalls: 0,
      failureCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      lastSeenAt: 0,
    };

    modelEntry.totalCalls += row.requestCount;
    modelEntry.successCalls += row.successCalls;
    modelEntry.failureCalls += row.failureCalls;
    modelEntry.inputTokens += row.inputTokens;
    modelEntry.outputTokens += row.outputTokens;
    modelEntry.cachedTokens += row.cachedTokens;
    modelEntry.totalTokens += row.totalTokens;
    modelEntry.totalCost += row.totalCost;
    modelEntry.lastSeenAt = Math.max(modelEntry.lastSeenAt, row.timestampMs);
    existing.modelMap.set(row.model, modelEntry);

    grouped.set(apiKeyGroupKey, existing);
  });

  return Array.from(grouped.values())
    .map((item) => ({
      id: item.id,
      apiKeyHash: item.apiKeyHash,
      apiKeyLabel: item.apiKeyLabel || item.apiKeyMasked || formatApiKeyHashLabel(item.apiKeyHash),
      apiKeyMasked: item.apiKeyMasked || item.apiKeyLabel || formatApiKeyHashLabel(item.apiKeyHash),
      isUnknown: item.isUnknown,
      authLabels: Array.from(item.authLabels).filter(Boolean).sort(),
      sourceLabels: Array.from(item.sourceLabels).filter(Boolean).sort(),
      channels: Array.from(item.channels).filter(Boolean).sort(),
      totalCalls: item.totalCalls,
      successCalls: item.successCalls,
      failureCalls: item.failureCalls,
      successRate: item.totalCalls > 0 ? item.successCalls / item.totalCalls : 1,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      cachedTokens: item.cachedTokens,
      totalTokens: item.totalTokens,
      totalCost: item.totalCost,
      averageLatencyMs: item.latencyCount > 0 ? item.latencySum / item.latencyCount : null,
      lastSeenAt: item.lastSeenAt,
      models: Array.from(item.modelMap.values())
        .map((model) => ({
          ...model,
          successRate: model.totalCalls > 0 ? model.successCalls / model.totalCalls : 1,
        }))
        .sort(
          (left, right) => right.totalCost - left.totalCost || right.totalCalls - left.totalCalls
        ),
    }))
    .sort(
      (left, right) =>
        right.lastSeenAt - left.lastSeenAt ||
        right.totalCalls - left.totalCalls ||
        right.totalCost - left.totalCost
    );
};

export const buildRealtimeMonitorRows = (rows: MonitoringEventRow[]): MonitoringRealtimeRow[] => {
  const grouped = new Map<
    string,
    {
      id: string;
      account: string;
      accountMasked: string;
      authLabel: string;
      authIndexMasked: string;
      provider: string;
      requestType: string;
      model: string;
      channel: string;
      rows: MonitoringEventRow[];
      latestFailed: boolean;
      successCalls: number;
      failureCalls: number;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      totalTokens: number;
      totalCost: number;
      latencySum: number;
      latencyCount: number;
      latestLatencyMs: number | null;
      lastSeenAt: number;
    }
  >();

  rows.forEach((row) => {
    const requestType = `${row.endpointMethod} ${row.endpointPath}`.trim();
    const key = [
      row.account || row.authLabel || row.source,
      row.authIndexMasked,
      row.provider,
      row.model,
      row.channel,
      requestType,
    ].join('::');

    const existing = grouped.get(key) ?? {
      id: key,
      account: row.account,
      accountMasked: row.accountMasked,
      authLabel: row.authLabel,
      authIndexMasked: row.authIndexMasked,
      provider: row.provider,
      requestType,
      model: row.model,
      channel: row.channel,
      rows: [] as MonitoringEventRow[],
      latestFailed: row.failed,
      successCalls: 0,
      failureCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      latencySum: 0,
      latencyCount: 0,
      latestLatencyMs: null,
      lastSeenAt: 0,
    };

    existing.rows.push(row);
    existing.successCalls += row.successCalls;
    existing.failureCalls += row.failureCalls;
    existing.inputTokens += row.inputTokens;
    existing.outputTokens += row.outputTokens;
    existing.cachedTokens += row.cachedTokens;
    existing.totalTokens += row.totalTokens;
    existing.totalCost += row.totalCost;

    if (row.timestampMs >= existing.lastSeenAt) {
      existing.lastSeenAt = row.timestampMs;
      existing.latestFailed = row.failed;
      existing.latestLatencyMs = row.latencyMs;
    }

    if (row.latencyMs !== null) {
      existing.latencySum += row.latencySumMs;
      existing.latencyCount += row.latencyCount;
    }

    grouped.set(key, existing);
  });

  return Array.from(grouped.values())
    .map((item) => {
      const totalCalls = item.successCalls + item.failureCalls;
      return {
        id: item.id,
        account: item.account,
        accountMasked: item.accountMasked,
        authLabel: item.authLabel,
        authIndexMasked: item.authIndexMasked,
        provider: item.provider,
        requestType: item.requestType,
        model: item.model,
        channel: item.channel,
        latestFailed: item.latestFailed,
        successRate: totalCalls > 0 ? item.successCalls / totalCalls : 1,
        totalCalls,
        successCalls: item.successCalls,
        failureCalls: item.failureCalls,
        averageLatencyMs: item.latencyCount > 0 ? item.latencySum / item.latencyCount : null,
        latestLatencyMs: item.latestLatencyMs,
        inputTokens: item.inputTokens,
        outputTokens: item.outputTokens,
        cachedTokens: item.cachedTokens,
        totalTokens: item.totalTokens,
        totalCost: item.totalCost,
        lastSeenAt: item.lastSeenAt,
        recentPattern: buildRecentPattern(item.rows),
      };
    })
    .sort(
      (left, right) => right.lastSeenAt - left.lastSeenAt || right.totalCalls - left.totalCalls
    );
};

const buildStatusChips = (metadata: MonitoringMetadata): MonitoringStatusChip[] => [
  {
    key: 'credentials',
    label: 'credentials',
    value: `${metadata.activeAuthFiles}/${metadata.totalAuthFiles}`,
    tone:
      metadata.totalAuthFiles === 0 ? 'warn' : metadata.unavailableAuthFiles > 0 ? 'warn' : 'good',
  },
  {
    key: 'channels',
    label: 'channels',
    value: `${metadata.enabledChannels}/${metadata.totalChannels}`,
    tone:
      metadata.enabledChannels === 0
        ? 'bad'
        : metadata.enabledChannels < metadata.totalChannels
          ? 'warn'
          : 'good',
  },
  {
    key: 'runtime_only',
    label: 'runtime_only',
    value: String(metadata.runtimeOnlyAuthFiles),
    tone: metadata.runtimeOnlyAuthFiles > 0 ? 'warn' : 'good',
  },
  {
    key: 'models',
    label: 'models',
    value: String(metadata.configuredModels),
    tone: metadata.configuredModels > 0 ? 'good' : 'warn',
  },
];

const buildModelShareRows = (rows: MonitoringEventRow[]) => {
  const grouped = new Map<
    string,
    { model: string; requests: number; failures: number; totalTokens: number; totalCost: number }
  >();

  rows.forEach((row) => {
    const existing = grouped.get(row.model) ?? {
      model: row.model,
      requests: 0,
      failures: 0,
      totalTokens: 0,
      totalCost: 0,
    };
    existing.requests += row.requestCount;
    existing.failures += row.failureCalls;
    existing.totalTokens += row.totalTokens;
    existing.totalCost += row.totalCost;
    grouped.set(row.model, existing);
  });

  return Array.from(grouped.values())
    .map((item) => ({
      model: item.model,
      requests: item.requests,
      totalTokens: item.totalTokens,
      totalCost: item.totalCost,
      successRate: item.requests > 0 ? (item.requests - item.failures) / item.requests : 1,
    }))
    .sort((left, right) => right.requests - left.requests);
};

const buildChannelRows = (rows: MonitoringEventRow[]) => {
  const grouped = new Map<
    string,
    {
      id: string;
      label: string;
      host: string;
      provider: string;
      disabled: boolean;
      authLabels: Set<string>;
      planTypes: Set<string>;
      models: Set<string>;
      requests: number;
      failures: number;
      totalTokens: number;
      totalCost: number;
      latencySum: number;
      latencyCount: number;
    }
  >();

  rows.forEach((row) => {
    const key = `${row.channel}::${row.channelHost}`;
    const existing = grouped.get(key) ?? {
      id: key,
      label: row.channel,
      host: row.channelHost,
      provider: row.provider,
      disabled: row.channelDisabled,
      authLabels: new Set<string>(),
      planTypes: new Set<string>(),
      models: new Set<string>(),
      requests: 0,
      failures: 0,
      totalTokens: 0,
      totalCost: 0,
      latencySum: 0,
      latencyCount: 0,
    };
    existing.disabled = existing.disabled || row.channelDisabled;
    existing.authLabels.add(row.authLabel);
    if (row.planType && row.planType !== '-') {
      existing.planTypes.add(row.planType);
    }
    existing.models.add(row.model);
    existing.requests += row.requestCount;
    existing.failures += row.failureCalls;
    existing.totalTokens += row.totalTokens;
    existing.totalCost += row.totalCost;
    if (row.latencyMs !== null) {
      existing.latencySum += row.latencySumMs;
      existing.latencyCount += row.latencyCount;
    }
    grouped.set(key, existing);
  });

  return Array.from(grouped.values())
    .map((item) => ({
      id: item.id,
      label: item.label,
      host: item.host,
      provider: item.provider,
      planTypes: Array.from(item.planTypes).sort(),
      disabled: item.disabled,
      authCount: item.authLabels.size,
      modelCount: item.models.size,
      requests: item.requests,
      failures: item.failures,
      successRate: item.requests > 0 ? (item.requests - item.failures) / item.requests : 1,
      totalTokens: item.totalTokens,
      totalCost: item.totalCost,
      averageLatencyMs: item.latencyCount > 0 ? item.latencySum / item.latencyCount : null,
      authLabels: Array.from(item.authLabels).sort(),
    }))
    .sort((left, right) => right.requests - left.requests);
};

const buildModelRows = (rows: MonitoringEventRow[]) => {
  const grouped = new Map<
    string,
    {
      model: string;
      requests: number;
      failures: number;
      totalTokens: number;
      totalCost: number;
      latencySum: number;
      latencyCount: number;
      sources: Set<string>;
      channels: Set<string>;
    }
  >();

  rows.forEach((row) => {
    const existing = grouped.get(row.model) ?? {
      model: row.model,
      requests: 0,
      failures: 0,
      totalTokens: 0,
      totalCost: 0,
      latencySum: 0,
      latencyCount: 0,
      sources: new Set<string>(),
      channels: new Set<string>(),
    };

    existing.requests += row.requestCount;
    existing.failures += row.failureCalls;
    existing.totalTokens += row.totalTokens;
    existing.totalCost += row.totalCost;
    existing.sources.add(row.source);
    existing.channels.add(row.channel);
    if (row.latencyMs !== null) {
      existing.latencySum += row.latencySumMs;
      existing.latencyCount += row.latencyCount;
    }

    grouped.set(row.model, existing);
  });

  return Array.from(grouped.values())
    .map((item) => ({
      model: item.model,
      requests: item.requests,
      failures: item.failures,
      successRate: item.requests > 0 ? (item.requests - item.failures) / item.requests : 1,
      totalTokens: item.totalTokens,
      totalCost: item.totalCost,
      averageLatencyMs: item.latencyCount > 0 ? item.latencySum / item.latencyCount : null,
      sources: item.sources.size,
      channels: item.channels.size,
    }))
    .sort((left, right) => right.requests - left.requests);
};

const buildFailureSourceRows = (rows: MonitoringEventRow[]) => {
  const grouped = new Map<
    string,
    {
      id: string;
      label: string;
      channel: string;
      failures: number;
      totalRequests: number;
      lastSeenAt: number;
      latencySum: number;
      latencyCount: number;
    }
  >();

  rows.forEach((row) => {
    const key = `${row.source}::${row.channel}`;
    const existing = grouped.get(key) ?? {
      id: key,
      label: row.sourceMasked,
      channel: row.channel,
      failures: 0,
      totalRequests: 0,
      lastSeenAt: 0,
      latencySum: 0,
      latencyCount: 0,
    };

    existing.totalRequests += row.requestCount;
    existing.lastSeenAt = Math.max(existing.lastSeenAt, row.timestampMs);
    if (row.failed) {
      existing.failures += row.failureCalls;
      if (row.latencyMs !== null) {
        existing.latencySum += row.latencySumMs;
        existing.latencyCount += row.latencyCount;
      }
    }

    grouped.set(key, existing);
  });

  return Array.from(grouped.values())
    .filter((item) => item.failures > 0)
    .map((item) => ({
      id: item.id,
      label: item.label,
      channel: item.channel,
      failures: item.failures,
      totalRequests: item.totalRequests,
      failureRate: item.totalRequests > 0 ? item.failures / item.totalRequests : 0,
      lastSeenAt: item.lastSeenAt,
      averageLatencyMs: item.latencyCount > 0 ? item.latencySum / item.latencyCount : null,
    }))
    .sort((left, right) => right.failures - left.failures || right.lastSeenAt - left.lastSeenAt);
};

const buildTaskBuckets = (rows: MonitoringEventRow[]) => {
  const grouped = new Map<
    string,
    {
      id: string;
      timestampMs: number;
      timestamp: string;
      source: string;
      sourceMasked: string;
      channel: string;
      authLabel: string;
      planType: string;
      calls: number;
      failedCalls: number;
      models: Set<string>;
      endpoints: Set<string>;
      totalTokens: number;
      totalCost: number;
      latencySum: number;
      latencyCount: number;
      maxLatencyMs: number | null;
    }
  >();

  rows.forEach((row) => {
    const existing = grouped.get(row.taskKey) ?? {
      id: row.taskKey,
      timestampMs: row.timestampMs,
      timestamp: row.timestamp,
      source: row.source,
      sourceMasked: row.sourceMasked,
      channel: row.channel,
      authLabel: row.authLabel,
      planType: row.planType,
      calls: 0,
      failedCalls: 0,
      models: new Set<string>(),
      endpoints: new Set<string>(),
      totalTokens: 0,
      totalCost: 0,
      latencySum: 0,
      latencyCount: 0,
      maxLatencyMs: null,
    };

    existing.calls += row.requestCount;
    existing.failedCalls += row.failureCalls;
    existing.models.add(row.model);
    existing.endpoints.add(row.endpointPath || row.endpoint);
    existing.totalTokens += row.totalTokens;
    existing.totalCost += row.totalCost;
    if (row.latencyMs !== null) {
      existing.latencySum += row.latencySumMs;
      existing.latencyCount += row.latencyCount;
      existing.maxLatencyMs = Math.max(existing.maxLatencyMs ?? 0, row.latencyMs);
    }

    grouped.set(row.taskKey, existing);
  });

  return Array.from(grouped.values())
    .map((item) => ({
      id: item.id,
      timestampMs: item.timestampMs,
      timestamp: item.timestamp,
      source: item.source,
      sourceMasked: item.sourceMasked,
      channel: item.channel,
      authLabel: item.authLabel,
      planType: item.planType,
      calls: item.calls,
      failedCalls: item.failedCalls,
      failed: item.failedCalls > 0,
      modelsText: joinUnique(item.models, 3),
      totalTokens: item.totalTokens,
      totalCost: item.totalCost,
      averageLatencyMs: item.latencyCount > 0 ? item.latencySum / item.latencyCount : null,
      maxLatencyMs: item.maxLatencyMs,
      endpointsText: joinUnique(item.endpoints, 2),
    }))
    .sort((left, right) => right.timestampMs - left.timestampMs);
};

const buildFailureRows = (rows: MonitoringEventRow[]) =>
  rows
    .filter((row) => row.failed)
    .map((row) => ({
      id: row.id,
      timestampMs: row.timestampMs,
      timestamp: row.timestamp,
      model: row.model,
      source: row.sourceMasked,
      channel: row.channel,
      authIndex: row.authIndexMasked,
      latencyMs: row.latencyMs,
    }))
    .sort((left, right) => right.timestampMs - left.timestampMs)
    .slice(0, 8);

const buildEventRows = (
  details: UsageDetailWithEndpoint[],
  authMetaMap: Map<string, MonitoringAuthMeta>,
  authFileMap: Map<string, CredentialInfo>,
  sourceInfoMap: ReturnType<typeof buildSourceInfoMap>,
  channelByAuthIndex: Map<string, MonitoringChannelMeta>,
  modelPriceIndex: ModelPriceIndex,
  apiKeyDisplayMap: Map<string, ApiKeyDisplayInfo>
) =>
  details
    .map((detail, index) => {
      const timestampMs =
        typeof detail.__timestampMs === 'number' && detail.__timestampMs > 0
          ? detail.__timestampMs
          : Date.parse(detail.timestamp);
      if (!Number.isFinite(timestampMs) || timestampMs <= 0) {
        return null;
      }

      const authIndex = normalizeAuthIndex(detail.auth_index) ?? '-';
      const authMeta = authMetaMap.get(authIndex);
      const sourceMeta = resolveSourceDisplay(
        detail.source,
        detail.auth_index,
        sourceInfoMap,
        authFileMap
      );
      const snapshotAccount = readString(detail.account_snapshot ?? detail.accountSnapshot);
      const snapshotLabel = readString(
        detail.auth_label_snapshot ??
          detail.authLabelSnapshot ??
          detail.auth_file_snapshot ??
          detail.authFileSnapshot
      );
      const snapshotProvider = readString(
        detail.auth_provider_snapshot ?? detail.authProviderSnapshot
      );
      const snapshotProjectID = readString(
        detail.auth_project_id_snapshot ?? detail.authProjectIdSnapshot
      );
      const snapshotDisplay = snapshotAccount || snapshotLabel;
      const sourceLabel = authMeta?.label || snapshotDisplay || sourceMeta.displayName || authIndex;
      const sourceMasked = maskEmailLike(sourceLabel);
      const account = authMeta?.account || snapshotAccount || sourceLabel;
      const accountMasked = maskEmailLike(account);
      const apiKeyHash = readString(detail.api_key_hash ?? detail.apiKeyHash).toLowerCase();
      const apiKeyDisplay = apiKeyDisplayMap.get(apiKeyHash);
      const apiKeyLabel = sanitizeApiKeyDisplayText(
        apiKeyDisplay?.label || formatApiKeyHashLabel(apiKeyHash),
        formatApiKeyHashLabel(apiKeyHash)
      );
      const apiKeyMasked = sanitizeApiKeyDisplayText(
        apiKeyDisplay?.masked || apiKeyLabel,
        apiKeyLabel
      );
      const channelMeta =
        channelByAuthIndex.get(authIndex) ||
        (authMeta?.authIndex ? channelByAuthIndex.get(authMeta.authIndex) : undefined);
      const channelLabel =
        channelMeta?.name || authMeta?.provider || snapshotProvider || sourceMeta.type || '-';
      const endpoint = readString(detail.__endpoint) || '-';
      const endpointMethod = readString(detail.__endpointMethod) || '-';
      const endpointPath = readString(detail.__endpointPath) || endpoint;
      const inputTokens = Math.max(Number(detail.tokens?.input_tokens) || 0, 0);
      const outputTokens = Math.max(Number(detail.tokens?.output_tokens) || 0, 0);
      const reasoningTokens = Math.max(Number(detail.tokens?.reasoning_tokens) || 0, 0);
      const cachedTokens = Math.max(
        Math.max(Number(detail.tokens?.cached_tokens) || 0, 0),
        Math.max(Number(detail.tokens?.cache_tokens) || 0, 0)
      );
      const totalTokens = Math.max(
        Number(detail.tokens?.total_tokens) || 0,
        extractTotalTokens(detail)
      );
      const requestCount = Math.max(Number(detail.request_count) || 1, 1);
      const successCalls = Math.max(
        Number(detail.success_count) || (detail.failed === true ? 0 : requestCount),
        0
      );
      const failureCalls = Math.max(
        Number(detail.failure_count) || (detail.failed === true ? requestCount : 0),
        0
      );
      const latencyCount = Math.max(Number(detail.latency_count) || 0, 0);
      const latencySumMs =
        latencyCount > 0
          ? Math.max(Number(detail.latency_sum_ms) || 0, 0)
          : typeof detail.latency_ms === 'number'
            ? detail.latency_ms
            : 0;
      const totalCost = calculateCost(detail, modelPriceIndex);
      const statsIncluded = detail.failed === true || inputTokens > 0 || outputTokens > 0;
      const dayKey = buildLocalDayKey(timestampMs);
      const hourLabel = buildHourLabel(timestampMs);
      const sourceKey = sourceMeta.identityKey || `source:${sourceLabel}`;
      const taskKey = `${detail.timestamp}|${sourceKey}|${authIndex}`;

      return {
        id: `${detail.timestamp}-${detail.__modelName || '-'}-${sourceKey}-${authIndex}-${index}`,
        timestamp: detail.timestamp,
        timestampMs,
        dayKey,
        hourLabel,
        model: readString(detail.__modelName) || '-',
        resolvedModel: readString(detail.__resolvedModel) || undefined,
        endpoint,
        endpointMethod,
        endpointPath,
        sourceKey,
        source: sourceLabel,
        sourceMasked,
        account,
        accountMasked,
        authIndex,
        authIndexMasked: maskAuthIndex(authIndex),
        authLabel: authMeta?.label || snapshotLabel || sourceMasked,
        apiKeyHash,
        apiKeyLabel,
        apiKeyMasked,
        provider: authMeta?.provider || snapshotProvider || sourceMeta.type || '-',
        projectId: snapshotProjectID,
        planType: authMeta?.planType || '-',
        channel: channelLabel,
        channelHost: channelMeta?.host || '-',
        channelDisabled: channelMeta?.disabled || false,
        failed: detail.failed === true,
        requestCount,
        successCalls,
        failureCalls,
        statsIncluded,
        latencyMs: typeof detail.latency_ms === 'number' ? detail.latency_ms : null,
        latencySumMs,
        latencyCount:
          latencyCount > 0 ? latencyCount : typeof detail.latency_ms === 'number' ? 1 : 0,
        inputTokens,
        outputTokens,
        reasoningTokens,
        cachedTokens,
        totalTokens,
        totalCost,
        taskKey,
        searchText: buildSearchText(
          detail.__modelName,
          sourceLabel,
          authMeta?.account,
          authMeta?.label,
          authIndex,
          apiKeyHash,
          apiKeyLabel,
          apiKeyMasked,
          channelLabel,
          channelMeta?.host,
          endpointPath,
          endpointMethod,
          authMeta?.provider || snapshotProvider,
          authMeta?.planType
        ),
      } satisfies MonitoringEventRow;
    })
    .filter(Boolean) as MonitoringEventRow[];

const readPageItems = (page: { items?: unknown[] } | null | undefined) =>
  Array.isArray(page?.items) ? page.items.filter(isRecord) : [];

const readPageNumber = (record: RecordLike, snakeKey: string, camelKey?: string) =>
  readFiniteNumber(record[snakeKey] ?? (camelKey ? record[camelKey] : undefined));

const buildModelSpendRowsFromPageItems = (
  rawModels: unknown,
  modelPriceIndex: ModelPriceIndex
): MonitoringAccountModelSpendRow[] => {
  if (!Array.isArray(rawModels)) return [];
  return rawModels.filter(isRecord).map((model) => {
    const modelName = readString(model.model) || '-';
    const resolvedModel = readString(model.resolved_model ?? model.resolvedModel);
    const tokens = {
      input_tokens: readPageNumber(model, 'input_tokens', 'inputTokens'),
      output_tokens: readPageNumber(model, 'output_tokens', 'outputTokens'),
      reasoning_tokens: readPageNumber(model, 'reasoning_tokens', 'reasoningTokens'),
      cached_tokens: readPageNumber(model, 'cached_tokens', 'cachedTokens'),
      total_tokens: readPageNumber(model, 'total_tokens', 'totalTokens'),
    };
    const totalCalls = readPageNumber(model, 'total_requests', 'totalRequests');
    const successCalls = readPageNumber(model, 'success_count', 'successCount');
    const failureCalls = readPageNumber(model, 'failure_count', 'failureCount');
    return {
      model: modelName,
      totalCalls,
      successCalls,
      failureCalls,
      successRate: totalCalls > 0 ? successCalls / totalCalls : 1,
      inputTokens: tokens.input_tokens,
      outputTokens: tokens.output_tokens,
      cachedTokens: tokens.cached_tokens,
      totalTokens: tokens.total_tokens,
      totalCost: calculateCost(
        { tokens, __modelName: modelName, __resolvedModel: resolvedModel },
        modelPriceIndex
      ),
      lastSeenAt: readPageNumber(model, 'last_seen_at_ms', 'lastSeenAtMs'),
    };
  });
};

const buildAccountRowsFromPageItems = (
  items: RecordLike[],
  modelPriceIndex: ModelPriceIndex
): MonitoringAccountRow[] =>
  items.map((item) => {
    const account = readString(item.account ?? item.key ?? item.id) || '-';
    const channels = normalizeFacetStrings(item.channels);
    const models = buildModelSpendRowsFromPageItems(item.models, modelPriceIndex);
    const totalCalls = readPageNumber(item, 'total_requests', 'totalRequests');
    const successCalls = readPageNumber(item, 'success_count', 'successCount');
    const failureCalls = readPageNumber(item, 'failure_count', 'failureCount');
    const latencyCount = readPageNumber(item, 'latency_count', 'latencyCount');
    const latencySum = readPageNumber(item, 'latency_sum_ms', 'latencySumMs');
    const rawRecentPattern = item.recent_pattern ?? item.recentPattern;
    const recentPattern = Array.isArray(rawRecentPattern)
      ? rawRecentPattern
          .map((value: unknown) => value === true)
          .filter((_, index) => index < 10)
      : [];
    return {
      id: account,
      account,
      displayAccount: resolveAccountDisplayName(
        readString(item.account_label ?? item.accountLabel) || account,
        channels
      ),
      accountMasked: maskEmailLike(account),
      authLabels: normalizeFacetStrings(item.auth_labels ?? item.authLabels),
      authIndices: normalizeFacetStrings(item.auth_indices ?? item.authIndices),
      channels,
      totalCalls,
      successCalls,
      failureCalls,
      successRate: totalCalls > 0 ? successCalls / totalCalls : 1,
      inputTokens: readPageNumber(item, 'input_tokens', 'inputTokens'),
      outputTokens: readPageNumber(item, 'output_tokens', 'outputTokens'),
      cachedTokens: readPageNumber(item, 'cached_tokens', 'cachedTokens'),
      totalTokens: readPageNumber(item, 'total_tokens', 'totalTokens'),
      totalCost: models.reduce((sum, model) => sum + model.totalCost, 0),
      averageLatencyMs: latencyCount > 0 ? latencySum / latencyCount : null,
      lastSeenAt: readPageNumber(item, 'last_seen_at_ms', 'lastSeenAtMs'),
      recentPattern,
      models,
    };
  });

const buildApiKeyRowsFromPageItems = (
  items: RecordLike[],
  modelPriceIndex: ModelPriceIndex,
  apiKeyDisplayMap: Map<string, ApiKeyDisplayInfo>
): MonitoringApiKeyRow[] =>
  items.map((item) => {
    const apiKeyHash = readString(
      item.api_key_hash ?? item.apiKeyHash ?? item.key ?? item.id
    ).toLowerCase();
    const display = apiKeyDisplayMap.get(apiKeyHash);
    const fallbackLabel =
      readString(item.api_key_label ?? item.apiKeyLabel) || formatApiKeyHashLabel(apiKeyHash);
    const apiKeyLabel = sanitizeApiKeyDisplayText(display?.label || fallbackLabel, fallbackLabel);
    const apiKeyMasked = sanitizeApiKeyDisplayText(display?.masked || apiKeyLabel, apiKeyLabel);
    const models = buildModelSpendRowsFromPageItems(item.models, modelPriceIndex);
    const totalCalls = readPageNumber(item, 'total_requests', 'totalRequests');
    const successCalls = readPageNumber(item, 'success_count', 'successCount');
    const failureCalls = readPageNumber(item, 'failure_count', 'failureCount');
    const latencyCount = readPageNumber(item, 'latency_count', 'latencyCount');
    const latencySum = readPageNumber(item, 'latency_sum_ms', 'latencySumMs');
    return {
      id: apiKeyHash || readString(item.id) || '-',
      apiKeyHash,
      apiKeyLabel,
      apiKeyMasked,
      isUnknown: item.is_unknown === true || item.isUnknown === true,
      authLabels: normalizeFacetStrings(item.auth_labels ?? item.authLabels),
      sourceLabels: normalizeFacetStrings(item.source_labels ?? item.sourceLabels),
      channels: normalizeFacetStrings(item.channels),
      totalCalls,
      successCalls,
      failureCalls,
      successRate: totalCalls > 0 ? successCalls / totalCalls : 1,
      inputTokens: readPageNumber(item, 'input_tokens', 'inputTokens'),
      outputTokens: readPageNumber(item, 'output_tokens', 'outputTokens'),
      cachedTokens: readPageNumber(item, 'cached_tokens', 'cachedTokens'),
      totalTokens: readPageNumber(item, 'total_tokens', 'totalTokens'),
      totalCost: models.reduce((sum, model) => sum + model.totalCost, 0),
      averageLatencyMs: latencyCount > 0 ? latencySum / latencyCount : null,
      lastSeenAt: readPageNumber(item, 'last_seen_at_ms', 'lastSeenAtMs'),
      models,
    };
  });

const buildRealtimeRowsFromPageItems = (
  items: RecordLike[],
  authMetaMap: Map<string, MonitoringAuthMeta>,
  authFileMap: Map<string, CredentialInfo>,
  sourceInfoMap: ReturnType<typeof buildSourceInfoMap>,
  channelByAuthIndex: Map<string, MonitoringChannelMeta>,
  modelPriceIndex: ModelPriceIndex,
  apiKeyDisplayMap: Map<string, ApiKeyDisplayInfo>
) => {
  const details = items.map((item) => {
    const endpoint = readString(item.endpoint) || '-';
    const endpointMatch = endpoint.match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+(\S+)/i);
    return {
      timestamp: readString(item.timestamp),
      source: readString(item.source),
      auth_index: readString(item.auth_index ?? item.authIndex) || null,
      api_key_hash: readString(item.api_key_hash ?? item.apiKeyHash),
      account_snapshot: readString(item.account_snapshot ?? item.accountSnapshot),
      auth_label_snapshot: readString(item.auth_label_snapshot ?? item.authLabelSnapshot),
      auth_file_snapshot: readString(item.auth_file_snapshot ?? item.authFileSnapshot),
      auth_provider_snapshot: readString(item.auth_provider_snapshot ?? item.authProviderSnapshot),
      auth_project_id_snapshot: readString(
        item.auth_project_id_snapshot ?? item.authProjectIdSnapshot
      ),
      auth_snapshot_at_ms: readPageNumber(item, 'auth_snapshot_at_ms', 'authSnapshotAtMs'),
      latency_ms:
        item.latency_ms !== undefined || item.latencyMs !== undefined
          ? readPageNumber(item, 'latency_ms', 'latencyMs')
          : undefined,
      tokens: {
        input_tokens: readPageNumber(item, 'input_tokens', 'inputTokens'),
        output_tokens: readPageNumber(item, 'output_tokens', 'outputTokens'),
        reasoning_tokens: readPageNumber(item, 'reasoning_tokens', 'reasoningTokens'),
        cached_tokens: readPageNumber(item, 'cached_tokens', 'cachedTokens'),
        cache_tokens: readPageNumber(item, 'cache_tokens', 'cacheTokens'),
        total_tokens: readPageNumber(item, 'total_tokens', 'totalTokens'),
      },
      failed: item.failed === true,
      request_count: 1,
      success_count: item.failed === true ? 0 : 1,
      failure_count: item.failed === true ? 1 : 0,
      __modelName: readString(item.model) || '-',
      __resolvedModel: readString(item.resolved_model ?? item.resolvedModel),
      __endpoint: endpoint,
      __endpointMethod: endpointMatch?.[1]?.toUpperCase(),
      __endpointPath: readString(item.path) || endpointMatch?.[2] || endpoint,
      __timestampMs: readPageNumber(item, 'timestamp_ms', 'timestampMs'),
    } satisfies UsageDetailWithEndpoint;
  });
  return buildEventRows(
    details,
    authMetaMap,
    authFileMap,
    sourceInfoMap,
    channelByAuthIndex,
    modelPriceIndex,
    apiKeyDisplayMap
  ).sort((left, right) => right.timestampMs - left.timestampMs);
};

const loadMonitoringMetaPayload = async (
  config: Config | null | undefined
): Promise<MonitoringMetaPayload> => {
  const [authResult, channelResult] = await Promise.allSettled([
    authFilesApi.list(),
    apiClient.get('/openai-compatibility'),
  ]);

  const authFiles =
    authResult.status === 'fulfilled' && Array.isArray(authResult.value.files)
      ? authResult.value.files
      : [];

  let channels: MonitoringChannelMeta[] = [];

  if (channelResult.status === 'fulfilled') {
    channels = extractArrayPayload(channelResult.value, 'openai-compatibility')
      .map((item, index) => normalizeOpenAIChannel(item, index))
      .filter(Boolean) as MonitoringChannelMeta[];
  } else if (config?.openaiCompatibility?.length) {
    channels = config.openaiCompatibility
      .map((item, index) =>
        normalizeOpenAIChannel(
          {
            ...item,
            'base-url': item.baseUrl,
            'api-key-entries': item.apiKeyEntries,
            models: item.models,
          },
          index
        )
      )
      .filter(Boolean) as MonitoringChannelMeta[];
  }

  const error = [authResult, channelResult]
    .filter((result) => result.status === 'rejected')
    .map((result) => (result.status === 'rejected' ? result.reason : null))
    .filter(Boolean)
    .map((err) => (err instanceof Error ? err.message : String(err)))
    .join('；');

  return { authFiles, channels, error };
};

export function useMonitoringData({
  usage,
  usagePages,
  config,
  modelPrices,
  apiKeyAliases,
  timeRange,
  customTimeRange,
  searchQuery,
  searchApiKeyHash,
}: UseMonitoringDataParams): UseMonitoringDataReturn {
  const [authFiles, setAuthFiles] = useState<AuthFileItem[]>([]);
  const [channels, setChannels] = useState<MonitoringChannelMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshMeta = useCallback(
    async (showLoading: boolean = true) => {
      if (showLoading) {
        setLoading(true);
        setError('');
      }

      const payload = await loadMonitoringMetaPayload(config);
      setAuthFiles(payload.authFiles);
      setChannels(payload.channels);
      setError(payload.error);
      setLoading(false);
    },
    [config]
  );

  useEffect(() => {
    let cancelled = false;

    loadMonitoringMetaPayload(config).then((payload) => {
      if (cancelled) return;
      setAuthFiles(payload.authFiles);
      setChannels(payload.channels);
      setError(payload.error);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [config]);

  const authMetaMap = useMemo(() => buildMonitoringAuthMetaMap(authFiles), [authFiles]);

  const uniqueAuthMeta = useMemo(() => {
    const map = new Map<string, MonitoringAuthMeta>();
    authMetaMap.forEach((item) => {
      map.set(item.authIndex, item);
    });
    return Array.from(map.values());
  }, [authMetaMap]);

  const authFileMap = useMemo(() => {
    const map = new Map<string, CredentialInfo>();
    authFiles.forEach((entry) => {
      const authIndex = normalizeAuthIndex(entry['auth_index'] ?? entry.authIndex);
      if (!authIndex) return;
      map.set(authIndex, {
        name:
          readString(entry.label) ||
          readString(entry.name) ||
          readString(entry.email) ||
          readString(entry.account) ||
          authIndex,
        type: readString(entry.provider) || readString(entry.type),
      });
    });
    return map;
  }, [authFiles]);

  const sourceInfoMap = useMemo(
    () =>
      buildSourceInfoMap({
        geminiApiKeys: config?.geminiApiKeys || [],
        claudeApiKeys: config?.claudeApiKeys || [],
        codexApiKeys: config?.codexApiKeys || [],
        vertexApiKeys: config?.vertexApiKeys || [],
        openaiCompatibility: config?.openaiCompatibility || [],
      }),
    [config]
  );

  const channelByAuthIndex = useMemo(() => {
    const map = new Map<string, MonitoringChannelMeta>();
    channels.forEach((channel) => {
      channel.authIndices.forEach((authIndex) => {
        map.set(authIndex, channel);
      });
    });
    return map;
  }, [channels]);

  const apiKeyDisplayMap = useMemo(() => {
    return buildApiKeyDisplayMap(config?.apiKeys || [], apiKeyAliases || []);
  }, [apiKeyAliases, config?.apiKeys]);

  const summaryFilterFacets = useMemo(
    () => buildMonitoringFilterFacetsFromSummary(usage, apiKeyDisplayMap),
    [apiKeyDisplayMap, usage]
  );

  const modelPriceIndex = useMemo(() => buildModelPriceIndex(modelPrices), [modelPrices]);

  const buildRowsForUsage = useCallback(
    (payload: unknown) => {
      const details = collectUsageDetailsWithEndpoint(payload);
      return buildEventRows(
        details,
        authMetaMap,
        authFileMap,
        sourceInfoMap,
        channelByAuthIndex,
        modelPriceIndex,
        apiKeyDisplayMap
      ).sort((left, right) => right.timestampMs - left.timestampMs);
    },
    [apiKeyDisplayMap, authFileMap, authMetaMap, channelByAuthIndex, modelPriceIndex, sourceInfoMap]
  );

  const allRows = useMemo(() => {
    return buildRowsForUsage(usage);
  }, [buildRowsForUsage, usage]);

  const accountPageRows = useMemo(() => {
    const items = readPageItems(usagePages?.accounts);
    if (items.length > 0) return buildAccountRowsFromPageItems(items, modelPriceIndex);
    const pageUsage = usagePages?.accounts?.usage;
    if (!pageUsage) return null;
    const rows = buildRangeFilteredRows(
      buildRowsForUsage(pageUsage),
      timeRange,
      customTimeRange,
      searchQuery,
      searchApiKeyHash
    );
    return buildAccountRows(rows);
  }, [
    buildRowsForUsage,
    customTimeRange,
    modelPriceIndex,
    searchApiKeyHash,
    searchQuery,
    timeRange,
    usagePages?.accounts,
  ]);

  const apiKeyPageRows = useMemo(() => {
    const items = readPageItems(usagePages?.apiKeys);
    if (items.length > 0) {
      return buildApiKeyRowsFromPageItems(items, modelPriceIndex, apiKeyDisplayMap);
    }
    const pageUsage = usagePages?.apiKeys?.usage;
    if (!pageUsage) return null;
    const rows = buildRangeFilteredRows(
      buildRowsForUsage(pageUsage),
      timeRange,
      customTimeRange,
      searchQuery,
      searchApiKeyHash
    );
    return buildApiKeyRows(rows);
  }, [
    apiKeyDisplayMap,
    buildRowsForUsage,
    customTimeRange,
    modelPriceIndex,
    searchApiKeyHash,
    searchQuery,
    timeRange,
    usagePages?.apiKeys,
  ]);

  const realtimePageRows = useMemo(() => {
    const items = readPageItems(usagePages?.realtime);
    if (items.length > 0) {
      return buildRealtimeRowsFromPageItems(
        items,
        authMetaMap,
        authFileMap,
        sourceInfoMap,
        channelByAuthIndex,
        modelPriceIndex,
        apiKeyDisplayMap
      );
    }
    const pageUsage = usagePages?.realtime?.usage;
    if (!pageUsage) return null;
    return buildRangeFilteredRows(
      buildRowsForUsage(pageUsage),
      timeRange,
      customTimeRange,
      searchQuery,
      searchApiKeyHash
    );
  }, [
    apiKeyDisplayMap,
    authFileMap,
    authMetaMap,
    buildRowsForUsage,
    channelByAuthIndex,
    customTimeRange,
    modelPriceIndex,
    searchApiKeyHash,
    searchQuery,
    sourceInfoMap,
    timeRange,
    usagePages?.realtime,
  ]);

  const modelAggregateRows = useMemo(() => {
    const pageUsage = usagePages?.models?.usage;
    if (!pageUsage) return null;
    return buildRowsForUsage(pageUsage).filter(shouldIncludeInStats);
  }, [buildRowsForUsage, usagePages?.models?.usage]);

  const filteredRows = useMemo(
    () =>
      buildRangeFilteredRows(allRows, timeRange, customTimeRange, searchQuery, searchApiKeyHash),
    [allRows, customTimeRange, searchApiKeyHash, searchQuery, timeRange]
  );
  const filterFacets = useMemo<MonitoringFilterFacets>(() => {
    if (
      summaryFilterFacets.providers.length > 0 ||
      summaryFilterFacets.accounts.length > 0 ||
      summaryFilterFacets.models.length > 0 ||
      summaryFilterFacets.channels.length > 0 ||
      summaryFilterFacets.apiKeys.length > 0
    ) {
      return summaryFilterFacets;
    }

    const apiKeyOptions = new Map<string, string>();
    filteredRows.forEach((row) => {
      if (!row.apiKeyHash || apiKeyOptions.has(row.apiKeyHash)) return;
      apiKeyOptions.set(row.apiKeyHash, row.apiKeyLabel || row.apiKeyMasked || row.apiKeyHash);
    });

    return {
      providers: Array.from(new Set(filteredRows.map((row) => row.provider))).filter(Boolean),
      accounts: buildAccountRows(filteredRows).map((row) => ({
        value: row.account,
        label:
          row.displayAccount && row.displayAccount !== row.account
            ? `${row.displayAccount} / ${row.account}`
            : row.account,
      })),
      models: Array.from(new Set(filteredRows.map((row) => row.model))).filter(Boolean),
      channels: Array.from(new Set(filteredRows.map((row) => row.channel))).filter(Boolean),
      apiKeys: Array.from(apiKeyOptions.entries()).map(([value, label]) => ({ value, label })),
    };
  }, [filteredRows, summaryFilterFacets]);
  const statsRows = useMemo(() => filteredRows.filter(shouldIncludeInStats), [filteredRows]);

  const summary = useMemo(
    () => buildAggregateMonitoringSummary(usage, modelAggregateRows, statsRows),
    [modelAggregateRows, statsRows, usage]
  );
  const timelineData = useMemo(
    () => buildTimeline(statsRows, timeRange, customTimeRange),
    [customTimeRange, statsRows, timeRange]
  );
  const hourlyDistribution = useMemo(() => buildHourlyDistribution(statsRows), [statsRows]);
  const modelShareRows = useMemo(() => buildModelShareRows(statsRows), [statsRows]);
  const channelRows = useMemo(() => buildChannelRows(statsRows), [statsRows]);
  const modelRows = useMemo(() => buildModelRows(statsRows), [statsRows]);
  const failureSourceRows = useMemo(() => buildFailureSourceRows(statsRows), [statsRows]);
  const taskBuckets = useMemo(() => buildTaskBuckets(statsRows), [statsRows]);
  const recentFailures = useMemo(() => buildFailureRows(statsRows), [statsRows]);

  const metadata = useMemo<MonitoringMetadata>(() => {
    const planTypes = Array.from(
      new Set(uniqueAuthMeta.map((item) => item.planType).filter((item) => item && item !== '-'))
    ).sort();

    return {
      totalAuthFiles: authFiles.length,
      activeAuthFiles: uniqueAuthMeta.filter(
        (item) => !item.disabled && !item.unavailable && item.status === 'active'
      ).length,
      unavailableAuthFiles: uniqueAuthMeta.filter((item) => item.unavailable).length,
      runtimeOnlyAuthFiles: uniqueAuthMeta.filter((item) => item.runtimeOnly).length,
      totalChannels: channels.length,
      enabledChannels: channels.filter((item) => !item.disabled).length,
      configuredModels: Array.from(new Set(channels.flatMap((item) => item.modelNames))).length,
      planTypes,
    };
  }, [authFiles.length, channels, uniqueAuthMeta]);

  const statusChips = useMemo(() => buildStatusChips(metadata), [metadata]);

  return {
    loading,
    error,
    authFiles,
    channels,
    summary,
    metadata,
    statusChips,
    timeline: timelineData.points,
    timelineGranularity: timelineData.granularity,
    hourlyDistribution,
    modelShareRows,
    channelRows,
    modelRows,
    failureSourceRows,
    taskBuckets,
    recentFailures,
    filteredRows,
    accountPageRows,
    apiKeyPageRows,
    realtimePageRows,
    filterFacets,
    refreshMeta,
  };
}
