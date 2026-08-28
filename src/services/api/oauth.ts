/**
 * OAuth 与设备码登录相关 API
 */

import { apiClient } from './client';
import {
  isManagementOAuthProviderKey,
  normalizeManagementOAuthProviderKey,
} from '@/utils/providerKeys';

export type BuiltInOAuthProvider = 'codex' | 'anthropic' | 'antigravity' | 'kimi' | 'xai';

export interface OAuthStartResponse {
  url: string;
  state?: string;
  /** True when the server issued a manual-redirect authorization URL. */
  manual?: boolean;
}

export interface StartAuthOptions {
  /**
   * Force the manual redirect flow on or off instead of following the server
   * default. Only Anthropic honors this today; other providers ignore it.
   */
  manual?: boolean;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

const WEBUI_SUPPORTED = new Set<string>(['codex', 'anthropic', 'antigravity', 'xai']);
const MANUAL_MODE_SUPPORTED = new Set<string>(['anthropic']);

const normalizeProviderForManagementPath = (provider: string): string => {
  const key = normalizeManagementOAuthProviderKey(provider);
  if (!isManagementOAuthProviderKey(key)) {
    throw new Error('Invalid OAuth provider');
  }
  return key;
};

/**
 * Builds the query parameters for a login start request. The manual flag is only
 * meaningful for providers that expose both redirect flows, and is omitted entirely
 * when unset so the server-side default applies.
 */
export function buildOAuthStartParams(
  providerKey: string,
  options?: StartAuthOptions
): Record<string, string | boolean> {
  const params: Record<string, string | boolean> = {};
  if (WEBUI_SUPPORTED.has(providerKey)) {
    params.is_webui = true;
  }
  if (MANUAL_MODE_SUPPORTED.has(providerKey) && options?.manual !== undefined) {
    params.manual = options.manual;
  }
  return params;
}

export const oauthApi = {
  startAuth: (provider: string, options?: StartAuthOptions) => {
    const providerKey = normalizeProviderForManagementPath(provider);
    const params = buildOAuthStartParams(providerKey, options);
    return apiClient.get<OAuthStartResponse>(`/${providerKey}-auth-url`, {
      params: Object.keys(params).length ? params : undefined,
    });
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
