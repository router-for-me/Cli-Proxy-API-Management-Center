export interface CollectorSettings {
  baseUrl: string;
  managementKey: string;
}

export interface CollectorHealth {
  status?: string;
  storage?: string;
  kafka?: string;
  version?: string;
  [key: string]: unknown;
}

export interface CollectorUsageSummary {
  totalRequests?: number;
  successCount?: number;
  failureCount?: number;
  totalTokens?: number;
  averageLatencyMs?: number | null;
}

export interface CollectorKafkaStatus {
  enabled?: boolean;
  pending?: number;
  failed?: number;
  sent?: number;
  lastError?: string;
}

export interface CollectorCallRecord {
  id: string;
  requestId?: string;
  createdAt?: string;
  apiKeyHash?: string;
  apiKeyMasked?: string;
  method?: string;
  path?: string;
  model?: string;
  statusCode?: number;
  latencyMs?: number;
  totalTokens?: number;
  clientIp?: string;
  requestInputText?: string;
  requestBody?: string;
  responseBodyPreview?: string;
  errorMessage?: string;
}

export interface CollectorCallRecordFilters {
  page: number;
  pageSize: number;
  apiKey?: string;
  model?: string;
  path?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  search?: string;
}

export interface CollectorCallRecordsResponse {
  records: CollectorCallRecord[];
  total: number;
  page: number;
  pageSize: number;
}
