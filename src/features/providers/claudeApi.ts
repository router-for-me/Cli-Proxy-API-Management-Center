import type { ProviderKeyConfig } from '@/types';

export const CLAUDE_API_DISPLAY_NAME = 'ClaudeAPI';
export const CLAUDE_API_BASE_URL = 'https://gw.apito.ai';
export const CLAUDE_API_LEGACY_BASE_URL = 'https://gw.claudeapi.com';
export const CLAUDE_API_AFFILIATE_URL =
  'https://console.claudeapi.com/agent/register/pJq9T52Fpugrhpgo';

const normalizeBaseUrl = (value: string | undefined | null): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');

export const isClaudeApiProvider = (
  config: ProviderKeyConfig | undefined | null
): boolean => {
  if (!config) return false;
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  return [CLAUDE_API_BASE_URL, CLAUDE_API_LEGACY_BASE_URL].some(
    (candidate) => baseUrl === normalizeBaseUrl(candidate)
  );
};
