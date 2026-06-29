import type { OpenAIProviderConfig } from '@/types';
import {
  buildRecentRequestCompositeKey,
  mergeRecentRequestBucketGroups,
  statusBarDataFromRecentRequests,
  sumRecentRequests,
  type RecentRequestBucket,
  type RecentRequestUsageEntry,
  type StatusBarData,
} from '@/utils/recentRequests';

const DISABLE_ALL_MODELS_RULE = '*';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

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

export const withoutDisableAllModelsRule = (models?: string[]) => stripDisableAllModelsRule(models);

const normalizeUpstreamBaseUrl = (baseUrl: string, fallback = ''): string => {
  let trimmed = String(baseUrl || '').trim();
  if (!trimmed) return fallback;
  trimmed = trimmed.replace(/\/?v0\/management\/?$/i, '');
  trimmed = trimmed.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `http://${trimmed}`;
  }
  return trimmed;
};

const buildGeminiModelResource = (model: string): string => {
  const trimmed = String(model || '')
    .trim()
    .replace(/^\/+/g, '')
    .replace(/:generateContent$/i, '');
  if (!trimmed) return '';

  if (/^(models|tunedModels)\//i.test(trimmed)) {
    return trimmed.split('/').map(encodeURIComponent).join('/');
  }

  return `models/${encodeURIComponent(trimmed)}`;
};

export const buildOpenAIChatCompletionsEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeUpstreamBaseUrl(baseUrl);
  if (!trimmed) return '';
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
};

export const buildCodexResponsesEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeUpstreamBaseUrl(baseUrl);
  if (!trimmed) return '';
  if (/\/v1\/responses$/i.test(trimmed)) {
    return trimmed;
  }
  if (/\/v1\/models$/i.test(trimmed)) {
    return trimmed.replace(/\/models$/i, '/responses');
  }
  if (/\/v1$/i.test(trimmed)) {
    return `${trimmed}/responses`;
  }
  return `${trimmed}/v1/responses`;
};

