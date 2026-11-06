import type { Config, OpenAIProviderConfig } from '@/types';
import type { SponsorProviderRaw } from './types';

// OpenRouter is configured as an OpenAI-compatible provider. CPA recognises the base URL and adds OpenRouter's
// cache breakpoints, session affinity and model limits on its own, so the preset only has to fill the endpoint.
export const OPEN_ROUTER_PROVIDER_NAME = 'openRouter';
export const OPEN_ROUTER_DISPLAY_NAME = 'OpenRouter';
export const OPEN_ROUTER_KEYS_URL = 'https://openrouter.ai/settings/keys';
export const OPEN_ROUTER_BASE_URL = 'https://openrouter.ai/api';
export const OPEN_ROUTER_OPENAI_BASE_URL = `${OPEN_ROUTER_BASE_URL}/v1`;

export const OPEN_ROUTER_BASE_URL_OPTIONS = [
  {
    id: 'standard',
    baseUrl: OPEN_ROUTER_BASE_URL,
    openaiBaseUrl: OPEN_ROUTER_OPENAI_BASE_URL,
    codexBaseUrl: OPEN_ROUTER_OPENAI_BASE_URL,
    anthropicBaseUrl: OPEN_ROUTER_BASE_URL,
    geminiBaseUrl: OPEN_ROUTER_BASE_URL,
  },
] as const;

export const OPEN_ROUTER_PROTOCOL_LABELS = ['openai'] as const;

const normalizeBaseUrl = (value: string | undefined | null): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '');

const isOpenRouterHost = (value: string | undefined | null): boolean => {
  try {
    const host = new URL(String(value ?? '').trim()).hostname.toLowerCase();
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
  } catch {
    return false;
  }
};

export const resolveOpenRouterBaseUrl = (value: string | undefined | null): string => {
  const normalized = normalizeBaseUrl(value);
  const matched = OPEN_ROUTER_BASE_URL_OPTIONS.find(
    (option) =>
      normalized === normalizeBaseUrl(option.baseUrl) ||
      normalized === normalizeBaseUrl(option.openaiBaseUrl)
  );
  return matched?.baseUrl ?? OPEN_ROUTER_BASE_URL;
};

export const getOpenRouterProtocolUrls = (value: string | undefined | null) => {
  const baseUrl = resolveOpenRouterBaseUrl(value);
  const matched =
    OPEN_ROUTER_BASE_URL_OPTIONS.find(
      (option) => normalizeBaseUrl(option.baseUrl) === normalizeBaseUrl(baseUrl)
    ) ?? OPEN_ROUTER_BASE_URL_OPTIONS[0];
  return {
    anthropic: matched.anthropicBaseUrl,
    openai: matched.openaiBaseUrl,
    codex: matched.codexBaseUrl,
    gemini: matched.geminiBaseUrl,
  };
};

// Any OpenAI-compatible entry pointing at OpenRouter belongs here, including ones created before this preset.
export const isOpenRouterOpenAIProvider = (
  config: OpenAIProviderConfig | undefined | null
): boolean => {
  if (!config) return false;
  return isOpenRouterHost(config.baseUrl);
};

export const buildOpenRouterRaw = (config: Config | null | undefined): SponsorProviderRaw => ({
  openai: (config?.openaiCompatibility ?? [])
    .map((item, index) => ({ config: item, index: item.sourceIndex ?? index }))
    .filter((item) => isOpenRouterOpenAIProvider(item.config)),
  claude: [],
  codex: [],
  gemini: [],
});
