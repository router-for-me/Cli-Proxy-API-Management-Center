/**
 * 认证文件与 OAuth 排除模型相关 API
 */

import { apiClient } from './client';
import type { AuthFilesResponse } from '@/types/authFile';

export interface AntigravityQuotaInfo {
  model: string;
  category: string;
  remainingFraction: number;
  remainingPercent: number;
  resetTime: string;
  resetTimeLocal: string;
}

export interface AntigravityQuotaResponse {
  success: boolean;
  email?: string;
  error?: string;
  quotas?: AntigravityQuotaInfo[];
}

export const authFilesApi = {
  list: () => apiClient.get<AuthFilesResponse>('/auth-files'),

  upload: (file: File) => {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return apiClient.postForm('/auth-files', formData);
  },

  deleteFile: (name: string) => apiClient.delete(`/auth-files?name=${encodeURIComponent(name)}`),

  deleteAll: () => apiClient.delete('/auth-files', { params: { all: true } }),

  // OAuth 排除模型
  async getOauthExcludedModels(): Promise<Record<string, string[]>> {
    const data = await apiClient.get('/oauth-excluded-models');
    const payload = (data && (data['oauth-excluded-models'] ?? data.items ?? data)) as any;
    return payload && typeof payload === 'object' ? payload : {};
  },

  saveOauthExcludedModels: (provider: string, models: string[]) =>
    apiClient.patch('/oauth-excluded-models', { provider, models }),

  deleteOauthExcludedEntry: (provider: string) =>
    apiClient.delete(`/oauth-excluded-models?provider=${encodeURIComponent(provider)}`),

  // 获取认证凭证支持的模型
  async getModelsForAuthFile(name: string): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const data = await apiClient.get(`/auth-files/models?name=${encodeURIComponent(name)}`);
    return (data && Array.isArray(data['models'])) ? data['models'] : [];
  },

  // 获取 Antigravity 账号的模型额度
  async getAntigravityQuotas(id: string): Promise<AntigravityQuotaResponse> {
    const data = await apiClient.get<AntigravityQuotaResponse>(`/antigravity-quotas?id=${encodeURIComponent(id)}`);
    return data;
  }
};