export const buildClaudeMessagesEndpoint = (baseUrl: string): string => {
  const trimmed = normalizeUpstreamBaseUrl(baseUrl, 'https://api.anthropic.com');
  if (!trimmed) return '';
  if (trimmed.endsWith('/v1/messages')) {
    return trimmed;
  }
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/messages`;
  }
  return `${trimmed}/v1/messages`;
};

export const buildGeminiGenerateContentEndpoint = (baseUrl: string, model: string): string => {
  const resource = buildGeminiModelResource(model);
  if (!resource) return '';

  const trimmed = normalizeUpstreamBaseUrl(baseUrl, DEFAULT_GEMINI_BASE_URL);
  if (!trimmed) return '';
  if (/:generateContent$/i.test(trimmed)) {
    return trimmed;
  }

  let root = trimmed.replace(/\/+$/g, '');
  if (/\/v1beta\/models$/i.test(root)) {
    root = root.replace(/\/models$/i, '');
  } else if (!/\/v1beta$/i.test(root)) {
    root = root.replace(/\/v1beta(?:\/.*)?$/i, '');
    root = `${root}/v1beta`;
  }

  return `${root}/${resource}:generateContent`;
};

export type ProviderRecentUsageMap = Map<string, Map<string, RecentRequestUsageEntry>>;

export interface ProviderRecentUsageIdentity {
  apiKey?: string | null;
  authKey?: string | null;
  authSource?: string | null;
  baseUrl?: string | null;
}

const EMPTY_RECENT_USAGE_ENTRY: RecentRequestUsageEntry = {
  success: 0,
  failed: 0,
  recentRequests: [],
};

const normalizeProviderRecentKey = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const normalizeProviderRecentIdentity = (value: unknown): string => String(value ?? '').trim();

const isCommandAuthSource = (value: unknown): boolean =>
  normalizeProviderRecentKey(value) === 'command';

const getCommandAuthRecentUsageEntry = (
  entries: Map<string, RecentRequestUsageEntry> | undefined,
  authKey: string,
  baseUrl?: string | null
): RecentRequestUsageEntry => {
  if (!entries) {
    return EMPTY_RECENT_USAGE_ENTRY;
  }

  const base = normalizeProviderRecentIdentity(baseUrl);
  const byCompositeKey = entries.get(buildRecentRequestCompositeKey(base, authKey));
  if (byCompositeKey) {
    return byCompositeKey;
  }

  const byLegacyKey = entries.get(buildRecentRequestCompositeKey(base, ''));
  if (byLegacyKey?.authKey === authKey && isCommandAuthSource(byLegacyKey.authSource)) {
    return byLegacyKey;
  }

  for (const entry of entries.values()) {
    if (entry.authKey === authKey && isCommandAuthSource(entry.authSource)) {
      return entry;
    }
  }

  return EMPTY_RECENT_USAGE_ENTRY;
};

const getProviderRecentUsageEntry = (
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  identity?: string | ProviderRecentUsageIdentity | null,
  baseUrl?: string
): RecentRequestUsageEntry => {
  const providerKey = normalizeProviderRecentKey(provider);
  const providerEntries = usageByProvider.get(providerKey);
  const resourceIdentity =
    typeof identity === 'object' && identity !== null
      ? identity
      : { apiKey: identity, baseUrl };
  const apiKey = normalizeProviderRecentIdentity(resourceIdentity.apiKey);
  const authKey = normalizeProviderRecentIdentity(resourceIdentity.authKey);
  const resolvedBaseUrl = resourceIdentity.baseUrl ?? baseUrl;

  if (apiKey) {
    const compositeKey = buildRecentRequestCompositeKey(resolvedBaseUrl, apiKey);
    return providerEntries?.get(compositeKey) ?? EMPTY_RECENT_USAGE_ENTRY;
  }

  if (authKey && isCommandAuthSource(resourceIdentity.authSource)) {
    return getCommandAuthRecentUsageEntry(providerEntries, authKey, resolvedBaseUrl);
  }

  return EMPTY_RECENT_USAGE_ENTRY;
};

const getProviderRecentBuckets = (
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  identity?: string | ProviderRecentUsageIdentity | null,
  baseUrl?: string
): RecentRequestBucket[] =>
  getProviderRecentUsageEntry(usageByProvider, provider, identity, baseUrl).recentRequests;

export function getProviderRecentStatusData(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  identity?: string | ProviderRecentUsageIdentity | null,
  baseUrl?: string
): StatusBarData {
  return statusBarDataFromRecentRequests(
    getProviderRecentBuckets(usageByProvider, provider, identity, baseUrl)
  );
}

export function getProviderTotalStats(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  identity?: string | ProviderRecentUsageIdentity | null,
  baseUrl?: string
): { success: number; failure: number } {
  const entry = getProviderRecentUsageEntry(usageByProvider, provider, identity, baseUrl);
  return { success: entry.success, failure: entry.failed };
}

export function getProviderRecentWindowStats(
  usageByProvider: ProviderRecentUsageMap,
  provider: string,
  identity?: string | ProviderRecentUsageIdentity | null,
  baseUrl?: string
): { success: number; failure: number } {
  return sumRecentRequests(getProviderRecentBuckets(usageByProvider, provider, identity, baseUrl));
}

const collectOpenAIProviderRecentBuckets = (
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): RecentRequestBucket[] => {
  if (provider.auth?.command && provider.authKey && isCommandAuthSource(provider.authSource)) {
    return getProviderRecentBuckets(usageByProvider, provider.name, {
      authKey: provider.authKey,
      authSource: provider.authSource,
      baseUrl: provider.baseUrl,
    });
  }

  if (!provider.apiKeyEntries?.length) {
    return [];
  }

  const groups = provider.apiKeyEntries.map((entry) =>
    getProviderRecentBuckets(usageByProvider, provider.name, entry.apiKey, provider.baseUrl)
  );

  return mergeRecentRequestBucketGroups(groups);
};

export function getOpenAIProviderRecentWindowStats(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } {
  return sumRecentRequests(collectOpenAIProviderRecentBuckets(provider, usageByProvider));
}

export function getOpenAIProviderTotalStats(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): { success: number; failure: number } {
  if (provider.auth?.command && provider.authKey && isCommandAuthSource(provider.authSource)) {
    return getProviderTotalStats(usageByProvider, provider.name, {
      authKey: provider.authKey,
      authSource: provider.authSource,
      baseUrl: provider.baseUrl,
    });
  }

  return (provider.apiKeyEntries || []).reduce(
    (total, entry) => {
      const usageEntry = getProviderRecentUsageEntry(
        usageByProvider,
        provider.name,
        {
          apiKey: entry.apiKey,
          authKey: entry.authKey,
          authSource: entry.authSource,
          baseUrl: provider.baseUrl,
        }
      );
      return {
        success: total.success + usageEntry.success,
        failure: total.failure + usageEntry.failed,
      };
    },
    { success: 0, failure: 0 }
  );
}

export function getOpenAIProviderRecentStatusData(
  provider: OpenAIProviderConfig,
  usageByProvider: ProviderRecentUsageMap
): StatusBarData {
  return statusBarDataFromRecentRequests(
    collectOpenAIProviderRecentBuckets(provider, usageByProvider)
  );
}
