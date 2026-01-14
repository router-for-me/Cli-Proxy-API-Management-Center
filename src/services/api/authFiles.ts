/**
 * 认证文件与 OAuth 排除模型相关 API
 */

import { apiClient } from './client';
import type { AuthFilesResponse } from '@/types/authFile';
import type { OAuthModelMappingEntry } from '@/types';

const normalizeOauthExcludedModels = (payload: unknown): Record<string, string[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const source = (payload as any)['oauth-excluded-models'] ?? (payload as any).items ?? payload;
  if (!source || typeof source !== 'object') return {};

  const result: Record<string, string[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([provider, models]) => {
    const key = String(provider ?? '')
      .trim()
      .toLowerCase();
    if (!key) return;

    const rawList = Array.isArray(models)
      ? models
      : typeof models === 'string'
        ? models.split(/[\n,]+/)
        : [];

    const seen = new Set<string>();
    const normalized: string[] = [];
    rawList.forEach((item) => {
      const trimmed = String(item ?? '').trim();
      if (!trimmed) return;
      const modelKey = trimmed.toLowerCase();
      if (seen.has(modelKey)) return;
      seen.add(modelKey);
      normalized.push(trimmed);
    });

    result[key] = normalized;
  });

  return result;
};

export const authFilesApi = {
  list: () => apiClient.get<AuthFilesResponse>('/auth-files'),

  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return apiClient.postForm('/auth-files', formData);
  },

  deleteFile: (name: string) => apiClient.delete(`/auth-files?name=${encodeURIComponent(name)}`),

  deleteAll: () => apiClient.delete('/auth-files', { params: { all: true } }),

  downloadText: async (name: string): Promise<string> => {
    const response = await apiClient.getRaw(`/auth-files/download?name=${encodeURIComponent(name)}`, {
      responseType: 'blob'
    });
    const blob = response.data as Blob;
    return blob.text();
  },

  // OAuth 排除模型
  async getOauthExcludedModels(): Promise<Record<string, string[]>> {
    const data = await apiClient.get('/oauth-excluded-models');
    return normalizeOauthExcludedModels(data);
  },

  saveOauthExcludedModels: (provider: string, models: string[]) =>
    apiClient.patch('/oauth-excluded-models', { provider, models }),

  deleteOauthExcludedEntry: (provider: string) =>
    apiClient.delete(`/oauth-excluded-models?provider=${encodeURIComponent(provider)}`),

  replaceOauthExcludedModels: (map: Record<string, string[]>) =>
    apiClient.put('/oauth-excluded-models', normalizeOauthExcludedModels(map)),

  // OAuth 模型映射
  async getOauthModelMappings(): Promise<Record<string, OAuthModelMappingEntry[]>> {
    const data = await apiClient.get('/oauth-model-mappings');
    const payload = (data && (data['oauth-model-mappings'] ?? data.items ?? data)) as any;
    if (!payload || typeof payload !== 'object') return {};
    const result: Record<string, OAuthModelMappingEntry[]> = {};
    Object.entries(payload).forEach(([channel, mappings]) => {
      if (!Array.isArray(mappings)) return;
      const normalized = mappings
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const name = String(item.name ?? item.id ?? item.model ?? '').trim();
          const alias = String(item.alias ?? '').trim();
          if (!name || !alias) return null;
          const fork = item.fork === true;
          return fork ? { name, alias, fork } : { name, alias };
        })
        .filter(Boolean) as OAuthModelMappingEntry[];
      if (normalized.length) {
        result[channel] = normalized;
      }
    });
    return result;
  },

  saveOauthModelMappings: (channel: string, mappings: OAuthModelMappingEntry[]) =>
    apiClient.patch('/oauth-model-mappings', { channel, mappings }),

  deleteOauthModelMappings: (channel: string) =>
    apiClient.delete(`/oauth-model-mappings?channel=${encodeURIComponent(channel)}`),

  // 获取认证凭证支持的模型
  async getModelsForAuthFile(name: string): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const data = await apiClient.get(`/auth-files/models?name=${encodeURIComponent(name)}`);
    return (data && Array.isArray(data['models'])) ? data['models'] : [];
  }
};
