/**
 * API 密钥管理
 */

import { apiClient } from './client';

export const apiKeysApi = {
  async prefixOptions(): Promise<string[]> {
    const data = await apiClient.get<{ prefixes: unknown }>('/api-key-prefix-options');
    if (
      !Array.isArray(data.prefixes) ||
      data.prefixes.some((prefix) => typeof prefix !== 'string')
    ) {
      throw new Error('Invalid prefix options response');
    }
    return data.prefixes as string[];
  },
  async list(): Promise<string[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-keys');
    const keys = data['api-keys'] ?? data.apiKeys;
    return Array.isArray(keys) ? keys.map((key) => String(key)) : [];
  },

  replace: (keys: string[]) => apiClient.put('/api-keys', keys),

  update: (index: number, value: string) => apiClient.patch('/api-keys', { index, value }),

  delete: (index: number) => apiClient.delete(`/api-keys?index=${index}`),
};
