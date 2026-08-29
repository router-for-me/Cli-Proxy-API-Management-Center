import type { Config, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { SponsorProviderRaw } from './types';

export const ORCA_ROUTER_PROVIDER_NAME = 'orcarouter';
export const ORCA_ROUTER_DISPLAY_NAME = 'OrcaRouter';
export const ORCA_ROUTER_BASE_URL = 'https://api.orcarouter.ai';
export const ORCA_ROUTER_OPENAI_BASE_URL = `${ORCA_ROUTER_BASE_URL}/v1`;
export const ORCA_ROUTER_ANTHROPIC_BASE_URL = ORCA_ROUTER_BASE_URL;
export const ORCA_ROUTER_DOCS_URL = 'https://docs.orcarouter.ai';

export const ORCA_ROUTER_BASE_URL_OPTIONS = [
  {
    id: 'standard',
    baseUrl: ORCA_ROUTER_BASE_URL,
    openaiBaseUrl: ORCA_ROUTER_OPENAI_BASE_URL,
    codexBaseUrl: '',
    anthropicBaseUrl: ORCA_ROUTER_ANTHROPIC_BASE_URL,
    geminiBaseUrl: '',
  },
] as const;

export const ORCA_ROUTER_PROTOCOL_LABELS = ['openai', 'anthropic'] as const;

const normalizeText = (value: string | undefined | null): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const normalizeBaseUrl = (value: string | undefined | null): string =>
  normalizeText(value).replace(/\/+$/, '');

export const resolveOrcaRouterBaseUrl = (value: string | undefined | null): string => {
  const normalized = normalizeBaseUrl(value);
  const matched = ORCA_ROUTER_BASE_URL_OPTIONS.find(
    (option) =>
      normalized === normalizeBaseUrl(option.baseUrl) ||
      normalized === normalizeBaseUrl(option.openaiBaseUrl) ||
      normalized === normalizeBaseUrl(option.anthropicBaseUrl)
  );
  if (matched) return matched.baseUrl;
  if (normalized === normalizeBaseUrl(ORCA_ROUTER_OPENAI_BASE_URL)) {
    return ORCA_ROUTER_BASE_URL;
  }
  return ORCA_ROUTER_BASE_URL;
};

export const getOrcaRouterProtocolUrls = (value: string | undefined | null) => {
  const baseUrl = resolveOrcaRouterBaseUrl(value);
  const matched =
    ORCA_ROUTER_BASE_URL_OPTIONS.find(
      (option) => normalizeBaseUrl(option.baseUrl) === normalizeBaseUrl(baseUrl)
    ) ?? ORCA_ROUTER_BASE_URL_OPTIONS[0];
  return {
    anthropic: matched.anthropicBaseUrl,
    openai: matched.openaiBaseUrl,
    codex: '',
    gemini: '',
  };
};

export const isOrcaRouterOpenAIProvider = (
  config: OpenAIProviderConfig | undefined | null
): boolean => {
  if (!config) return false;
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  return (
    ORCA_ROUTER_BASE_URL_OPTIONS.some(
      (option) => baseUrl === normalizeBaseUrl(option.openaiBaseUrl)
    ) || baseUrl === normalizeBaseUrl(ORCA_ROUTER_BASE_URL)
  );
};

export const isOrcaRouterClaudeProvider = (
  config: ProviderKeyConfig | undefined | null
): boolean => {
  if (!config) return false;
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  return ORCA_ROUTER_BASE_URL_OPTIONS.some(
    (option) => baseUrl === normalizeBaseUrl(option.anthropicBaseUrl)
  );
};

export const buildOrcaRouterRaw = (config: Config | null | undefined): SponsorProviderRaw => ({
  openai: (config?.openaiCompatibility ?? [])
    .map((item, index) => ({ config: item, index: item.sourceIndex ?? index }))
    .filter((item) => isOrcaRouterOpenAIProvider(item.config)),
  claude: (config?.claudeApiKeys ?? [])
    .map((item, index) => ({ config: item, index }))
    .filter((item) => isOrcaRouterClaudeProvider(item.config)),
  codex: [],
  gemini: [],
});
