/** Client key usage counters used by access.api-key-policies limits. */
import { apiClient } from './client';

export type ApiKeyUsageWindow = 'day' | 'week' | 'month';

export interface ApiKeyWindowUsage {
  tokens: number;
  cost: number;
  requests: number;
  resetAt: string;
}

export interface ApiKeyPolicyUsage {
  key: string;
  expired: boolean;
  usage: Record<ApiKeyUsageWindow, ApiKeyWindowUsage>;
}

const WINDOWS: ApiKeyUsageWindow[] = ['day', 'week', 'month'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const toNumber = (value: unknown): number => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
};

export function normalizeApiKeyPolicyUsage(payload: unknown): ApiKeyPolicyUsage[] {
  const keys = isRecord(payload) && Array.isArray(payload.keys) ? payload.keys : [];
  return keys.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.key !== 'string') return [];
    const rawUsage = isRecord(entry.usage) ? entry.usage : {};
    const usage = {} as Record<ApiKeyUsageWindow, ApiKeyWindowUsage>;
    for (const window of WINDOWS) {
      const raw = isRecord(rawUsage[window]) ? rawUsage[window] : {};
      usage[window] = {
        tokens: toNumber(raw.tokens),
        cost: toNumber(raw.cost),
        requests: toNumber(raw.requests),
        resetAt: typeof raw.reset_at === 'string' ? raw.reset_at : '',
      };
    }
    return [{ key: entry.key, expired: entry.expired === true, usage }];
  });
}

export const apiKeyPolicyUsageApi = {
  list: async () =>
    normalizeApiKeyPolicyUsage(await apiClient.get<unknown>('/access/api-key-usage')),
};
