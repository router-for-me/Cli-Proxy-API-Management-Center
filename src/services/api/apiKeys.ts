/**
 * API 密钥管理
 */

import { apiClient } from './client';
import type { ClientApiKeyConfig } from '@/types/config';

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
  return trimmed;
};

export const apiKeysApi = {
  async list(): Promise<ClientApiKeyConfig[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-keys');
    const keys = data['api-keys'] ?? data.apiKeys;
    return Array.isArray(keys)
      ? (keys.map((entry) => normalizeClientApiKey(entry)).filter(Boolean) as ClientApiKeyConfig[])
      : [];
  },

  replace: (keys: ClientApiKeyConfig[]) => apiClient.put('/api-keys', keys),

  update: (index: number, value: ClientApiKeyConfig) =>
    apiClient.patch('/api-keys', {
      index,
      value,
    }),

  delete: (index: number) => apiClient.delete(`/api-keys?index=${index}`),
};
