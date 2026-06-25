import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import { hasDisableAllModelsRule, stripDisableAllModelsRule } from '@/components/providers/utils';
import { maskApiKey } from '@/utils/format';
import {
  APIKEY_FUN_DISPLAY_NAME,
  APIKEY_FUN_PROTOCOLS,
  getApiKeyFunProtocolUrls,
  resolveApiKeyFunBaseUrl,
} from './sponsor';
import type {
  ProviderBrand,
  ProviderResource,
  ProviderResourceSelector,
  SponsorProviderRaw,
} from './types';

const countHeaders = (headers?: Record<string, string>): number =>
  headers ? Object.keys(headers).length : 0;

const collectModelNames = (models?: Array<{ name?: string }>): string[] => {
  const seen = new Set<string>();
  (models ?? []).forEach((model) => {
    const name = (model?.name ?? '').trim();
    if (name) seen.add(name);
  });
  return Array.from(seen);
};

const normalizePriority = (priority?: number): number =>
  typeof priority === 'number' && Number.isFinite(priority) ? priority : 0;

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
    models: collectModelNames(config.models),
    priority: normalizePriority(config.priority),
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

export function openaiToResource(config: OpenAIProviderConfig, index: number): ProviderResource {
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
    models: collectModelNames(config.models),
    priority: normalizePriority(config.priority),
    headerCount: countHeaders(config.headers),
    excludedModelCount: 0,
    apiKeyEntryCount: config.apiKeyEntries?.length ?? 0,
    disabled: config.disabled === true,
    flags: {},
    selector: { brand: 'openaiCompatibility', name, index },
    raw: config,
  };
}

export function apiKeyFunToResource(raw: SponsorProviderRaw): ProviderResource | null {
  if (raw.openai.length === 0 && raw.claude.length === 0 && raw.codex.length === 0) {
    return null;
  }
  const openaiKeyCount = raw.openai.reduce(
    (count, item) => count + (item.config.apiKeyEntries?.length ?? 0),
    0
  );
  const codexKeyCount = raw.codex.length;
  const firstOpenAIEntry = raw.openai
    .flatMap((item) => item.config.apiKeyEntries ?? [])
    .find((entry) => entry.apiKey?.trim());
  const firstCodex = raw.codex.find((item) => item.config.apiKey?.trim());
  const firstClaude = raw.claude.find((item) => item.config.apiKey?.trim());
  const apiKey =
    firstOpenAIEntry?.apiKey ?? firstCodex?.config.apiKey ?? firstClaude?.config.apiKey ?? '';
  const openaiDisabled =
    raw.openai.length > 0 && raw.openai.every((item) => item.config.disabled === true);
  const codexDisabled =
    raw.codex.length > 0 &&
    raw.codex.every((item) => hasDisableAllModelsRule(item.config.excludedModels));
  const claudeDisabled =
    raw.claude.length > 0 &&
    raw.claude.every((item) => hasDisableAllModelsRule(item.config.excludedModels));
  const enabledCount =
    (raw.openai.length > 0 && !openaiDisabled ? 1 : 0) +
    (raw.codex.length > 0 && !codexDisabled ? 1 : 0) +
    (raw.claude.length > 0 && !claudeDisabled ? 1 : 0);
  const allResourcesConfigured =
    raw.openai.length > 0 || raw.codex.length > 0 || raw.claude.length > 0;
  const disabled = allResourcesConfigured && enabledCount === 0;
  const models = [
    ...raw.openai.flatMap((item) => collectModelNames(item.config.models)),
    ...raw.codex.flatMap((item) => collectModelNames(item.config.models)),
    ...raw.claude.flatMap((item) => collectModelNames(item.config.models)),
  ];
  const uniqueModels = Array.from(new Set(models));
  const headerCount =
    raw.openai.reduce((count, item) => count + countHeaders(item.config.headers), 0) +
    raw.codex.reduce((count, item) => count + countHeaders(item.config.headers), 0) +
    raw.claude.reduce((count, item) => count + countHeaders(item.config.headers), 0);
  const priority = Math.max(
    0,
    ...raw.openai.map((item) => normalizePriority(item.config.priority)),
    ...raw.codex.map((item) => normalizePriority(item.config.priority)),
    ...raw.claude.map((item) => normalizePriority(item.config.priority))
  );
  const baseUrl = resolveApiKeyFunBaseUrl(
    raw.openai[0]?.config.baseUrl ?? raw.codex[0]?.config.baseUrl ?? raw.claude[0]?.config.baseUrl
  );
  const protocolUrls = getApiKeyFunProtocolUrls(baseUrl);

  return {
    id: buildId('apikeyFun', 0, 'sponsor'),
    brand: 'apikeyFun',
    originalIndex: 0,
    name: APIKEY_FUN_DISPLAY_NAME,
    identifier: APIKEY_FUN_DISPLAY_NAME,
    apiKeyPreview: apiKey ? maskApiKey(apiKey) : null,
    apiKey: apiKey || null,
    authIndex: null,
    baseUrl: `${protocolUrls.openai} / ${protocolUrls.anthropic}`,
    proxyUrl:
      firstOpenAIEntry?.proxyUrl ??
      raw.codex.find((item) => item.config.proxyUrl)?.config.proxyUrl ??
      raw.claude.find((item) => item.config.proxyUrl)?.config.proxyUrl ??
      null,
    prefix:
      raw.openai[0]?.config.prefix ??
      raw.codex[0]?.config.prefix ??
      raw.claude[0]?.config.prefix ??
      null,
    modelCount: uniqueModels.length,
    models: uniqueModels,
    priority,
    headerCount,
    excludedModelCount:
      raw.codex.reduce(
        (count, item) => count + stripDisableAllModelsRule(item.config.excludedModels).length,
        0
      ) +
      raw.claude.reduce(
        (count, item) => count + stripDisableAllModelsRule(item.config.excludedModels).length,
        0
      ),
    apiKeyEntryCount: openaiKeyCount + codexKeyCount + raw.claude.length,
    disabled,
    flags: {
      protocols: [...APIKEY_FUN_PROTOCOLS],
    },
    selector: {
      brand: 'apikeyFun',
      openaiIndices: raw.openai.map((item) => item.index),
      claudeIndices: raw.claude.map((item) => item.index),
      codexIndices: raw.codex.map((item) => item.index),
    } as ProviderResourceSelector,
    raw,
  };
}
