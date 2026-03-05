/**
 * API 密钥管理
 */

import { apiClient } from './client';

export type APIKeyEntry = {
  key: string;
  allowedModels: string[];
};

function normalizeAllowedModels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const model = String(item ?? '').trim();
    if (!model) continue;
    if (!out.includes(model)) out.push(model);
  }
  return out;
}

function normalizeEntry(raw: unknown): APIKeyEntry | null {
  if (typeof raw === 'string') {
    const key = raw.trim();
    return key ? { key, allowedModels: [] } : null;
  }

  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const keyCandidates = [record.key, record['api-key'], record.apiKey, record.Key];
  let key = '';
  for (const candidate of keyCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      key = candidate.trim();
      break;
    }
  }
  if (!key) return null;

  return {
    key,
    allowedModels: normalizeAllowedModels(record['allowed-models'] ?? record.allowedModels)
  };
}

export const apiKeysApi = {
  async list(): Promise<APIKeyEntry[]> {
    const data = await apiClient.get<Record<string, unknown>>('/api-keys');
    const keys = data['api-keys'] ?? data.apiKeys;
    if (!Array.isArray(keys)) return [];

    const out: APIKeyEntry[] = [];
    for (const item of keys) {
      const entry = normalizeEntry(item);
      if (entry) out.push(entry);
    }
    return out;
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
