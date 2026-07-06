import type { Config, GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { SponsorProviderRaw } from './types';

export const CODE0_PROVIDER_NAME = 'code0';
export const CODE0_DISPLAY_NAME = 'Code0';
export const CODE0_AFFILIATE_URL = 'https://code0.ai/agent/register/slxVMR3uVBoRgNBf';
export const CODE0_BASE_URL = 'https://code0.ai';
export const CODE0_OPENAI_BASE_URL = `${CODE0_BASE_URL}/v1`;
export const CODE0_CODEX_BASE_URL = CODE0_OPENAI_BASE_URL;
export const CODE0_ANTHROPIC_BASE_URL = CODE0_BASE_URL;
export const CODE0_GEMINI_BASE_URL = CODE0_BASE_URL;

export const CODE0_BASE_URL_OPTIONS = [
  {
    id: 'standard',
    baseUrl: CODE0_BASE_URL,
    openaiBaseUrl: CODE0_OPENAI_BASE_URL,
    codexBaseUrl: CODE0_CODEX_BASE_URL,
    anthropicBaseUrl: CODE0_ANTHROPIC_BASE_URL,
    geminiBaseUrl: CODE0_GEMINI_BASE_URL,
  },
] as const;

export const CODE0_PROTOCOL_LABELS = [
  'openai',
  'anthropic',
  'gemini',
  'codexResponses',
] as const;

const normalizeText = (value: string | undefined | null): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const normalizeBaseUrl = (value: string | undefined | null): string =>
  normalizeText(value).replace(/\/+$/, '');

export const resolveCode0BaseUrl = (value: string | undefined | null): string => {
  const normalized = normalizeBaseUrl(value);
  const matched = CODE0_BASE_URL_OPTIONS.find(
    (option) =>
      normalized === normalizeBaseUrl(option.baseUrl) ||
      normalized === normalizeBaseUrl(option.openaiBaseUrl) ||
      normalized === normalizeBaseUrl(option.codexBaseUrl) ||
      normalized === normalizeBaseUrl(option.anthropicBaseUrl) ||
      normalized === normalizeBaseUrl(option.geminiBaseUrl)
  );
  return matched?.baseUrl ?? CODE0_BASE_URL;
};

export const getCode0ProtocolUrls = (value: string | undefined | null) => {
  const baseUrl = resolveCode0BaseUrl(value);
  const matched =
    CODE0_BASE_URL_OPTIONS.find(
      (option) => normalizeBaseUrl(option.baseUrl) === normalizeBaseUrl(baseUrl)
    ) ?? CODE0_BASE_URL_OPTIONS[0];
  return {
    anthropic: matched.anthropicBaseUrl,
    openai: matched.openaiBaseUrl,
    codex: matched.codexBaseUrl,
    gemini: matched.geminiBaseUrl,
  };
};

const matchesCode0OpenAIBaseUrl = (value: string | undefined | null): boolean => {
  const normalized = normalizeBaseUrl(value);
  return CODE0_BASE_URL_OPTIONS.some(
    (option) =>
      normalized === normalizeBaseUrl(option.openaiBaseUrl) ||
      normalized === normalizeBaseUrl(option.codexBaseUrl)
  );
};

const matchesCode0AnthropicBaseUrl = (value: string | undefined | null): boolean => {
  const normalized = normalizeBaseUrl(value);
  return CODE0_BASE_URL_OPTIONS.some(
    (option) => normalized === normalizeBaseUrl(option.anthropicBaseUrl)
  );
};

const matchesCode0GeminiBaseUrl = (value: string | undefined | null): boolean => {
  const normalized = normalizeBaseUrl(value);
  return CODE0_BASE_URL_OPTIONS.some(
    (option) => normalized === normalizeBaseUrl(option.geminiBaseUrl)
  );
};

export const isCode0OpenAIProvider = (
  config: OpenAIProviderConfig | undefined | null
): boolean => {
  if (!config) return false;
  return (
    normalizeText(config.name) === normalizeText(CODE0_PROVIDER_NAME) ||
    matchesCode0OpenAIBaseUrl(config.baseUrl)
  );
};

export const isCode0ClaudeProvider = (config: ProviderKeyConfig | undefined | null): boolean => {
  if (!config) return false;
  return matchesCode0AnthropicBaseUrl(config.baseUrl);
};

export const isCode0CodexProvider = (config: ProviderKeyConfig | undefined | null): boolean => {
  if (!config) return false;
  return matchesCode0OpenAIBaseUrl(config.baseUrl);
};

export const isCode0GeminiProvider = (config: GeminiKeyConfig | undefined | null): boolean => {
  if (!config) return false;
  return matchesCode0GeminiBaseUrl(config.baseUrl);
};

export const buildCode0Raw = (config: Config | null | undefined): SponsorProviderRaw => ({
  openai: (config?.openaiCompatibility ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isCode0OpenAIProvider(item.config)),
  claude: (config?.claudeApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isCode0ClaudeProvider(item.config)),
  codex: (config?.codexApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isCode0CodexProvider(item.config)),
  gemini: (config?.geminiApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isCode0GeminiProvider(item.config)),
});

