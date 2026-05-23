import type {
  AmpcodeConfig,
  GeminiKeyConfig,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';
import {
  hasDisableAllModelsRule,
  stripDisableAllModelsRule,
} from '@/components/providers/utils';
import { maskApiKey } from '@/utils/format';
import type {
  ProviderBrand,
  ProviderResource,
  ProviderResourceSelector,
} from './types';

const countHeaders = (headers?: Record<string, string>): number =>
  headers ? Object.keys(headers).length : 0;

const buildId = (brand: ProviderBrand, index: number, fragment: string) =>
  `${brand}:${index}:${fragment || 'item'}`;

const truncateForId = (value: string | undefined | null): string => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 12) return trimmed;
  return trimmed.slice(0, 8);
};

function providerKeyToResource(
  brand: 'gemini' | 'codex' | 'claude' | 'vertex',
  config: GeminiKeyConfig | ProviderKeyConfig,
  index: number
): ProviderResource {
  const apiKey = config.apiKey ?? '';
  const disabled = hasDisableAllModelsRule(config.excludedModels);
  const flags: ProviderResource['flags'] = {};
  if (brand === 'codex') {
    flags.websockets = (config as ProviderKeyConfig).websockets === true;
  }
  if (brand === 'claude') {
    const cloak = (config as ProviderKeyConfig).cloak;
    flags.cloakEnabled = Boolean(cloak?.mode?.trim());
  }

  const selector: ProviderResourceSelector = {
    brand,
    apiKey,
    baseUrl: config.baseUrl,
    index,
  } as ProviderResourceSelector;

  return {
    id: buildId(brand, index, truncateForId(apiKey)),
    brand,
    originalIndex: index,
    name: null,
    identifier: maskApiKey(apiKey) || `#${index + 1}`,
    apiKeyPreview: apiKey ? maskApiKey(apiKey) : null,
    apiKey: apiKey || null,
    authIndex: config.authIndex ?? null,
    baseUrl: config.baseUrl ?? null,
    proxyUrl: config.proxyUrl ?? null,
    prefix: config.prefix ?? null,
    modelCount: config.models?.length ?? 0,
    headerCount: countHeaders(config.headers),
    excludedModelCount: stripDisableAllModelsRule(config.excludedModels).length,
    apiKeyEntryCount: 0,
    disabled,
    flags,
    selector,
    raw: config,
  };
}

export function geminiToResource(config: GeminiKeyConfig, index: number): ProviderResource {
  return providerKeyToResource('gemini', config, index);
}

export function codexToResource(config: ProviderKeyConfig, index: number): ProviderResource {
  return providerKeyToResource('codex', config, index);
}

export function claudeToResource(config: ProviderKeyConfig, index: number): ProviderResource {
  return providerKeyToResource('claude', config, index);
}

export function vertexToResource(config: ProviderKeyConfig, index: number): ProviderResource {
  return providerKeyToResource('vertex', config, index);
}

export function openaiToResource(
  config: OpenAIProviderConfig,
  index: number
): ProviderResource {
  const name = (config.name ?? '').trim();
  const firstEntry = config.apiKeyEntries?.[0];
  const previewApiKey = firstEntry?.apiKey ? maskApiKey(firstEntry.apiKey) : null;
  return {
    id: buildId('openaiCompatibility', index, truncateForId(name) || `#${index}`),
    brand: 'openaiCompatibility',
    originalIndex: index,
    name: name || null,
    identifier: name || `#${index + 1}`,
    apiKeyPreview: previewApiKey,
    apiKey: null,
    authIndex: config.authIndex ?? null,
    baseUrl: config.baseUrl ?? null,
    proxyUrl: null,
    prefix: config.prefix ?? null,
    modelCount: config.models?.length ?? 0,
    headerCount: countHeaders(config.headers),
    excludedModelCount: 0,
    apiKeyEntryCount: config.apiKeyEntries?.length ?? 0,
    disabled: config.disabled === true,
    flags: {},
    selector: { brand: 'openaiCompatibility', name, index },
    raw: config,
  };
}

export function ampcodeToResource(config?: AmpcodeConfig | null): ProviderResource {
  const safe: AmpcodeConfig = config ?? {};
  const upstreamApiKey = safe.upstreamApiKey ?? '';
  const upstreamUrl = (safe.upstreamUrl ?? '').trim();
  const hasUpstream = upstreamUrl.length > 0;
  const upstreamKeyMappingsCount = safe.upstreamApiKeys?.length ?? 0;
  return {
    id: 'ampcode:singleton',
    brand: 'ampcode',
    originalIndex: 0,
    name: null,
    identifier: 'Amp CLI',
    apiKeyPreview: upstreamApiKey ? maskApiKey(upstreamApiKey) : null,
    apiKey: upstreamApiKey || null,
    authIndex: null,
    baseUrl: upstreamUrl || null,
    proxyUrl: null,
    prefix: null,
    modelCount: safe.modelMappings?.length ?? 0,
    headerCount: 0,
    excludedModelCount: 0,
    apiKeyEntryCount: upstreamKeyMappingsCount,
    disabled: !hasUpstream,
    flags: {
      forceModelMappings: safe.forceModelMappings === true,
      isPlaceholder: !hasUpstream && upstreamKeyMappingsCount === 0,
    },
    selector: { brand: 'ampcode' },
    raw: safe,
  };
}
