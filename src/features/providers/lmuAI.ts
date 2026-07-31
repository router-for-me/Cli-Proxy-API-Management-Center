import type { Config, GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { SponsorProviderRaw } from './types';

export const LMU_AI_PROVIDER_NAME = 'lmuAI';
export const LMU_AI_DISPLAY_NAME = 'LMU AI（灵眸AI）';
export const LMU_AI_AFFILIATE_URL = 'https://api.lmuai.com/register?ref=yJ6Kwg9g';
export const LMU_AI_BASE_URL = 'https://api.lmuai.com';
export const LMU_AI_OPENAI_BASE_URL = `${LMU_AI_BASE_URL}/v1`;
export const LMU_AI_CODEX_BASE_URL = LMU_AI_OPENAI_BASE_URL;
export const LMU_AI_ANTHROPIC_BASE_URL = LMU_AI_BASE_URL;
export const LMU_AI_GEMINI_BASE_URL = LMU_AI_BASE_URL;

export const LMU_AI_BASE_URL_OPTIONS = [
  {
    id: 'standard',
    baseUrl: LMU_AI_BASE_URL,
    openaiBaseUrl: LMU_AI_OPENAI_BASE_URL,
    codexBaseUrl: LMU_AI_CODEX_BASE_URL,
    anthropicBaseUrl: LMU_AI_ANTHROPIC_BASE_URL,
    geminiBaseUrl: LMU_AI_GEMINI_BASE_URL,
  },
] as const;

export const LMU_AI_PROTOCOL_LABELS = ['openai', 'anthropic', 'gemini', 'codexResponses'] as const;

const normalizeText = (value: string | undefined | null): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const normalizeBaseUrl = (value: string | undefined | null): string =>
  normalizeText(value).replace(/\/+$/, '');

export const resolveLmuAIBaseUrl = (value: string | undefined | null): string => {
  const normalized = normalizeBaseUrl(value);
  const matched = LMU_AI_BASE_URL_OPTIONS.find(
    (option) =>
      normalized === normalizeBaseUrl(option.baseUrl) ||
      normalized === normalizeBaseUrl(option.openaiBaseUrl) ||
      normalized === normalizeBaseUrl(option.codexBaseUrl) ||
      normalized === normalizeBaseUrl(option.anthropicBaseUrl) ||
      normalized === normalizeBaseUrl(option.geminiBaseUrl)
  );
  return matched?.baseUrl ?? LMU_AI_BASE_URL;
};

export const getLmuAIProtocolUrls = (value: string | undefined | null) => {
  const baseUrl = resolveLmuAIBaseUrl(value);
  const matched =
    LMU_AI_BASE_URL_OPTIONS.find(
      (option) => normalizeBaseUrl(option.baseUrl) === normalizeBaseUrl(baseUrl)
    ) ?? LMU_AI_BASE_URL_OPTIONS[0];
  return {
    anthropic: matched.anthropicBaseUrl,
    openai: matched.openaiBaseUrl,
    codex: matched.codexBaseUrl,
    gemini: matched.geminiBaseUrl,
  };
};

const matchesLmuAIOpenAIBaseUrl = (value: string | undefined | null): boolean => {
  const normalized = normalizeBaseUrl(value);
  return LMU_AI_BASE_URL_OPTIONS.some(
    (option) =>
      normalized === normalizeBaseUrl(option.openaiBaseUrl) ||
      normalized === normalizeBaseUrl(option.codexBaseUrl)
  );
};

const matchesLmuAIAnthropicBaseUrl = (value: string | undefined | null): boolean => {
  const normalized = normalizeBaseUrl(value);
  return LMU_AI_BASE_URL_OPTIONS.some(
    (option) => normalized === normalizeBaseUrl(option.anthropicBaseUrl)
  );
};

const matchesLmuAIGeminiBaseUrl = (value: string | undefined | null): boolean => {
  const normalized = normalizeBaseUrl(value);
  return LMU_AI_BASE_URL_OPTIONS.some(
    (option) => normalized === normalizeBaseUrl(option.geminiBaseUrl)
  );
};

export const isLmuAIOpenAIProvider = (config: OpenAIProviderConfig | undefined | null): boolean => {
  if (!config) return false;
  return matchesLmuAIOpenAIBaseUrl(config.baseUrl);
};

export const isLmuAIClaudeProvider = (config: ProviderKeyConfig | undefined | null): boolean => {
  if (!config) return false;
  return matchesLmuAIAnthropicBaseUrl(config.baseUrl);
};

export const isLmuAICodexProvider = (config: ProviderKeyConfig | undefined | null): boolean => {
  if (!config) return false;
  return matchesLmuAIOpenAIBaseUrl(config.baseUrl);
};

export const isLmuAIGeminiProvider = (config: GeminiKeyConfig | undefined | null): boolean => {
  if (!config) return false;
  return matchesLmuAIGeminiBaseUrl(config.baseUrl);
};

export const buildLmuAIRaw = (config: Config | null | undefined): SponsorProviderRaw => ({
  openai: (config?.openaiCompatibility ?? [])
    .map((item, index) => ({ config: item, index: item.sourceIndex ?? index }))
    .filter((item) => isLmuAIOpenAIProvider(item.config)),
  claude: (config?.claudeApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isLmuAIClaudeProvider(item.config)),
  codex: (config?.codexApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isLmuAICodexProvider(item.config)),
  gemini: (config?.geminiApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isLmuAIGeminiProvider(item.config)),
});
