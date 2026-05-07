import type {
  AmpcodeConfig,
  AmpcodeModelMapping,
  AmpcodeUpstreamApiKeyMapping,
  ApiKeyEntry,
  OpenAIProviderConfig,
} from '@/types';
import {
  buildRecentRequestCompositeKey,
  mergeRecentRequestBucketGroups,
  normalizeRecentRequestAuthIndex,
  statusBarDataFromRecentRequests,
  sumRecentRequests,
  type RecentRequestBucket,
  type RecentRequestUsageEntry,
  type StatusBarData,
} from '@/utils/recentRequests';
import type { AmpcodeFormState, AmpcodeUpstreamApiKeyEntry, ModelEntry } from './types';

export const DISABLE_ALL_MODELS_RULE = '*';

export const hasDisableAllModelsRule = (models?: string[]) =>
  Array.isArray(models) &&
  models.some((model) => String(model ?? '').trim() === DISABLE_ALL_MODELS_RULE);

export const stripDisableAllModelsRule = (models?: string[]) =>
  Array.isArray(models)
    ? models.filter((model) => String(model ?? '').trim() !== DISABLE_ALL_MODELS_RULE)
    : [];

export const withDisableAllModelsRule = (models?: string[]) => {
  const base = stripDisableAllModelsRule(models);
  return [...base, DISABLE_ALL_MODELS_RULE];
};

export const withoutDisableAllModelsRule = (models?: string[]) => {
  const base = stripDisableAllModelsRule(models);
  return base;
};

export const parseTextList = (text: string): string[] =>
  text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

export const parseExcludedModels = parseTextList;

export const excludedModelsToText = (models?: string[]) =>
  Array.isArray(models) ? models.join('\n') : '';

export const normalizeOpenAIBaseUrl = (baseUrl: string): string => {
  let trimmed = String(baseUrl || '').trim();
  if (!trimmed) return '';
  trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '');
  trimmed = trimmed.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed;
};

export const normalizeClaudeBaseUrl = (baseUrl: string): string => {
  let trimmed = String(baseUrl || '').trim();
  if (!trimmed) {
    return 'https://api.anthropic.com';
  }
  trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '');
  trimmed = trimmed.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed;
};

export const buildOpenAIModelsEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeOpenAIBaseUrl(baseUrl);
  if (!trimmed) return '';
  return `${trimmed}/models`;
};

export const buildOpenAIChatCompletionsEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeOpenAIBaseUrl(baseUrl);
  if (!trimmed) return '';
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
};

