import axios, { type AxiosRequestConfig } from 'axios';
import type {
  CollectorCallRecord,
  CollectorCallRecordFilters,
  CollectorCallRecordsResponse,
  CollectorHealth,
  CollectorKafkaStatus,
  CollectorSettings,
  CollectorUsageSummary,
} from '@/types/collector';
import { buildCollectorApiUrl, buildCollectorQuery } from '@/utils/collectorConnection';
import { REQUEST_TIMEOUT_MS } from '@/utils/constants';

const collectorClient = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
  },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const toNumber = (value: unknown): number | undefined => {
  const numberValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

const toStringValue = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text || undefined;
};

const toBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
};

const buildConfig = (settings: CollectorSettings, config?: AxiosRequestConfig): AxiosRequestConfig => {
  const headers = {
    ...(config?.headers || {}),
    ...(settings.managementKey
      ? {
          Authorization: `Bearer ${settings.managementKey}`,
        }
      : {}),
  };

  return {
    ...config,
    headers,
  };
};

const request = async <T>(
  settings: CollectorSettings,
  path: string,
  config?: AxiosRequestConfig
): Promise<T> => {
  const url = buildCollectorApiUrl(settings.baseUrl, path);
  const response = await collectorClient.request<T>({
    ...buildConfig(settings, config),
    url,
  });
  return response.data;
};

const normalizeCallRecord = (input: unknown): CollectorCallRecord | null => {
  if (!isRecord(input)) return null;
  const id = toStringValue(input.id ?? input.request_id ?? input.requestId);
  if (!id) return null;

  return {
    id,
    requestId: toStringValue(input.request_id ?? input.requestId),
    createdAt: toStringValue(input.created_at ?? input.createdAt ?? input.timestamp),
    apiKeyHash: toStringValue(input.api_key_hash ?? input.apiKeyHash),
    apiKeyMasked: toStringValue(input.api_key_masked ?? input.apiKeyMasked),
    method: toStringValue(input.method),
    path: toStringValue(input.path),
    model: toStringValue(input.model),
    statusCode: toNumber(input.status_code ?? input.statusCode),
    latencyMs: toNumber(input.latency_ms ?? input.latencyMs),
    totalTokens: toNumber(input.total_tokens ?? input.totalTokens),
    clientIp: toStringValue(input.client_ip ?? input.clientIp),
    requestInputText: toStringValue(input.request_input_text ?? input.requestInputText),
    requestBody: toStringValue(input.request_body ?? input.requestBody),
    responseBodyPreview: toStringValue(input.response_body_preview ?? input.responseBodyPreview),
    errorMessage: toStringValue(input.error_message ?? input.errorMessage),
  };
};

const normalizeCallRecordsResponse = (
  input: unknown,
  fallback: CollectorCallRecordFilters
): CollectorCallRecordsResponse => {
  const record = isRecord(input) ? input : {};
  const items =
    (Array.isArray(record.records) && record.records) ||
    (Array.isArray(record.items) && record.items) ||
    (Array.isArray(record.data) && record.data) ||
    [];
  const records = items
    .map((item) => normalizeCallRecord(item))
    .filter((item): item is CollectorCallRecord => Boolean(item));

  return {
    records,
    total: toNumber(record.total ?? record.total_count ?? record.totalCount) ?? records.length,
    page: toNumber(record.page) ?? fallback.page,
    pageSize: toNumber(record.page_size ?? record.pageSize) ?? fallback.pageSize,
  };
};

const normalizeUsageSummary = (input: unknown): CollectorUsageSummary => {
  const record = isRecord(input) ? input : {};
  const summary = isRecord(record.summary) ? record.summary : record;
  return {
    totalRequests: toNumber(summary.total_requests ?? summary.totalRequests),
    successCount: toNumber(summary.success_count ?? summary.successCount),
    failureCount: toNumber(summary.failure_count ?? summary.failureCount),
    totalTokens: toNumber(summary.total_tokens ?? summary.totalTokens),
    averageLatencyMs:
      toNumber(summary.average_latency_ms ?? summary.averageLatencyMs) ??
      toNumber(summary.avg_latency_ms ?? summary.avgLatencyMs) ??
      null,
  };
};

const normalizeKafkaStatus = (input: unknown): CollectorKafkaStatus => {
  const record = isRecord(input) ? input : {};
  return {
    enabled: toBoolean(record.enabled),
    pending: toNumber(record.pending),
    failed: toNumber(record.failed),
    sent: toNumber(record.sent),
    lastError: toStringValue(record.last_error ?? record.lastError),
  };
};

export const collectorApi = {
  health: (settings: CollectorSettings) =>
    request<CollectorHealth>(settings, '/health', { method: 'GET' }),

  async getUsageSummary(settings: CollectorSettings): Promise<CollectorUsageSummary> {
    const data = await request<unknown>(settings, '/usage/summary', { method: 'GET' });
    return normalizeUsageSummary(data);
  },

  async getKafkaStatus(settings: CollectorSettings): Promise<CollectorKafkaStatus> {
    const data = await request<unknown>(settings, '/kafka/status', { method: 'GET' });
    return normalizeKafkaStatus(data);
  },

  async getCallRecords(
    settings: CollectorSettings,
    filters: CollectorCallRecordFilters
  ): Promise<CollectorCallRecordsResponse> {
    const data = await request<unknown>(settings, '/call-records', {
      method: 'GET',
      params: buildCollectorQuery(filters),
    });
    return normalizeCallRecordsResponse(data, filters);
  },

  async getCallRecord(settings: CollectorSettings, id: string): Promise<CollectorCallRecord> {
    const data = await request<unknown>(settings, `/call-records/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
    const normalized = normalizeCallRecord(isRecord(data) && data.record ? data.record : data);
    if (!normalized) {
      throw new Error('Invalid call record response');
    }
    return normalized;
  },
};
