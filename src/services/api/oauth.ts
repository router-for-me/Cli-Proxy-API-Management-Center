/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';

export type OAuthProvider =
  | 'codex'
  | 'anthropic'
  | 'antigravity'
  | 'gemini-cli'
  | 'qwen'
  | 'iflow';

export interface OAuthStartResponse {
  url: string;
  state?: string;
}

export const oauthApi = {
  startAuth: (provider: OAuthProvider) => apiClient.get<OAuthStartResponse>(`/${provider}-auth-url`, { params: { is_webui: 1 } }),

  getAuthStatus: (state: string) =>
    apiClient.get<{ status: 'ok' | 'wait' | 'error'; error?: string }>(`/get-auth-status`, {
      params: { state }
    })
};
