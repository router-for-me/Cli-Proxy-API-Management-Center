import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { providersApi } from '@/services/api';
import { getErrorMessage } from '@/utils/helpers';
import { useAuthStore, useConfigStore } from '@/stores';
import {
  stripDisableAllModelsRule,
  withDisableAllModelsRule,
  withoutDisableAllModelsRule,
} from '@/components/providers/utils';
import type { GeminiKeyConfig, ModelAlias, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import {
  apiKeyFunToResource,
  claudeApiToResource,
  claudeToResource,
  code0ToResource,
  codexToResource,
  fennoAIToResource,
  geminiToResource,
  openaiToResource,
  qiniuCloudToResource,
  vertexToResource,
} from './adapters';
import { PROVIDER_BRAND_ORDER } from './descriptors';
import type {
  ProviderBrand,
  ProviderEntryFormInput,
  ProviderGroup,
  ProviderResource,
  ProviderSnapshot,
  SponsorKeyEntryInput,
  SponsorProviderBrand,
} from './types';
import {
  buildApiKeyFunRaw,
  isApiKeyFunClaudeProvider,
  isApiKeyFunCodexProvider,
  isApiKeyFunOpenAIProvider,
} from './sponsor';
import { CLAUDE_API_BASE_URL, isClaudeApiProvider } from './claudeApi';
import {
  buildCode0Raw,
  isCode0ClaudeProvider,
  isCode0CodexProvider,
  isCode0GeminiProvider,
  isCode0OpenAIProvider,
} from './code0';
import {
  buildFennoAIRaw,
  isFennoAIClaudeProvider,
  isFennoAICodexProvider,
  isFennoAIOpenAIProvider,
} from './fennoAI';
import {
  buildQiniuCloudRaw,
  isQiniuCloudClaudeProvider,
  isQiniuCloudCodexProvider,
  isQiniuCloudGeminiProvider,
  isQiniuCloudOpenAIProvider,
} from './qiniuCloud';
import {
  getSponsorProviderDefinition,
  type SponsorProtocolUrls,
} from './sponsorDefinitions';

export interface UseProviderWorkbenchResult {
  connected: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage: string | null;
  snapshot: ProviderSnapshot | null;
  refetch: () => Promise<void>;

  createProvider: (brand: ProviderBrand, input: ProviderEntryFormInput) => Promise<void>;
  updateProvider: (resource: ProviderResource, input: ProviderEntryFormInput) => Promise<void>;
  deleteProvider: (resource: ProviderResource) => Promise<void>;
  toggleDisabled: (resource: ProviderResource, disabled: boolean) => Promise<void>;
  mutating: boolean;
  refreshSnapshot: () => void;
}

/* -------------------------------------------------------------------------- */
/* form -> backend config 转换                                                 */
/* -------------------------------------------------------------------------- */

const parseTextList = (text: string): string[] =>
  text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const headersFromEntries = (
  entries: Array<{ key: string; value: string }>
): Record<string, string> => {
  const out: Record<string, string> = {};
  entries.forEach((entry) => {
    const key = entry.key.trim();
    if (!key) return;
    out[key] = entry.value;
  });
  return out;
};

const parseThinkingJson = (value: string | undefined): Record<string, unknown> | undefined => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Thinking config must be a JSON object');
  }
  return parsed as Record<string, unknown>;
};

const buildExcludedModels = (
  textValue: string,
  disabled: boolean,
  brand: ProviderBrand
): string[] | undefined => {
  const list = parseTextList(textValue);
  const filtered = list.filter((v) => v !== '*');
  if (brand === 'openaiCompatibility') {
    return filtered.length ? filtered : undefined;
  }
  if (disabled) {
    return withDisableAllModelsRule(filtered);
  }
  return filtered.length ? filtered : undefined;
};

const buildModelAliases = (
  models: ProviderEntryFormInput['models'] | undefined,
  includeOpenAIFields = false
): ModelAlias[] =>
  (models ?? [])
    .map((m) => {
      const entry: ModelAlias = {
        name: m.name.trim(),
        alias: m.alias?.trim() || undefined,
        priority: m.priority,
        testModel: m.testModel,
      };
      if (includeOpenAIFields) {
        entry.image = m.image === true;
        entry.thinking = parseThinkingJson(m.thinkingJson);
      }
      return entry;
    })
    .filter((m) => m.name);

