import type { OpenAIProviderConfig, ProviderKeyConfig } from '@/types';

export const APIKEY_FUN_PROVIDER_NAME = 'apikeyFun';
export const APIKEY_FUN_DISPLAY_NAME = 'APIKEY.FUN';
export const APIKEY_FUN_STANDARD_BASE_URL = 'https://api.apikey.fun';
export const APIKEY_FUN_DIRECT_BASE_URL = 'https://slb.apikey.fun';
export const APIKEY_FUN_OPENAI_BASE_URL = `${APIKEY_FUN_STANDARD_BASE_URL}/v1`;
export const APIKEY_FUN_CODEX_BASE_URL = APIKEY_FUN_OPENAI_BASE_URL;
export const APIKEY_FUN_ANTHROPIC_BASE_URL = APIKEY_FUN_STANDARD_BASE_URL;

export const APIKEY_FUN_BASE_URL_OPTIONS = [
  {
    id: 'standard',
    baseUrl: APIKEY_FUN_STANDARD_BASE_URL,
    openaiBaseUrl: APIKEY_FUN_OPENAI_BASE_URL,
    codexBaseUrl: APIKEY_FUN_CODEX_BASE_URL,
    anthropicBaseUrl: APIKEY_FUN_ANTHROPIC_BASE_URL,
  },
  {
    id: 'direct',
    baseUrl: APIKEY_FUN_DIRECT_BASE_URL,
    openaiBaseUrl: `${APIKEY_FUN_DIRECT_BASE_URL}/v1`,
    codexBaseUrl: `${APIKEY_FUN_DIRECT_BASE_URL}/v1`,
    anthropicBaseUrl: APIKEY_FUN_DIRECT_BASE_URL,
  },
] as const;

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

export const resolveApiKeyFunBaseUrl = (value: string | undefined | null): string => {
  const normalized = normalizeBaseUrl(value);
  const matched = APIKEY_FUN_BASE_URL_OPTIONS.find(
    (option) =>
      normalized === normalizeBaseUrl(option.baseUrl) ||
      normalized === normalizeBaseUrl(option.openaiBaseUrl) ||
      normalized === normalizeBaseUrl(option.codexBaseUrl) ||
      normalized === normalizeBaseUrl(option.anthropicBaseUrl)
  );
  return matched?.baseUrl ?? APIKEY_FUN_STANDARD_BASE_URL;
};

export const getApiKeyFunProtocolUrls = (value: string | undefined | null) => {
  const baseUrl = resolveApiKeyFunBaseUrl(value);
  const matched =
    APIKEY_FUN_BASE_URL_OPTIONS.find(
      (option) => normalizeBaseUrl(option.baseUrl) === normalizeBaseUrl(baseUrl)
    ) ?? APIKEY_FUN_BASE_URL_OPTIONS[0];
  return {
    anthropic: matched.anthropicBaseUrl,
    openai: matched.openaiBaseUrl,
    codex: matched.codexBaseUrl,
  };
};

const matchesApiKeyFunOpenAIBaseUrl = (value: string | undefined | null): boolean => {
  const normalized = normalizeBaseUrl(value);
  return APIKEY_FUN_BASE_URL_OPTIONS.some(
    (option) =>
      normalized === normalizeBaseUrl(option.openaiBaseUrl) ||
      normalized === normalizeBaseUrl(option.codexBaseUrl)
  );
};

const matchesApiKeyFunAnthropicBaseUrl = (value: string | undefined | null): boolean => {
  const normalized = normalizeBaseUrl(value);
  return APIKEY_FUN_BASE_URL_OPTIONS.some(
    (option) => normalized === normalizeBaseUrl(option.anthropicBaseUrl)
  );
};

export const isApiKeyFunOpenAIProvider = (
  config: OpenAIProviderConfig | undefined | null
): boolean => {
  if (!config) return false;
  return (
    normalizeText(config.name) === normalizeText(APIKEY_FUN_PROVIDER_NAME) ||
    matchesApiKeyFunOpenAIBaseUrl(config.baseUrl)
  );
};

export const isApiKeyFunClaudeProvider = (
  config: ProviderKeyConfig | undefined | null
): boolean => {
  if (!config) return false;
  return matchesApiKeyFunAnthropicBaseUrl(config.baseUrl);
};

export const isApiKeyFunCodexProvider = (
  config: ProviderKeyConfig | undefined | null
): boolean => {
  if (!config) return false;
  return matchesApiKeyFunOpenAIBaseUrl(config.baseUrl);
};
