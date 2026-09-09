/** OAuth and device authorization API. */

import { apiClient } from './client';
import {
  isManagementOAuthProviderKey,
  normalizeManagementOAuthProviderKey,
} from '@/utils/providerKeys';

export type BuiltInOAuthProvider =
  'codex' | 'anthropic' | 'antigravity' | 'kimi' | 'github-copilot' | 'xai';

export interface OAuthStartResponse {
  url: string;
  state?: string;
  flow?: 'device';
  userCode?: string;
  expiresIn?: number;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

const WEBUI_SUPPORTED = new Set<string>(['codex', 'anthropic', 'antigravity', 'xai']);

const normalizeProviderForManagementPath = (provider: string): string => {
  const key = normalizeManagementOAuthProviderKey(provider);
  if (!isManagementOAuthProviderKey(key)) {
    throw new Error('Invalid OAuth provider');
  }
  return key;
};

export const oauthApi = {
  startAuth: async (provider: string) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    const params: Record<string, string | boolean> = {};
    if (WEBUI_SUPPORTED.has(providerKey)) {
      params.is_webui = true;
    }
    const result = await apiClient.get<{
      url: string;
      state?: string;
      flow?: 'device';
      user_code?: string;
      expires_in?: number;
    }>(`/${providerKey}-auth-url`, {
      params: Object.keys(params).length ? params : undefined,
    });
    return {
      url: result.url,
      state: result.state,
      flow: result.flow,
      userCode: result.user_code,
      expiresIn: result.expires_in,
    } satisfies OAuthStartResponse;
  },

  getAuthStatus: (state: string) =>
    apiClient.get<{ status: 'ok' | 'wait' | 'error'; error?: string }>(`/get-auth-status`, {
      params: { state },
    }),

  submitCallback: (provider: string, redirectUrl: string) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    return apiClient.post<OAuthCallbackResponse>('/oauth-callback', {
      provider: providerKey,
      redirect_url: redirectUrl,
    });
  },
};
