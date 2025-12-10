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

export interface IFlowCookieAuthResponse {
  status: 'ok' | 'error';
  error?: string;
  saved_path?: string;
  email?: string;
  expired?: string;
  type?: string;
}

const WEBUI_SUPPORTED: OAuthProvider[] = ['codex', 'anthropic', 'antigravity', 'gemini-cli', 'iflow'];

export const oauthApi = {
  startAuth: (provider: OAuthProvider) =>
    apiClient.get<OAuthStartResponse>(`/${provider}-auth-url`, {
      params: WEBUI_SUPPORTED.includes(provider) ? { is_webui: true } : undefined
    }),

  getAuthStatus: (state: string) =>
    apiClient.get<{ status: 'ok' | 'wait' | 'error'; error?: string }>(`/get-auth-status`, {
      params: { state }
    }),

  /** iFlow cookie 认证 */
  iflowCookieAuth: (cookie: string) =>
    apiClient.post<IFlowCookieAuthResponse>('/iflow-auth-url', { cookie })
};