const buildProviderKeyConfig = (
  brand: 'gemini' | 'codex' | 'claude' | 'vertex',
  input: ProviderEntryFormInput,
  existing?: ProviderKeyConfig | GeminiKeyConfig | null
): ProviderKeyConfig | GeminiKeyConfig => {
  const headers = headersFromEntries(input.headers);
  const models = buildModelAliases(input.models);
  const excluded = buildExcludedModels(input.excludedModelsText, input.disabled, brand);
  const apiKeyChanged = input.apiKey.trim().length > 0;
  const next: ProviderKeyConfig = {
    apiKey: apiKeyChanged ? input.apiKey.trim() : (existing?.apiKey ?? ''),
    priority: input.priority,
    prefix: input.prefix.trim() || undefined,
    baseUrl: input.baseUrl.trim() || undefined,
    proxyUrl: input.proxyUrl.trim() || undefined,
    models: models.length ? models : undefined,
    headers: Object.keys(headers).length ? headers : undefined,
    excludedModels: excluded,
    disableCooling: input.disableCooling === true,
    authIndex: existing?.authIndex,
  };
  if (brand === 'codex' && input.websockets !== undefined) {
    next.websockets = input.websockets;
  }
  if (brand === 'claude' && input.cloak) {
    next.cloak = {
      mode: input.cloak.mode.trim() || undefined,
      strictMode: input.cloak.strictMode,
      sensitiveWords: parseTextList(input.cloak.sensitiveWordsText),
      cacheUserId: input.cloak.cacheUserId === true,
    };
  }
  if (brand === 'claude') {
    next.experimentalCchSigning = input.experimentalCchSigning === true;
  }
  return next;
};

const buildClaudeApiConfig = (
  input: ProviderEntryFormInput,
  existing?: ProviderKeyConfig | null
): ProviderKeyConfig =>
  buildProviderKeyConfig(
    'claude',
    {
      ...input,
      baseUrl: CLAUDE_API_BASE_URL,
    },
    existing
  ) as ProviderKeyConfig;

const buildOpenAIConfig = (
  input: ProviderEntryFormInput,
  existing?: OpenAIProviderConfig | null
): OpenAIProviderConfig => {
  const headers = headersFromEntries(input.headers);
  const models = buildModelAliases(input.models, true);
  const apiKeyEntries =
    input.apiKeyEntries
      ?.map((entry, index) => {
        const fallbackApiKey =
          entry.existingApiKey?.trim() || existing?.apiKeyEntries?.[index]?.apiKey?.trim() || '';
        return {
          apiKey: entry.apiKey.trim() || fallbackApiKey,
          proxyUrl: entry.proxyUrl.trim() || undefined,
          authIndex: entry.authIndex?.trim() || undefined,
        };
      })
      .filter((entry) => entry.apiKey) ?? [];

  return {
    ...(existing ?? {}),
    name: input.name.trim(),
    baseUrl: input.baseUrl.trim(),
    prefix: input.prefix.trim() || undefined,
    apiKeyEntries,
    disabled: input.disabled,
    disableCooling: input.disableCooling === true,
    headers: Object.keys(headers).length ? headers : undefined,
    models: models.length ? models : undefined,
    priority: input.priority,
    testModel: input.testModel?.trim() || undefined,
  };
};

const removeSponsorEntries = <T>(list: T[], indices: number[]): T[] => {
  const sponsorIndices = new Set(indices);
  return list.filter((_, index) => !sponsorIndices.has(index));
};

const sponsorEntryApiKey = (entry: SponsorKeyEntryInput): string =>
  entry.apiKey.trim() || entry.existingApiKey?.trim() || '';

const buildSponsorOpenAIConfig = (
  entry: SponsorKeyEntryInput,
  providerName: string,
  getProtocolUrls: (value: string | undefined | null) => SponsorProtocolUrls,
  existing?: OpenAIProviderConfig
): OpenAIProviderConfig => {
  const urls = getProtocolUrls(entry.baseUrl);
  const models = buildModelAliases(entry.models, true);
  const apiKey = sponsorEntryApiKey(entry);
  const firstExistingEntry = existing?.apiKeyEntries?.[0];
  const apiKeyEntries = apiKey
    ? [
        {
          ...(firstExistingEntry ?? {}),
          apiKey,
          proxyUrl: entry.proxyUrl.trim() || undefined,
        },
      ]
    : [];

  return {
    ...(existing ?? {}),
    name: providerName,
    baseUrl: urls.openai,
    prefix: entry.prefix.trim() || undefined,
    disabled: entry.disabled,
    disableCooling: entry.disableCooling === true,
    priority: entry.priority,
    apiKeyEntries,
    models: models.length ? models : undefined,
  };
};

