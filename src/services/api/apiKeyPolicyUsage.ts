/** Client key usage counters used by access.api-key-policies limits and the usage page. */
import { apiClient } from './client';

/** Calendar windows that access.api-key-policies limits apply to. */
export type ApiKeyUsageWindow = 'day' | 'week' | 'month';
/** Limit windows plus the all-time total reported for statistics. */
export type ApiKeyStatsWindow = ApiKeyUsageWindow | 'total';

export interface ApiKeyModelUsage {
  model: string;
  requests: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  tokens: number;
  cost: number;
}

export interface ApiKeyWindowUsage {
  tokens: number;
  cost: number;
  requests: number;
  failed: number;
  /** Empty for the total window, which never resets. */
  resetAt: string;
  models: ApiKeyModelUsage[];
}

/** One time slot of usage history: `YYYY-MM-DD` (daily) or `YYYY-MM-DDTHH` (hourly), server local time. */
export interface ApiKeyHistoryBucket {
  time: string;
  models: ApiKeyModelUsage[];
}

export interface ApiKeyPolicyUsage {
  key: string;
  name: string;
  expired: boolean;
  usage: Record<ApiKeyStatsWindow, ApiKeyWindowUsage>;
  /** Daily buckets for the last 90 days, oldest first; empty days are omitted. */
  daily: ApiKeyHistoryBucket[];
  /** Hourly buckets for the last 48 hours, oldest first; empty hours are omitted. */
  hourly: ApiKeyHistoryBucket[];
}

export const API_KEY_STATS_WINDOWS: ApiKeyStatsWindow[] = ['day', 'week', 'month', 'total'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const toNumber = (value: unknown): number => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
};

const normalizeModels = (value: unknown): ApiKeyModelUsage[] =>
  (Array.isArray(value) ? value : []).flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.model !== 'string' || !raw.model) return [];
    return [
      {
        model: raw.model,
        requests: toNumber(raw.requests),
        failed: toNumber(raw.failed),
        inputTokens: toNumber(raw.input_tokens),
        outputTokens: toNumber(raw.output_tokens),
        cachedTokens: toNumber(raw.cached_tokens),
        reasoningTokens: toNumber(raw.reasoning_tokens),
        tokens: toNumber(raw.tokens),
        cost: toNumber(raw.cost),
      },
    ];
  });

const normalizeHistory = (value: unknown): ApiKeyHistoryBucket[] =>
  (Array.isArray(value) ? value : []).flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.time !== 'string' || !raw.time) return [];
    return [{ time: raw.time, models: normalizeModels(raw.models) }];
  });

export function normalizeApiKeyPolicyUsage(payload: unknown): ApiKeyPolicyUsage[] {
  const keys = isRecord(payload) && Array.isArray(payload.keys) ? payload.keys : [];
  return keys.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.key !== 'string') return [];
    const rawUsage = isRecord(entry.usage) ? entry.usage : {};
    const usage = {} as Record<ApiKeyStatsWindow, ApiKeyWindowUsage>;
    for (const window of API_KEY_STATS_WINDOWS) {
      const raw = isRecord(rawUsage[window]) ? rawUsage[window] : {};
      usage[window] = {
        tokens: toNumber(raw.tokens),
        cost: toNumber(raw.cost),
        requests: toNumber(raw.requests),
        failed: toNumber(raw.failed),
        resetAt: typeof raw.reset_at === 'string' ? raw.reset_at : '',
        models: normalizeModels(raw.models),
      };
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    return [
      {
        key: entry.key,
        name,
        expired: entry.expired === true,
        usage,
        daily: normalizeHistory(entry.daily),
        hourly: normalizeHistory(entry.hourly),
      },
    ];
  });
}

/** Sums the given keys' model rows for one window, heaviest token users first. */
export function aggregateModelUsage(
  entries: ApiKeyPolicyUsage[],
  window: ApiKeyStatsWindow
): ApiKeyModelUsage[] {
  const byModel = new Map<string, ApiKeyModelUsage>();
  for (const entry of entries) {
    for (const row of entry.usage[window].models) {
      const acc = byModel.get(row.model);
      if (!acc) {
        byModel.set(row.model, { ...row });
        continue;
      }
      acc.requests += row.requests;
      acc.failed += row.failed;
      acc.inputTokens += row.inputTokens;
      acc.outputTokens += row.outputTokens;
      acc.cachedTokens += row.cachedTokens;
      acc.reasoningTokens += row.reasoningTokens;
      acc.tokens += row.tokens;
      acc.cost += row.cost;
    }
  }
  return [...byModel.values()].sort(
    (a, b) => b.tokens - a.tokens || b.requests - a.requests || a.model.localeCompare(b.model)
  );
}

export const apiKeyPolicyUsageApi = {
  list: async () =>
    normalizeApiKeyPolicyUsage(await apiClient.get<unknown>('/access/api-key-usage')),
};
