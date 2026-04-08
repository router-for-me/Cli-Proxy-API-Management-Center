/**
 * API 密钥管理
 */

import { apiClient } from './client';
import type { ClientApiKeyConfig } from '@/types/config';

const DEFAULT_CLIENT_API_KEY_RPS = 5;

const normalizeClientApiKey = (entry: unknown): ClientApiKeyConfig | null => {
  if (entry === undefined || entry === null) return null;
  const record =
    entry !== null && typeof entry === 'object' && !Array.isArray(entry)
      ? (entry as Record<string, unknown>)
      : null;
  const apiKey =
    record?.['api-key'] ??
    record?.apiKey ??
    record?.key ??
    (typeof entry === 'string' ? entry : '');
  const trimmed = String(apiKey || '').trim();
  if (!trimmed) return null;
  const rpsRaw =
    record?.['requests-per-second'] ??
    record?.requestsPerSecond ??
    record?.['requests_per_second'] ??
    DEFAULT_CLIENT_API_KEY_RPS;
  const parsed = Number(rpsRaw);
  return {
    apiKey: trimmed,
    requestsPerSecond:
      Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_CLIENT_API_KEY_RPS,
  };
};

export const apiKeysApi = {
  async list(): Promise<ClientApiKeyConfig[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-keys');
    const keys = data['api-keys'] ?? data.apiKeys;
    return Array.isArray(keys)
      ? (keys.map((entry) => normalizeClientApiKey(entry)).filter(Boolean) as ClientApiKeyConfig[])
      : [];
  },

  replace: (keys: ClientApiKeyConfig[]) =>
    apiClient.put(
      '/api-keys',
      keys.map((entry) => ({
        'api-key': entry.apiKey,
        'requests-per-second': entry.requestsPerSecond,
      }))
    ),

  update: (index: number, value: ClientApiKeyConfig) =>
    apiClient.patch('/api-keys', {
      index,
      value: {
        'api-key': value.apiKey,
        'requests-per-second': value.requestsPerSecond,
      },
    }),

  delete: (index: number) => apiClient.delete(`/api-keys?index=${index}`),
};