const buildSponsorProviderKeyConfig = (
  entry: SponsorKeyEntryInput,
  protocol: 'claude' | 'codex',
  getProtocolUrls: (value: string | undefined | null) => SponsorProtocolUrls,
  existing?: ProviderKeyConfig
): ProviderKeyConfig => {
  const urls = getProtocolUrls(entry.baseUrl);
  const models = buildModelAliases(entry.models);
  const apiKey = sponsorEntryApiKey(entry);
  const excluded = entry.disabled
    ? withDisableAllModelsRule(stripDisableAllModelsRule(existing?.excludedModels))
    : withoutDisableAllModelsRule(existing?.excludedModels);

  return {
    ...(existing ?? {}),
    apiKey,
    baseUrl: protocol === 'claude' ? urls.anthropic : urls.codex,
    proxyUrl: entry.proxyUrl.trim() || undefined,
    prefix: entry.prefix.trim() || undefined,
    priority: entry.priority,
    disableCooling: entry.disableCooling === true,
    excludedModels: excluded,
    models: models.length ? models : undefined,
  };
};

const buildSponsorGeminiConfig = (
  entry: SponsorKeyEntryInput,
  getProtocolUrls: (value: string | undefined | null) => SponsorProtocolUrls,
  existing?: GeminiKeyConfig
): GeminiKeyConfig => {
  const urls = getProtocolUrls(entry.baseUrl);
  const models = buildModelAliases(entry.models);
  const apiKey = sponsorEntryApiKey(entry);
  const excluded = entry.disabled
    ? withDisableAllModelsRule(stripDisableAllModelsRule(existing?.excludedModels))
    : withoutDisableAllModelsRule(existing?.excludedModels);

  return {
    ...(existing ?? {}),
    apiKey,
    baseUrl: urls.gemini,
    proxyUrl: entry.proxyUrl.trim() || undefined,
    prefix: entry.prefix.trim() || undefined,
    priority: entry.priority,
    disableCooling: entry.disableCooling === true,
    excludedModels: excluded,
    models: models.length ? models : undefined,
  };
};

const normalizeSponsorKeyEntries = (
  entries: SponsorKeyEntryInput[] | undefined
): SponsorKeyEntryInput[] => (entries ?? []).filter((entry) => sponsorEntryApiKey(entry));

/* -------------------------------------------------------------------------- */
/* hook                                                                       */
/* -------------------------------------------------------------------------- */

