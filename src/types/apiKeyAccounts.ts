export interface ApiKeyLimit {
  requests: number;
  tokens: number;
}

export interface ApiKeyProfile {
  id: string;
  name: string;
  apiKey: string;
  keyFingerprint: string;
  disabled: boolean;
  allowedModels: string[];
  weekly: ApiKeyLimit;
  monthly: ApiKeyLimit;
}

export interface ApiKeyUsageSettings {
  enabled: boolean;
  databasePath: string;
  retentionDays: number;
  timezone: string;
}

export interface ApiKeyUsageTotals {
  requests: number;
  successes: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

export interface ApiKeyProfileUsage {
  id: string;
  name: string;
  keyFingerprint: string;
  disabled: boolean;
  allowedModels: string[];
  limit: ApiKeyLimit;
  usage: ApiKeyUsageTotals;
  remainingRequests: number;
  remainingTokens: number;
}

export interface ApiKeyModelUsage {
  profileId: string;
  model: string;
  provider: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ApiKeyUsageSummary {
  period: 'week' | 'month';
  timezone: string;
  start: string;
  end: string;
  totals: ApiKeyUsageTotals;
  profiles: ApiKeyProfileUsage[];
  models: ApiKeyModelUsage[];
}

export interface ApiKeyUsageEvent {
  id: number;
  profileId: string;
  keyFingerprint: string;
  provider: string;
  model: string;
  requestedAt: string;
  failed: boolean;
  statusCode: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
}

export interface ApiKeyUsageEventsPage {
  events: ApiKeyUsageEvent[];
  limit: number;
  offset: number;
  total: number;
}
