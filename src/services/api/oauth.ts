/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';
import type {
  GitLabPatAuthResponse,
  IFlowCookieAuthResponse,
  OAuthCallbackResponse,
  OAuthProvider,
  OAuthStartOptions,
  OAuthStartResponse,
  OAuthStatusResponse
} from '@/types/oauth';

export type {
  GitLabPatAuthResponse,
  IFlowCookieAuthResponse,
  OAuthCallbackResponse,
  OAuthProvider,
  OAuthStartOptions,
  OAuthStartResponse,
  OAuthStatusResponse
} from '@/types/oauth';

const WEBUI_SUPPORTED: OAuthProvider[] = ['codex', 'anthropic', 'antigravity', 'gemini-cli', 'gitlab'];
const CALLBACK_PROVIDER_MAP: Partial<Record<OAuthProvider, string>> = {
  'gemini-cli': 'gemini'
};

export const oauthApi = {
  startAuth: (provider: OAuthProvider, options?: OAuthStartOptions) => {
    const params: Record<string, string | boolean> = {};
    if (WEBUI_SUPPORTED.includes(provider)) {
      params.is_webui = true;
    }
    if (provider === 'gemini-cli' && options?.projectId) {
      params.project_id = options.projectId;
    }
    if (provider === 'gitlab') {
      if (options?.baseUrl) {
        params.base_url = options.baseUrl;
      }
      if (options?.clientId) {
        params.client_id = options.clientId;
      }
      if (options?.clientSecret) {
        params.client_secret = options.clientSecret;
      }
    }
    return apiClient.get<OAuthStartResponse>(`/${provider}-auth-url`, {
      params: Object.keys(params).length ? params : undefined
    });
  },

  getAuthStatus: (state: string) =>
    apiClient.get<OAuthStatusResponse>(`/get-auth-status`, {
      params: { state }
    }),

  submitCallback: (provider: OAuthProvider, redirectUrl: string) => {
    const callbackProvider = CALLBACK_PROVIDER_MAP[provider] ?? provider;
    return apiClient.post<OAuthCallbackResponse>('/oauth-callback', {
      provider: callbackProvider,
      redirect_url: redirectUrl
    });
  },

  /** iFlow cookie 认证 */
  iflowCookieAuth: (cookie: string) =>
    apiClient.post<IFlowCookieAuthResponse>('/iflow-auth-url', { cookie }),

  gitlabPatAuth: (payload: { baseUrl?: string; personalAccessToken: string }) =>
    apiClient.post<GitLabPatAuthResponse>('/gitlab-auth-url', {
      base_url: payload.baseUrl,
      personal_access_token: payload.personalAccessToken
    })
};