export function useProviderWorkbench(): UseProviderWorkbenchResult {
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const config = useConfigStore((s) => s.config);
  const fetchConfig = useConfigStore((s) => s.fetchConfig);
  const updateConfigValue = useConfigStore((s) => s.updateConfigValue);
  const isCacheValid = useConfigStore((s) => s.isCacheValid);

  const [isPending, setIsPending] = useState<boolean>(() => !isCacheValid());
  const [isFetching, setIsFetching] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mutating, setMutating] = useState<boolean>(false);
  const [fetchedAt, setFetchedAt] = useState<string>(() => new Date().toISOString());

  const hasFetchedRef = useRef(false);

  const connected = connectionStatus === 'connected';

  const refetch = useCallback(async () => {
    setIsFetching(true);
    setErrorMessage(null);
    try {
      const [configResult, vertexResult, openaiResult] = await Promise.allSettled([
        fetchConfig(true),
        providersApi.getVertexConfigs(),
        providersApi.getOpenAIProviders(),
      ]);
      if (configResult.status !== 'fulfilled') {
        throw configResult.reason;
      }
      if (vertexResult.status === 'fulfilled') {
        updateConfigValue('vertex-api-key', vertexResult.value || []);
      }
      if (openaiResult.status === 'fulfilled') {
        updateConfigValue('openai-compatibility', openaiResult.value || []);
      }
      setFetchedAt(new Date().toISOString());
    } catch (err) {
      setErrorMessage(getErrorMessage(err) || 'Failed to load providers');
    } finally {
      setIsPending(false);
      setIsFetching(false);
    }
  }, [fetchConfig, updateConfigValue]);

  const refreshSnapshot = useCallback(() => {
    setFetchedAt(new Date().toISOString());
  }, []);

  useEffect(() => {
    if (hasFetchedRef.current) return;
    if (!connected) return;
    hasFetchedRef.current = true;
    refetch().catch(() => {});
  }, [connected, refetch]);

  /* ------------------- snapshot 计算 ------------------- */

  const snapshot = useMemo<ProviderSnapshot | null>(() => {
    if (!config) return null;
    const groups: ProviderGroup[] = PROVIDER_BRAND_ORDER.map((brand) => {
      let resources: ProviderResource[] = [];
      switch (brand) {
        case 'gemini':
          resources = (config.geminiApiKeys ?? []).reduce<ProviderResource[]>(
            (out, item, index) => {
              if (!isCode0GeminiProvider(item) && !isQiniuCloudGeminiProvider(item)) {
                out.push(geminiToResource(item, index));
              }
              return out;
            },
            []
          );
          break;
        case 'codex':
          resources = (config.codexApiKeys ?? []).reduce<ProviderResource[]>((out, item, index) => {
            if (
              !isApiKeyFunCodexProvider(item) &&
              !isCode0CodexProvider(item) &&
              !isFennoAICodexProvider(item) &&
              !isQiniuCloudCodexProvider(item)
            ) {
              out.push(codexToResource(item, index));
            }
            return out;
          }, []);
          break;
        case 'claude':
          resources = (config.claudeApiKeys ?? []).reduce<ProviderResource[]>(
            (out, item, index) => {
              if (
                !isApiKeyFunClaudeProvider(item) &&
                !isCode0ClaudeProvider(item) &&
                !isFennoAIClaudeProvider(item) &&
                !isQiniuCloudClaudeProvider(item) &&
                !isClaudeApiProvider(item)
              ) {
                out.push(claudeToResource(item, index));
              }
              return out;
            },
            []
          );
          break;
        case 'claudeApi':
          resources = (config.claudeApiKeys ?? []).reduce<ProviderResource[]>(
            (out, item, index) => {
              if (isClaudeApiProvider(item)) {
                out.push(claudeApiToResource(item, index));
              }
              return out;
            },
            []
          );
          break;
        case 'vertex':
          resources = (config.vertexApiKeys ?? []).map((c, i) => vertexToResource(c, i));
          break;
        case 'openaiCompatibility':
          resources = (config.openaiCompatibility ?? []).reduce<ProviderResource[]>(
            (out, item, index) => {
              if (
                !isApiKeyFunOpenAIProvider(item) &&
                !isCode0OpenAIProvider(item) &&
                !isFennoAIOpenAIProvider(item) &&
                !isQiniuCloudOpenAIProvider(item)
              ) {
                out.push(openaiToResource(item, index));
              }
              return out;
            },
            []
          );
          break;
        case 'apikeyFun': {
          const sponsorResource = apiKeyFunToResource(buildApiKeyFunRaw(config));
          resources = sponsorResource ? [sponsorResource] : [];
          break;
        }
        case 'code0': {
          const sponsorResource = code0ToResource(buildCode0Raw(config));
          resources = sponsorResource ? [sponsorResource] : [];
          break;
        }
        case 'fennoAI': {
          const sponsorResource = fennoAIToResource(buildFennoAIRaw(config));
          resources = sponsorResource ? [sponsorResource] : [];
          break;
        }
        case 'qiniuCloud': {
          const sponsorResource = qiniuCloudToResource(buildQiniuCloudRaw(config));
          resources = sponsorResource ? [sponsorResource] : [];
          break;
        }
      }
      return {
        id: brand,
        resources,
      };
    });
    return {
      fetchedAt,
      groups,
    };
  }, [config, fetchedAt]);

  /* ------------------- mutations ------------------- */

  const persistGeminiKeys = useCallback(
    async (next: GeminiKeyConfig[]) => {
      await providersApi.saveGeminiKeys(next);
      updateConfigValue('gemini-api-key', next);
    },
    [updateConfigValue]
  );

  const persistCodexConfigs = useCallback(
    async (next: ProviderKeyConfig[]) => {
      await providersApi.saveCodexConfigs(next);
      updateConfigValue('codex-api-key', next);
    },
    [updateConfigValue]
  );

  const persistClaudeConfigs = useCallback(
    async (next: ProviderKeyConfig[]) => {
      await providersApi.saveClaudeConfigs(next);
      updateConfigValue('claude-api-key', next);
    },
    [updateConfigValue]
  );

  const persistVertexConfigs = useCallback(
    async (next: ProviderKeyConfig[]) => {
      await providersApi.saveVertexConfigs(next);
      updateConfigValue('vertex-api-key', next);
    },
    [updateConfigValue]
  );

  const persistOpenAIConfigs = useCallback(
    async (next: OpenAIProviderConfig[]) => {
      await providersApi.saveOpenAIProviders(next);
      updateConfigValue('openai-compatibility', next);
    },
    [updateConfigValue]
  );

  const persistSponsorConfig = useCallback(
    async (brand: SponsorProviderBrand, input: ProviderEntryFormInput) => {
      const definition = getSponsorProviderDefinition(brand);
      const raw =
        brand === 'apikeyFun'
          ? buildApiKeyFunRaw(config)
          : brand === 'code0'
            ? buildCode0Raw(config)
            : brand === 'fennoAI'
              ? buildFennoAIRaw(config)
              : buildQiniuCloudRaw(config);
      const geminiList = config?.geminiApiKeys ?? [];
      const openaiList = config?.openaiCompatibility ?? [];
      const claudeList = config?.claudeApiKeys ?? [];
      const codexList = config?.codexApiKeys ?? [];
      const entries = normalizeSponsorKeyEntries(input.sponsorKeyEntries);
      const openaiEntry = entries.find((entry) => entry.protocol === 'openai');
      const claudeEntry = entries.find((entry) => entry.protocol === 'claude');
      const codexEntry = entries.find((entry) => entry.protocol === 'codex');
      const geminiEntry = entries.find((entry) => entry.protocol === 'gemini');
      const nextGeminiList = removeSponsorEntries(
        geminiList,
        raw.gemini.map((item) => item.index)
      );
      const nextOpenAIList = removeSponsorEntries(
        openaiList,
        raw.openai.map((item) => item.index)
      );
      const nextClaudeList = removeSponsorEntries(
        claudeList,
        raw.claude.map((item) => item.index)
      );
      const nextCodexList = removeSponsorEntries(
        codexList,
        raw.codex.map((item) => item.index)
      );

      if (definition.protocols.includes('gemini')) {
        await persistGeminiKeys(
          geminiEntry
            ? [
                ...nextGeminiList,
                buildSponsorGeminiConfig(
                  geminiEntry,
                  definition.getProtocolUrls,
                  raw.gemini[0]?.config
                ),
              ]
            : nextGeminiList
        );
      }
      await persistCodexConfigs(
        codexEntry
          ? [
              ...nextCodexList,
              buildSponsorProviderKeyConfig(
                codexEntry,
                'codex',
                definition.getProtocolUrls,
                raw.codex[0]?.config
              ),
            ]
          : nextCodexList
      );
      await persistClaudeConfigs(
        claudeEntry
          ? [
              ...nextClaudeList,
              buildSponsorProviderKeyConfig(
                claudeEntry,
                'claude',
                definition.getProtocolUrls,
                raw.claude[0]?.config
              ),
            ]
          : nextClaudeList
      );
      await persistOpenAIConfigs(
        openaiEntry
          ? [
              ...nextOpenAIList,
              buildSponsorOpenAIConfig(
                openaiEntry,
                definition.providerName,
                definition.getProtocolUrls,
                raw.openai[0]?.config
              ),
            ]
          : nextOpenAIList
      );
    },
    [config, persistClaudeConfigs, persistCodexConfigs, persistGeminiKeys, persistOpenAIConfigs]
  );

  const createProvider = useCallback(
    async (brand: ProviderBrand, input: ProviderEntryFormInput) => {
      setMutating(true);
      try {
        if (brand === 'gemini') {
          const next = [...(config?.geminiApiKeys ?? [])];
          next.push(buildProviderKeyConfig('gemini', input) as GeminiKeyConfig);
          await persistGeminiKeys(next);
        } else if (brand === 'codex') {
          const next = [...(config?.codexApiKeys ?? [])];
          next.push(buildProviderKeyConfig('codex', input) as ProviderKeyConfig);
          await persistCodexConfigs(next);
        } else if (brand === 'claude') {
          const next = [...(config?.claudeApiKeys ?? [])];
          next.push(buildProviderKeyConfig('claude', input) as ProviderKeyConfig);
          await persistClaudeConfigs(next);
        } else if (brand === 'claudeApi') {
          const next = [...(config?.claudeApiKeys ?? [])];
          next.push(buildClaudeApiConfig(input));
          await persistClaudeConfigs(next);
        } else if (brand === 'vertex') {
          const next = [...(config?.vertexApiKeys ?? [])];
          next.push(buildProviderKeyConfig('vertex', input) as ProviderKeyConfig);
          await persistVertexConfigs(next);
        } else if (brand === 'openaiCompatibility') {
          const next = [...(config?.openaiCompatibility ?? [])];
          next.push(buildOpenAIConfig(input));
          await persistOpenAIConfigs(next);
        } else if (
          brand === 'apikeyFun' ||
          brand === 'code0' ||
          brand === 'fennoAI' ||
          brand === 'qiniuCloud'
        ) {
          await persistSponsorConfig(brand, input);
        }
        refreshSnapshot();
      } finally {
        setMutating(false);
      }
    },
    [
      config,
      persistClaudeConfigs,
      persistCodexConfigs,
      persistGeminiKeys,
      persistOpenAIConfigs,
      persistSponsorConfig,
      persistVertexConfigs,
      refreshSnapshot,
    ]
  );

  const updateProvider = useCallback(
    async (resource: ProviderResource, input: ProviderEntryFormInput) => {
      setMutating(true);
      try {
        const brand = resource.brand;
        const idx = resource.originalIndex;
        if (brand === 'gemini') {
          const list = [...(config?.geminiApiKeys ?? [])];
          const existing = list[idx];
          list[idx] = buildProviderKeyConfig('gemini', input, existing) as GeminiKeyConfig;
          await persistGeminiKeys(list);
        } else if (brand === 'codex') {
          const list = [...(config?.codexApiKeys ?? [])];
          const existing = list[idx];
          list[idx] = buildProviderKeyConfig('codex', input, existing) as ProviderKeyConfig;
          await persistCodexConfigs(list);
        } else if (brand === 'claude') {
          const list = [...(config?.claudeApiKeys ?? [])];
          const existing = list[idx];
          list[idx] = buildProviderKeyConfig('claude', input, existing) as ProviderKeyConfig;
          await persistClaudeConfigs(list);
        } else if (brand === 'claudeApi') {
          const list = [...(config?.claudeApiKeys ?? [])];
          const existing = list[idx];
          list[idx] = buildClaudeApiConfig(input, existing);
          await persistClaudeConfigs(list);
        } else if (brand === 'vertex') {
          const list = [...(config?.vertexApiKeys ?? [])];
          const existing = list[idx];
          list[idx] = buildProviderKeyConfig('vertex', input, existing) as ProviderKeyConfig;
          await persistVertexConfigs(list);
        } else if (brand === 'openaiCompatibility') {
          const list = [...(config?.openaiCompatibility ?? [])];
          const existing = list[idx];
          list[idx] = buildOpenAIConfig(input, existing);
          await persistOpenAIConfigs(list);
        } else if (
          brand === 'apikeyFun' ||
          brand === 'code0' ||
          brand === 'fennoAI' ||
          brand === 'qiniuCloud'
        ) {
          await persistSponsorConfig(brand, input);
        }
        refreshSnapshot();
      } finally {
        setMutating(false);
      }
    },
    [
      config,
      persistClaudeConfigs,
      persistCodexConfigs,
      persistGeminiKeys,
      persistOpenAIConfigs,
      persistSponsorConfig,
      persistVertexConfigs,
      refreshSnapshot,
    ]
  );

  const deleteProvider = useCallback(
    async (resource: ProviderResource) => {
      setMutating(true);
      try {
        const sel = resource.selector;
        if (sel.brand === 'gemini') {
          await providersApi.deleteGeminiKey(sel.apiKey, sel.baseUrl);
          const next = (config?.geminiApiKeys ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('gemini-api-key', next);
        } else if (sel.brand === 'codex') {
          await providersApi.deleteCodexConfig(sel.apiKey, sel.baseUrl);
          const next = (config?.codexApiKeys ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('codex-api-key', next);
        } else if (sel.brand === 'claude') {
          await providersApi.deleteClaudeConfig(sel.apiKey, sel.baseUrl);
          const next = (config?.claudeApiKeys ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('claude-api-key', next);
        } else if (sel.brand === 'claudeApi') {
          await providersApi.deleteClaudeConfig(sel.apiKey, sel.baseUrl);
          const next = (config?.claudeApiKeys ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('claude-api-key', next);
        } else if (sel.brand === 'vertex') {
          await providersApi.deleteVertexConfig(sel.apiKey, sel.baseUrl);
          const next = (config?.vertexApiKeys ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('vertex-api-key', next);
        } else if (sel.brand === 'openaiCompatibility') {
          await providersApi.deleteOpenAIProvider(sel.index);
          const next = (config?.openaiCompatibility ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('openai-compatibility', next);
        } else if (
          sel.brand === 'apikeyFun' ||
          sel.brand === 'code0' ||
          sel.brand === 'fennoAI' ||
          sel.brand === 'qiniuCloud'
        ) {
          const nextGemini = (config?.geminiApiKeys ?? []).filter(
            (_, index) => !sel.geminiIndices.includes(index)
          );
          const nextClaude = (config?.claudeApiKeys ?? []).filter(
            (_, index) => !sel.claudeIndices.includes(index)
          );
          const nextCodex = (config?.codexApiKeys ?? []).filter(
            (_, index) => !sel.codexIndices.includes(index)
          );
          const nextOpenAI = (config?.openaiCompatibility ?? []).filter(
            (_, index) => !sel.openaiIndices.includes(index)
          );
          await persistGeminiKeys(nextGemini);
          await persistCodexConfigs(nextCodex);
          await persistClaudeConfigs(nextClaude);
          await persistOpenAIConfigs(nextOpenAI);
        }
        refreshSnapshot();
      } finally {
        setMutating(false);
      }
    },
    [
      config,
      persistClaudeConfigs,
      persistCodexConfigs,
      persistGeminiKeys,
      persistOpenAIConfigs,
      refreshSnapshot,
      updateConfigValue,
    ]
  );

  const toggleDisabled = useCallback(
    async (resource: ProviderResource, disabled: boolean) => {
      setMutating(true);
      try {
        const brand = resource.brand;
        const idx = resource.originalIndex;
        if (brand === 'gemini') {
          const list = [...(config?.geminiApiKeys ?? [])];
          const current = list[idx];
          if (!current) return;
          const excluded = disabled
            ? withDisableAllModelsRule(current.excludedModels)
            : withoutDisableAllModelsRule(current.excludedModels);
          list[idx] = { ...current, excludedModels: excluded };
          await persistGeminiKeys(list);
        } else if (
          brand === 'codex' ||
          brand === 'claude' ||
          brand === 'claudeApi' ||
          brand === 'vertex'
        ) {
          const key =
            brand === 'codex'
              ? 'codexApiKeys'
              : brand === 'claude' || brand === 'claudeApi'
                ? 'claudeApiKeys'
                : 'vertexApiKeys';
          const list = [...((config?.[key] as ProviderKeyConfig[] | undefined) ?? [])];
          const current = list[idx];
          if (!current) return;
          const excluded = disabled
            ? withDisableAllModelsRule(current.excludedModels)
            : withoutDisableAllModelsRule(current.excludedModels);
          list[idx] = { ...current, excludedModels: excluded };
          if (brand === 'codex') await persistCodexConfigs(list);
          else if (brand === 'claude' || brand === 'claudeApi') await persistClaudeConfigs(list);
          else await persistVertexConfigs(list);
        } else if (brand === 'openaiCompatibility') {
          await providersApi.updateOpenAIProviderDisabled(idx, disabled);
          const list = [...(config?.openaiCompatibility ?? [])];
          const current = list[idx];
          if (current) {
            list[idx] = { ...current, disabled };
            updateConfigValue('openai-compatibility', list);
          }
        } else if (brand === 'apikeyFun') {
          const claudeList = (config?.claudeApiKeys ?? []).map((item) => {
            if (!isApiKeyFunClaudeProvider(item)) return item;
            const excluded = disabled
              ? withDisableAllModelsRule(item.excludedModels)
              : withoutDisableAllModelsRule(item.excludedModels);
            return { ...item, excludedModels: excluded };
          });
          const codexList = (config?.codexApiKeys ?? []).map((item) => {
            if (!isApiKeyFunCodexProvider(item)) return item;
            const excluded = disabled
              ? withDisableAllModelsRule(item.excludedModels)
              : withoutDisableAllModelsRule(item.excludedModels);
            return { ...item, excludedModels: excluded };
          });
          const openaiList = (config?.openaiCompatibility ?? []).map((item) =>
            isApiKeyFunOpenAIProvider(item) ? { ...item, disabled } : item
          );
          await persistCodexConfigs(codexList);
          await persistClaudeConfigs(claudeList);
          await persistOpenAIConfigs(openaiList);
        } else if (brand === 'code0') {
          const geminiList = (config?.geminiApiKeys ?? []).map((item) => {
            if (!isCode0GeminiProvider(item)) return item;
            const excluded = disabled
              ? withDisableAllModelsRule(item.excludedModels)
              : withoutDisableAllModelsRule(item.excludedModels);
            return { ...item, excludedModels: excluded };
          });
          const claudeList = (config?.claudeApiKeys ?? []).map((item) => {
            if (!isCode0ClaudeProvider(item)) return item;
            const excluded = disabled
              ? withDisableAllModelsRule(item.excludedModels)
              : withoutDisableAllModelsRule(item.excludedModels);
            return { ...item, excludedModels: excluded };
          });
          const codexList = (config?.codexApiKeys ?? []).map((item) => {
            if (!isCode0CodexProvider(item)) return item;
            const excluded = disabled
              ? withDisableAllModelsRule(item.excludedModels)
              : withoutDisableAllModelsRule(item.excludedModels);
            return { ...item, excludedModels: excluded };
          });
          const openaiList = (config?.openaiCompatibility ?? []).map((item) =>
            isCode0OpenAIProvider(item) ? { ...item, disabled } : item
          );
          await persistGeminiKeys(geminiList);
          await persistCodexConfigs(codexList);
          await persistClaudeConfigs(claudeList);
          await persistOpenAIConfigs(openaiList);
        } else if (brand === 'fennoAI') {
          const claudeList = (config?.claudeApiKeys ?? []).map((item) => {
            if (!isFennoAIClaudeProvider(item)) return item;
            const excluded = disabled
              ? withDisableAllModelsRule(item.excludedModels)
              : withoutDisableAllModelsRule(item.excludedModels);
            return { ...item, excludedModels: excluded };
          });
          const codexList = (config?.codexApiKeys ?? []).map((item) => {
            if (!isFennoAICodexProvider(item)) return item;
            const excluded = disabled
              ? withDisableAllModelsRule(item.excludedModels)
              : withoutDisableAllModelsRule(item.excludedModels);
            return { ...item, excludedModels: excluded };
          });
          const openaiList = (config?.openaiCompatibility ?? []).map((item) =>
            isFennoAIOpenAIProvider(item) ? { ...item, disabled } : item
          );
          await persistCodexConfigs(codexList);
          await persistClaudeConfigs(claudeList);
          await persistOpenAIConfigs(openaiList);
        } else if (brand === 'qiniuCloud') {
          const geminiList = (config?.geminiApiKeys ?? []).map((item) => {
            if (!isQiniuCloudGeminiProvider(item)) return item;
            const excluded = disabled
              ? withDisableAllModelsRule(item.excludedModels)
              : withoutDisableAllModelsRule(item.excludedModels);
            return { ...item, excludedModels: excluded };
          });
          const claudeList = (config?.claudeApiKeys ?? []).map((item) => {
            if (!isQiniuCloudClaudeProvider(item)) return item;
            const excluded = disabled
              ? withDisableAllModelsRule(item.excludedModels)
              : withoutDisableAllModelsRule(item.excludedModels);
            return { ...item, excludedModels: excluded };
          });
          const codexList = (config?.codexApiKeys ?? []).map((item) => {
            if (!isQiniuCloudCodexProvider(item)) return item;
            const excluded = disabled
              ? withDisableAllModelsRule(item.excludedModels)
              : withoutDisableAllModelsRule(item.excludedModels);
            return { ...item, excludedModels: excluded };
          });
          const openaiList = (config?.openaiCompatibility ?? []).map((item) =>
            isQiniuCloudOpenAIProvider(item) ? { ...item, disabled } : item
          );
          await persistGeminiKeys(geminiList);
          await persistCodexConfigs(codexList);
          await persistClaudeConfigs(claudeList);
          await persistOpenAIConfigs(openaiList);
        }
        refreshSnapshot();
      } finally {
        setMutating(false);
      }
    },
    [
      config,
      persistClaudeConfigs,
      persistCodexConfigs,
      persistGeminiKeys,
      persistOpenAIConfigs,
      persistVertexConfigs,
      refreshSnapshot,
      updateConfigValue,
    ]
  );

  return {
    connected,
    isPending,
    isFetching,
    isError: Boolean(errorMessage),
    errorMessage,
    snapshot,
    refetch,
    createProvider,
    updateProvider,
    deleteProvider,
    toggleDisabled,
    mutating,
    refreshSnapshot,
  };
}