export const buildClaudeMessagesEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeClaudeBaseUrl(baseUrl);
  if (!trimmed) return '';
  if (trimmed.endsWith('/v1/messages')) {
    return trimmed;
  }
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/messages`;
  }
  return `${trimmed}/v1/messages`;
};

export type ProviderRecentUsageMap = Map<string, Map<string, RecentRequestUsageEntry>>;

const EMPTY_RECENT_USAGE_ENTRY: RecentRequestUsageEntry = {
  success: 0,
  failed: 0,
  recentRequests: [],
};

const normalizeProviderRecentKey = (value: unknown): string =>
  String(value ?? '').trim().toLowerCase();

export function getProviderRecentUsageEntry(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): RecentRequestUsageEntry {
  if (!String(apiKey ?? '').trim()) {
    return EMPTY_RECENT_USAGE_ENTRY;
  }

  const providerKey = normalizeProviderRecentKey(provider);
  const compositeKey = buildRecentRequestCompositeKey(baseUrl, apiKey);
  return usageByProvider.get(providerKey)?.get(compositeKey) ?? EMPTY_RECENT_USAGE_ENTRY;
}

export function getProviderRecentBuckets(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): RecentRequestBucket[] {
  return getProviderRecentUsageEntry(
    usageByProvider,
    provider,
    apiKey,
    baseUrl
  ).recentRequests;
}

export function getProviderTotalStats(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): { success: number; failure: number } {
  const entry = getProviderRecentUsageEntry(usageByProvider, provider, apiKey, baseUrl);
  return { success: entry.success, failure: entry.failed };
}

export function getProviderRecentWindowStats(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): { success: number; failure: number } {
  return sumRecentRequests(getProviderRecentBuckets(usageByProvider, provider, apiKey, baseUrl));
}

export function getProviderRecentStats(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): { success: number; failure: number } {
  return getProviderTotalStats(usageByProvider, provider, apiKey, baseUrl);
}

export function getProviderRecentStatusData(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  apiKey?: string,
  baseUrl?: string
): StatusBarData {
  return statusBarDataFromRecentRequests(
    getProviderRecentBuckets(usageByProvider, provider, apiKey, baseUrl)
  );
}

export function collectOpenAIProviderRecentBuckets(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): RecentRequestBucket[] {
  if (!provider.apiKeyEntries?.length) {
    return [];
  }

  const groups = provider.apiKeyEntries.map((entry) =>
    getProviderRecentBuckets(usageByProvider, provider.name, entry.apiKey, provider.baseUrl)
  );

  return mergeRecentRequestBucketGroups(groups);
}

export function getOpenAIProviderRecentStats(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } {
  return getOpenAIProviderTotalStats(provider, usageByProvider);
}

export function getOpenAIProviderTotalStats(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } {
  return (provider.apiKeyEntries || []).reduce(
    (total, entry) => {
      const usageEntry = getProviderRecentUsageEntry(
        usageByProvider,
        provider.name,
        entry.apiKey,
        provider.baseUrl
      );

      return {
        success: total.success + usageEntry.success,
        failure: total.failure + usageEntry.failed,
      };
    },
    { success: 0, failure: 0 }
  );
}

export function getOpenAIProviderRecentWindowStats(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } {
  return sumRecentRequests(collectOpenAIProviderRecentBuckets(provider, usageByProvider));
}

export function getOpenAIProviderRecentStatusData(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): StatusBarData {
  return statusBarDataFromRecentRequests(
    collectOpenAIProviderRecentBuckets(provider, usageByProvider)
  );
}

export const getProviderConfigKey = (
  config: {
    authIndex?: unknown;
    apiKey?: string;
    baseUrl?: string;
    proxyUrl?: string;
  },
  index: number
): string => {
  const authIndexKey = normalizeRecentRequestAuthIndex(config.authIndex);
  if (authIndexKey) {
    return authIndexKey;
  }
  return `${config.apiKey ?? ''}::${config.baseUrl ?? ''}::${config.proxyUrl ?? ''}::${index}`;
};

export const getOpenAIProviderKey = (provider: OpenAIProviderConfig, index: number): string => {
  const authIndexKey = normalizeRecentRequestAuthIndex(provider.authIndex);
  if (authIndexKey) {
    return authIndexKey;
  }
  return `${provider.name}::${provider.baseUrl}::${provider.prefix ?? ''}::${index}`;
};

export const getOpenAIEntryKey = (entry: ApiKeyEntry, index: number): string => {
  const authIndexKey = normalizeRecentRequestAuthIndex(entry.authIndex);
  if (authIndexKey) {
    return authIndexKey;
  }
  return `${entry.apiKey}::${entry.proxyUrl ?? ''}::${index}`;
};

export const buildApiKeyEntry = (input?: Partial<ApiKeyEntry>): ApiKeyEntry => ({
  apiKey: input?.apiKey ?? '',
  proxyUrl: input?.proxyUrl ?? '',
  headers: input?.headers ?? {},
  authIndex: input?.authIndex ?? undefined,
  balanceToken: input?.balanceToken ?? undefined,
});

export const ampcodeMappingsToEntries = (mappings?: AmpcodeModelMapping[]): ModelEntry[] => {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return [{ name: '', alias: '' }];
  }
  return mappings.map((mapping) => ({
    name: mapping.from ?? '',
    alias: mapping.to ?? '',
  }));
};

export const entriesToAmpcodeMappings = (entries: ModelEntry[]): AmpcodeModelMapping[] => {
  const seen = new Set<string>();
  const mappings: AmpcodeModelMapping[] = [];

  entries.forEach((entry) => {
    const from = entry.name.trim();
    const to = entry.alias.trim();
    if (!from || !to) return;
    const key = from.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    mappings.push({ from, to });
  });

  return mappings;
};

export const ampcodeUpstreamApiKeysToEntries = (
  mappings?: AmpcodeUpstreamApiKeyMapping[]
): AmpcodeUpstreamApiKeyEntry[] => {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return [{ upstreamApiKey: '', clientApiKeysText: '' }];
  }

  return mappings.map((mapping) => ({
    upstreamApiKey: mapping.upstreamApiKey ?? '',
    clientApiKeysText: Array.isArray(mapping.apiKeys) ? mapping.apiKeys.join('\n') : '',
  }));
};

export const entriesToAmpcodeUpstreamApiKeys = (
  entries: AmpcodeUpstreamApiKeyEntry[]
): AmpcodeUpstreamApiKeyMapping[] => {
  const seen = new Set<string>();
  const mappings: AmpcodeUpstreamApiKeyMapping[] = [];

  entries.forEach((entry) => {
    const upstreamApiKey = String(entry?.upstreamApiKey ?? '').trim();
    if (!upstreamApiKey || seen.has(upstreamApiKey)) return;

    const apiKeys = Array.from(new Set(parseTextList(String(entry?.clientApiKeysText ?? ''))));
    if (!apiKeys.length) return;

    seen.add(upstreamApiKey);
    mappings.push({ upstreamApiKey, apiKeys });
  });

  return mappings;
};

export const buildAmpcodeFormState = (ampcode?: AmpcodeConfig | null): AmpcodeFormState => ({
  upstreamUrl: ampcode?.upstreamUrl ?? '',
  upstreamApiKey: '',
  forceModelMappings: ampcode?.forceModelMappings ?? false,
  mappingEntries: ampcodeMappingsToEntries(ampcode?.modelMappings),
  upstreamApiKeyEntries: ampcodeUpstreamApiKeysToEntries(ampcode?.upstreamApiKeys),
});
