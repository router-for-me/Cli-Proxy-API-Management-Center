/**
 * API 密钥管理
 */

import { apiClient } from './client';
import type { ClientApiKeyConfig } from '@/types/config';

const normalizeModelPatterns = (value: unknown): string[] => {
  const rawList = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\n,]/) : [];
  const seen = new Set<string>();
  const normalized: string[] = [];

  rawList.forEach((item) => {
    const trimmed = String(item ?? '').trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(trimmed);
  });

  return normalized;
};

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

  const config: ClientApiKeyConfig = { apiKey: trimmed };
  const allowedModels = normalizeModelPatterns(
    record?.['allowed-models'] ?? record?.allowedModels ?? record?.['allowed_models']
  );
  const excludedModels = normalizeModelPatterns(
    record?.['excluded-models'] ?? record?.excludedModels ?? record?.['excluded_models']
  );

  if (allowedModels.length) {
    config.allowedModels = allowedModels;
  }
  if (excludedModels.length) {
    config.excludedModels = excludedModels;
  }

  return config;
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
