/**
 * 认证文件与 OAuth 排除模型相关 API
 */

import { apiClient } from './client';
import type { AuthFilesResponse } from '@/types/authFile';
import type { OAuthModelMappingEntry } from '@/types';

type StatusError = { status?: number };
type AuthFileStatusResponse = { status: string; disabled: boolean };

const getStatusCode = (err: unknown): number | undefined => {
  if (!err || typeof err !== 'object') return undefined;
  if ('status' in err) return (err as StatusError).status;
  return undefined;
};

const normalizeOauthExcludedModels = (payload: unknown): Record<string, string[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const source = record['oauth-excluded-models'] ?? record.items ?? payload;
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

const normalizeOauthModelMappings = (payload: unknown): Record<string, OAuthModelMappingEntry[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const source =
    record['oauth-model-mappings'] ??
    record['oauth-model-alias'] ??
    record.items ??
    payload;
  if (!source || typeof source !== 'object') return {};

  const result: Record<string, OAuthModelMappingEntry[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([channel, mappings]) => {
    const key = String(channel ?? '')
      .trim()
      .toLowerCase();
    if (!key) return;
    if (!Array.isArray(mappings)) return;

	    const seen = new Set<string>();
	    const normalized = mappings
	      .map((item) => {
	        if (!item || typeof item !== 'object') return null;
	        const entry = item as Record<string, unknown>;
	        const name = String(entry.name ?? entry.id ?? entry.model ?? '').trim();
	        const alias = String(entry.alias ?? '').trim();
	        if (!name || !alias) return null;
	        const fork = entry.fork === true;
	        return fork ? { name, alias, fork } : { name, alias };
	      })
      .filter(Boolean)
      .filter((entry) => {
        const mapping = entry as OAuthModelMappingEntry;
        const dedupeKey = `${mapping.name.toLowerCase()}::${mapping.alias.toLowerCase()}::${mapping.fork ? '1' : '0'}`;
        if (seen.has(dedupeKey)) return false;
        seen.add(dedupeKey);
        return true;
      }) as OAuthModelMappingEntry[];

    if (normalized.length) {
      result[key] = normalized;
    }
  });

  return result;
};

const OAUTH_MODEL_MAPPINGS_ENDPOINT = '/oauth-model-mappings';
const OAUTH_MODEL_MAPPINGS_LEGACY_ENDPOINT = '/oauth-model-alias';

export const authFilesApi = {
  list: () => apiClient.get<AuthFilesResponse>('/auth-files'),

  setStatus: (name: string, disabled: boolean) =>
    apiClient.patch<AuthFileStatusResponse>('/auth-files/status', { name, disabled }),

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
    try {
      const data = await apiClient.get(OAUTH_MODEL_MAPPINGS_ENDPOINT);
      return normalizeOauthModelMappings(data);
    } catch (err: unknown) {
      if (getStatusCode(err) !== 404) throw err;
      const data = await apiClient.get(OAUTH_MODEL_MAPPINGS_LEGACY_ENDPOINT);
      return normalizeOauthModelMappings(data);
    }
  },

  saveOauthModelMappings: async (channel: string, mappings: OAuthModelMappingEntry[]) => {
    const normalizedChannel = String(channel ?? '')
      .trim()
      .toLowerCase();
    const normalizedMappings = normalizeOauthModelMappings({ [normalizedChannel]: mappings })[normalizedChannel] ?? [];

    try {
      await apiClient.patch(OAUTH_MODEL_MAPPINGS_ENDPOINT, { channel: normalizedChannel, mappings: normalizedMappings });
      return;
    } catch (err: unknown) {
      if (getStatusCode(err) !== 404) throw err;
      await apiClient.patch(OAUTH_MODEL_MAPPINGS_LEGACY_ENDPOINT, { channel: normalizedChannel, aliases: normalizedMappings });
    }
  },

  deleteOauthModelMappings: async (channel: string) => {
    const normalizedChannel = String(channel ?? '')
      .trim()
      .toLowerCase();

    const deleteViaPatch = async () => {
      try {
        await apiClient.patch(OAUTH_MODEL_MAPPINGS_ENDPOINT, { channel: normalizedChannel, mappings: [] });
        return true;
      } catch (err: unknown) {
        if (getStatusCode(err) !== 404) throw err;
        await apiClient.patch(OAUTH_MODEL_MAPPINGS_LEGACY_ENDPOINT, { channel: normalizedChannel, aliases: [] });
        return true;
      }
    };

    try {
      await deleteViaPatch();
      return;
    } catch (err: unknown) {
      const status = getStatusCode(err);
      if (status !== 405) throw err;
    }

    try {
      await apiClient.delete(`${OAUTH_MODEL_MAPPINGS_ENDPOINT}?channel=${encodeURIComponent(normalizedChannel)}`);
      return;
    } catch (err: unknown) {
      if (getStatusCode(err) !== 404) throw err;
      await apiClient.delete(`${OAUTH_MODEL_MAPPINGS_LEGACY_ENDPOINT}?channel=${encodeURIComponent(normalizedChannel)}`);
    }
  },

  // 获取认证凭证支持的模型
  async getModelsForAuthFile(name: string): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const data = await apiClient.get(`/auth-files/models?name=${encodeURIComponent(name)}`);
    return (data && Array.isArray(data['models'])) ? data['models'] : [];
  }
};
