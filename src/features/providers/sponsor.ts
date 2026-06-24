import type { OpenAIProviderConfig, ProviderKeyConfig } from '@/types';

export const APIKEY_FUN_PROVIDER_NAME = 'apikeyFun';
export const APIKEY_FUN_DISPLAY_NAME = 'APIKEY.FUN';
export const APIKEY_FUN_OPENAI_BASE_URL = 'https://api.apikey.fun/v1';
export const APIKEY_FUN_CODEX_BASE_URL = APIKEY_FUN_OPENAI_BASE_URL;
export const APIKEY_FUN_ANTHROPIC_BASE_URL = 'https://api.apikey.fun';

export const APIKEY_FUN_PROTOCOLS = [
  'anthropic',
  'openai',
  'codexResponses',
] as const;
export type ApiKeyFunProtocol = (typeof APIKEY_FUN_PROTOCOLS)[number];

const normalizeText = (value: string | undefined | null): string =>
  String(value ?? '').trim().toLowerCase();

const normalizeBaseUrl = (value: string | undefined | null): string =>
  normalizeText(value).replace(/\/+$/, '');

export const isApiKeyFunOpenAIProvider = (
  config: OpenAIProviderConfig | undefined | null
): boolean => {
  if (!config) return false;
  return (
    normalizeText(config.name) === normalizeText(APIKEY_FUN_PROVIDER_NAME) ||
    normalizeBaseUrl(config.baseUrl) === normalizeBaseUrl(APIKEY_FUN_OPENAI_BASE_URL)
  );
};

export const isApiKeyFunClaudeProvider = (
  config: ProviderKeyConfig | undefined | null
): boolean => {
  if (!config) return false;
  return normalizeBaseUrl(config.baseUrl) === normalizeBaseUrl(APIKEY_FUN_ANTHROPIC_BASE_URL);
};

export const isApiKeyFunCodexProvider = (
  config: ProviderKeyConfig | undefined | null
): boolean => {
  if (!config) return false;
  return normalizeBaseUrl(config.baseUrl) === normalizeBaseUrl(APIKEY_FUN_CODEX_BASE_URL);
};
