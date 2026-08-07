import type { Config, GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { SponsorProviderRaw } from './types';

export const INFISTAR_PROVIDER_NAME = 'infistar';
export const INFISTAR_DISPLAY_NAME = '无限星河';
export const INFISTAR_AFFILIATE_URL = 'https://infistar.ai/register?aff=FQKC6J6R&ref_source=link';
export const INFISTAR_DOMESTIC_ROOT_URL = 'https://coneverse.com';
export const INFISTAR_GLOBAL_ROOT_URL = 'https://infistar.ai';
export const INFISTAR_DOMESTIC_BASE_URL = `${INFISTAR_DOMESTIC_ROOT_URL}/v1`;
export const INFISTAR_GLOBAL_BASE_URL = `${INFISTAR_GLOBAL_ROOT_URL}/v1`;

export const INFISTAR_BASE_URL_OPTIONS = [
  {
    id: 'mainlandChina',
    descriptionKey: 'mainlandChinaRecommended',
    baseUrl: INFISTAR_DOMESTIC_BASE_URL,
    openaiBaseUrl: INFISTAR_DOMESTIC_BASE_URL,
    codexBaseUrl: INFISTAR_DOMESTIC_BASE_URL,
    anthropicBaseUrl: INFISTAR_DOMESTIC_ROOT_URL,
    geminiBaseUrl: INFISTAR_DOMESTIC_ROOT_URL,
  },
  {
    id: 'global',
    descriptionKey: 'global',
    baseUrl: INFISTAR_GLOBAL_BASE_URL,
    openaiBaseUrl: INFISTAR_GLOBAL_BASE_URL,
    codexBaseUrl: INFISTAR_GLOBAL_BASE_URL,
    anthropicBaseUrl: INFISTAR_GLOBAL_ROOT_URL,
    geminiBaseUrl: INFISTAR_GLOBAL_ROOT_URL,
  },
] as const;

export const INFISTAR_PROTOCOL_LABELS = [
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

export const resolveInfistarBaseUrl = (value: string | undefined | null): string => {
  const normalized = normalizeBaseUrl(value);
  const matched = INFISTAR_BASE_URL_OPTIONS.find(
    (option) =>
      normalized === normalizeBaseUrl(option.baseUrl) ||
      normalized === normalizeBaseUrl(option.openaiBaseUrl) ||
      normalized === normalizeBaseUrl(option.codexBaseUrl) ||
      normalized === normalizeBaseUrl(option.anthropicBaseUrl) ||
      normalized === normalizeBaseUrl(option.geminiBaseUrl)
  );
  return matched?.baseUrl ?? INFISTAR_DOMESTIC_BASE_URL;
};

export const getInfistarProtocolUrls = (value: string | undefined | null) => {
  const baseUrl = resolveInfistarBaseUrl(value);
  const matched =
    INFISTAR_BASE_URL_OPTIONS.find(
      (option) => normalizeBaseUrl(option.baseUrl) === normalizeBaseUrl(baseUrl)
    ) ?? INFISTAR_BASE_URL_OPTIONS[0];
  return {
    anthropic: matched.anthropicBaseUrl,
    openai: matched.openaiBaseUrl,
    codex: matched.codexBaseUrl,
    gemini: matched.geminiBaseUrl,
  };
};

const matchesInfistarOpenAIBaseUrl = (value: string | undefined | null): boolean => {
  const normalized = normalizeBaseUrl(value);
  return INFISTAR_BASE_URL_OPTIONS.some(
    (option) =>
      normalized === normalizeBaseUrl(option.openaiBaseUrl) ||
      normalized === normalizeBaseUrl(option.codexBaseUrl)
  );
};

const matchesInfistarAnthropicBaseUrl = (value: string | undefined | null): boolean => {
  const normalized = normalizeBaseUrl(value);
  return INFISTAR_BASE_URL_OPTIONS.some(
    (option) => normalized === normalizeBaseUrl(option.anthropicBaseUrl)
  );
};

const matchesInfistarGeminiBaseUrl = (value: string | undefined | null): boolean => {
  const normalized = normalizeBaseUrl(value);
  return INFISTAR_BASE_URL_OPTIONS.some(
    (option) => normalized === normalizeBaseUrl(option.geminiBaseUrl)
  );
};

export const isInfistarOpenAIProvider = (
  config: OpenAIProviderConfig | undefined | null
): boolean => {
  if (!config) return false;
  return matchesInfistarOpenAIBaseUrl(config.baseUrl);
};

export const isInfistarClaudeProvider = (config: ProviderKeyConfig | undefined | null): boolean => {
  if (!config) return false;
  return matchesInfistarAnthropicBaseUrl(config.baseUrl);
};

export const isInfistarCodexProvider = (config: ProviderKeyConfig | undefined | null): boolean => {
  if (!config) return false;
  return matchesInfistarOpenAIBaseUrl(config.baseUrl);
};

export const isInfistarGeminiProvider = (config: GeminiKeyConfig | undefined | null): boolean => {
  if (!config) return false;
  return matchesInfistarGeminiBaseUrl(config.baseUrl);
};

export const buildInfistarRaw = (config: Config | null | undefined): SponsorProviderRaw => ({
  openai: (config?.openaiCompatibility ?? [])
    .map((item, index) => ({ config: item, index: item.sourceIndex ?? index }))
    .filter((item) => isInfistarOpenAIProvider(item.config)),
  claude: (config?.claudeApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isInfistarClaudeProvider(item.config)),
  codex: (config?.codexApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isInfistarCodexProvider(item.config)),
  gemini: (config?.geminiApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isInfistarGeminiProvider(item.config)),
});
