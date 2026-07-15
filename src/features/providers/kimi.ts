import type { Config, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { SponsorProviderRaw } from './types';

export const KIMI_PROVIDER_NAME = 'kimi';
export const KIMI_DISPLAY_NAME = 'Kimi';
export const KIMI_OPENAI_BASE_URL = 'https://api.moonshot.ai';
export const KIMI_ANTHROPIC_BASE_URL = 'https://api.moonshot.ai/anthropic';
export const KIMI_CHINESE_AFFILIATE_URL = 'https://platform.kimi.com/?aff=cliproxyapi';
export const KIMI_INTERNATIONAL_AFFILIATE_URL = 'https://platform.kimi.ai/?aff=cliproxyapi';

export const KIMI_BASE_URL_OPTIONS = [
  {
    id: 'standard',
    baseUrl: KIMI_OPENAI_BASE_URL,
    openaiBaseUrl: KIMI_OPENAI_BASE_URL,
    codexBaseUrl: '',
    anthropicBaseUrl: KIMI_ANTHROPIC_BASE_URL,
    geminiBaseUrl: '',
  },
] as const;

export const KIMI_PROTOCOL_LABELS = ['openai', 'anthropic'] as const;

export const getKimiAffiliateUrl = (language: string | undefined | null): string =>
  language?.toLowerCase().startsWith('zh')
    ? KIMI_CHINESE_AFFILIATE_URL
    : KIMI_INTERNATIONAL_AFFILIATE_URL;

const normalizeText = (value: string | undefined | null): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const normalizeBaseUrl = (value: string | undefined | null): string =>
  normalizeText(value).replace(/\/+$/, '');

export const resolveKimiBaseUrl = (_value: string | undefined | null): string =>
  KIMI_OPENAI_BASE_URL;

export const getKimiProtocolUrls = (_value: string | undefined | null) => ({
  anthropic: KIMI_ANTHROPIC_BASE_URL,
  openai: KIMI_OPENAI_BASE_URL,
  codex: '',
  gemini: '',
});

export const isKimiOpenAIProvider = (config: OpenAIProviderConfig | undefined | null): boolean => {
  if (!config) return false;
  return (
    normalizeText(config.name) === KIMI_PROVIDER_NAME ||
    normalizeBaseUrl(config.baseUrl) === normalizeBaseUrl(KIMI_OPENAI_BASE_URL)
  );
};

export const isKimiClaudeProvider = (config: ProviderKeyConfig | undefined | null): boolean => {
  if (!config) return false;
  return normalizeBaseUrl(config.baseUrl) === normalizeBaseUrl(KIMI_ANTHROPIC_BASE_URL);
};

export const buildKimiRaw = (config: Config | null | undefined): SponsorProviderRaw => ({
  openai: (config?.openaiCompatibility ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isKimiOpenAIProvider(item.config)),
  claude: (config?.claudeApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isKimiClaudeProvider(item.config)),
  codex: [],
  gemini: [],
});
