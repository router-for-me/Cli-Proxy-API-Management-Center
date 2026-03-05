/**
 * API 密钥管理
 */

import { apiClient } from './client';
import type { APIKeyEntry } from '@/types/visualConfig';
import { normalizeAllowedModels, normalizeApiKeyEntries } from '@/utils/apiKeys';

export const apiKeysApi = {
  async list(): Promise<APIKeyEntry[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-keys');
    const keys = data['api-keys'] ?? data.apiKeys;
    if (!Array.isArray(keys)) return [];

    return normalizeApiKeyEntries(keys);
  },

  replace: (keys: string[] | APIKeyEntry[]) =>
    apiClient.put('/api-keys',
      keys.map((item) => {
        if (typeof item === 'string') return item;
        return {
          key: String(item.key ?? '').trim(),
          'allowed-models': normalizeAllowedModels(item.allowedModels)
        };
      })
    ),

  update: (index: number, value: string | APIKeyEntry) =>
    apiClient.patch('/api-keys', {
      index,
      value:
        typeof value === 'string'
          ? value
          : {
              key: String(value.key ?? '').trim(),
              'allowed-models': normalizeAllowedModels(value.allowedModels)
            }
    }),

  getAllowedModels: async (index: number): Promise<string[]> => {
    const data = await apiClient.get<Record<string, unknown>>(`/api-keys/${index}/allowed-models`);
    return normalizeAllowedModels(data['allowed-models'] ?? data.allowedModels);
  },

  updateAllowedModels: async (index: number, models: string[]): Promise<void> => {
    await apiClient.put(`/api-keys/${index}/allowed-models`, normalizeAllowedModels(models));
  },

  delete: (index: number) => apiClient.delete(`/api-keys?index=${index}`)
};
