import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ampcodeApi,
  providersApi,
} from '@/services/api';
import { useAuthStore, useConfigStore } from '@/stores';
import {
  withDisableAllModelsRule,
  withoutDisableAllModelsRule,
} from '@/components/providers/utils';
import type {
  AmpcodeConfig,
  GeminiKeyConfig,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';
import {
  ampcodeToResource,
  claudeToResource,
  codexToResource,
  geminiToResource,
  openaiToResource,
  vertexToResource,
} from './adapters';
import {
  PROVIDER_BRAND_ORDER,
  PROVIDER_PATHS,
} from './descriptors';
import type {
  ProviderBrand,
  ProviderEntryFormInput,
  ProviderGroup,
  ProviderResource,
  ProviderSnapshot,
} from './types';

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

export interface UseProviderWorkbenchResult {
  connected: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage: string | null;
  snapshot: ProviderSnapshot | null;
  refetch: () => Promise<void>;

  createProvider: (
    brand: ProviderBrand,
    input: ProviderEntryFormInput
  ) => Promise<void>;
  updateProvider: (
    resource: ProviderResource,
    input: ProviderEntryFormInput
  ) => Promise<void>;
  deleteProvider: (resource: ProviderResource) => Promise<void>;
  toggleDisabled: (resource: ProviderResource, disabled: boolean) => Promise<void>;
  saveAmpcode: (config: AmpcodeConfig) => Promise<void>;
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

const parseHeadersText = (text: string): Record<string, string> => {
  const result: Record<string, string> = {};
  text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const sep = line.indexOf(':');
      if (sep <= 0) return;
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 1).trim();
      if (!key) return;
      result[key] = value;
    });
  return result;
};

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

const buildProviderKeyConfig = (
  brand: 'gemini' | 'codex' | 'claude' | 'vertex',
  input: ProviderEntryFormInput,
  existing?: ProviderKeyConfig | GeminiKeyConfig | null
): ProviderKeyConfig | GeminiKeyConfig => {
  const headers = headersFromEntries(input.headers);
  const models = input.models
    .map((m) => ({
      name: m.name.trim(),
      alias: m.alias?.trim() || undefined,
      priority: m.priority,
      testModel: m.testModel,
    }))
    .filter((m) => m.name);
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
    };
  }
  return next;
};

const buildOpenAIConfig = (
  input: ProviderEntryFormInput,
  existing?: OpenAIProviderConfig | null
): OpenAIProviderConfig => {
  const headers = headersFromEntries(input.headers);
  const models = input.models
    .map((m) => ({
      name: m.name.trim(),
      alias: m.alias?.trim() || undefined,
      priority: m.priority,
      testModel: m.testModel,
    }))
    .filter((m) => m.name);
  const apiKeyEntries =
    input.apiKeyEntries
      ?.map((entry) => ({
        apiKey: entry.apiKey.trim(),
        proxyUrl: entry.proxyUrl.trim() || undefined,
        headers: Object.keys(parseHeadersText(entry.headersText)).length
          ? parseHeadersText(entry.headersText)
          : undefined,
        authIndex: entry.authIndex?.trim() || undefined,
      }))
      .filter((entry) => entry.apiKey) ?? [];

  return {
    ...(existing ?? {}),
    name: input.name.trim(),
    baseUrl: input.baseUrl.trim(),
    prefix: input.prefix.trim() || undefined,
    apiKeyEntries: apiKeyEntries.length
      ? apiKeyEntries
      : existing?.apiKeyEntries ?? [],
    disabled: input.disabled,
    headers: Object.keys(headers).length ? headers : undefined,
    models: models.length ? models : undefined,
    priority: input.priority,
    testModel: input.testModel?.trim() || undefined,
  };
};

/* -------------------------------------------------------------------------- */
/* hook                                                                       */
/* -------------------------------------------------------------------------- */

export function useProviderWorkbench(): UseProviderWorkbenchResult {
  const connectionStatus = useAuthStore((s) => s.connectionStatus);
  const config = useConfigStore((s) => s.config);
  const fetchConfig = useConfigStore((s) => s.fetchConfig);
  const updateConfigValue = useConfigStore((s) => s.updateConfigValue);
  const clearCache = useConfigStore((s) => s.clearCache);
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
      const [configResult, vertexResult, ampcodeResult, openaiResult] = await Promise.allSettled([
        fetchConfig(undefined, true),
        providersApi.getVertexConfigs(),
        ampcodeApi.getAmpcode(),
        providersApi.getOpenAIProviders(),
      ]);
      if (configResult.status !== 'fulfilled') {
        throw configResult.reason;
      }
      if (vertexResult.status === 'fulfilled') {
        updateConfigValue('vertex-api-key', vertexResult.value || []);
        clearCache('vertex-api-key');
      }
      if (ampcodeResult.status === 'fulfilled') {
        updateConfigValue('ampcode', ampcodeResult.value);
        clearCache('ampcode');
      }
      if (openaiResult.status === 'fulfilled') {
        updateConfigValue('openai-compatibility', openaiResult.value || []);
        clearCache('openai-compatibility');
      }
      setFetchedAt(new Date().toISOString());
    } catch (err) {
      setErrorMessage(getErrorMessage(err) || 'Failed to load providers');
    } finally {
      setIsPending(false);
      setIsFetching(false);
    }
  }, [clearCache, fetchConfig, updateConfigValue]);

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
          resources = (config.geminiApiKeys ?? []).map((c, i) => geminiToResource(c, i));
          break;
        case 'codex':
          resources = (config.codexApiKeys ?? []).map((c, i) => codexToResource(c, i));
          break;
        case 'claude':
          resources = (config.claudeApiKeys ?? []).map((c, i) => claudeToResource(c, i));
          break;
        case 'vertex':
          resources = (config.vertexApiKeys ?? []).map((c, i) => vertexToResource(c, i));
          break;
        case 'openaiCompatibility':
          resources = (config.openaiCompatibility ?? []).map((c, i) => openaiToResource(c, i));
          break;
        case 'ampcode':
          resources = [ampcodeToResource(config.ampcode)];
          break;
      }
      return {
        id: brand,
        resources,
        issue: null,
        path: PROVIDER_PATHS[brand],
      };
    });
    return {
      fetchedAt,
      groups,
      issues: [],
    };
  }, [config, fetchedAt]);

  /* ------------------- mutations ------------------- */

  const persistGeminiKeys = useCallback(
    async (next: GeminiKeyConfig[]) => {
      await providersApi.saveGeminiKeys(next);
      updateConfigValue('gemini-api-key', next);
      clearCache('gemini-api-key');
    },
    [clearCache, updateConfigValue]
  );

  const persistCodexConfigs = useCallback(
    async (next: ProviderKeyConfig[]) => {
      await providersApi.saveCodexConfigs(next);
      updateConfigValue('codex-api-key', next);
      clearCache('codex-api-key');
    },
    [clearCache, updateConfigValue]
  );

  const persistClaudeConfigs = useCallback(
    async (next: ProviderKeyConfig[]) => {
      await providersApi.saveClaudeConfigs(next);
      updateConfigValue('claude-api-key', next);
      clearCache('claude-api-key');
    },
    [clearCache, updateConfigValue]
  );

  const persistVertexConfigs = useCallback(
    async (next: ProviderKeyConfig[]) => {
      await providersApi.saveVertexConfigs(next);
      updateConfigValue('vertex-api-key', next);
      clearCache('vertex-api-key');
    },
    [clearCache, updateConfigValue]
  );

  const persistOpenAIConfigs = useCallback(
    async (next: OpenAIProviderConfig[]) => {
      await providersApi.saveOpenAIProviders(next);
      updateConfigValue('openai-compatibility', next);
      clearCache('openai-compatibility');
    },
    [clearCache, updateConfigValue]
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
        } else if (brand === 'vertex') {
          const next = [...(config?.vertexApiKeys ?? [])];
          next.push(buildProviderKeyConfig('vertex', input) as ProviderKeyConfig);
          await persistVertexConfigs(next);
        } else if (brand === 'openaiCompatibility') {
          const next = [...(config?.openaiCompatibility ?? [])];
          next.push(buildOpenAIConfig(input));
          await persistOpenAIConfigs(next);
        } else if (brand === 'ampcode') {
          throw new Error('Use saveAmpcode for ampcode create/update');
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
        } else if (brand === 'ampcode') {
          throw new Error('Use saveAmpcode for ampcode update');
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
          clearCache('gemini-api-key');
        } else if (sel.brand === 'codex') {
          await providersApi.deleteCodexConfig(sel.apiKey, sel.baseUrl);
          const next = (config?.codexApiKeys ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('codex-api-key', next);
          clearCache('codex-api-key');
        } else if (sel.brand === 'claude') {
          await providersApi.deleteClaudeConfig(sel.apiKey, sel.baseUrl);
          const next = (config?.claudeApiKeys ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('claude-api-key', next);
          clearCache('claude-api-key');
        } else if (sel.brand === 'vertex') {
          await providersApi.deleteVertexConfig(sel.apiKey, sel.baseUrl);
          const next = (config?.vertexApiKeys ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('vertex-api-key', next);
          clearCache('vertex-api-key');
        } else if (sel.brand === 'openaiCompatibility') {
          await providersApi.deleteOpenAIProvider(sel.name);
          const next = (config?.openaiCompatibility ?? []).filter((_, i) => i !== sel.index);
          updateConfigValue('openai-compatibility', next);
          clearCache('openai-compatibility');
        } else if (sel.brand === 'ampcode') {
          await Promise.allSettled([
            ampcodeApi.clearUpstreamUrl(),
            ampcodeApi.clearUpstreamApiKey(),
            ampcodeApi.clearModelMappings(),
          ]);
          updateConfigValue('ampcode', {});
          clearCache('ampcode');
        }
        refreshSnapshot();
      } finally {
        setMutating(false);
      }
    },
    [clearCache, config, refreshSnapshot, updateConfigValue]
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
        } else if (brand === 'codex' || brand === 'claude' || brand === 'vertex') {
          const key =
            brand === 'codex'
              ? 'codexApiKeys'
              : brand === 'claude'
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
          else if (brand === 'claude') await persistClaudeConfigs(list);
          else await persistVertexConfigs(list);
        } else if (brand === 'openaiCompatibility') {
          await providersApi.updateOpenAIProviderDisabled(idx, disabled);
          const list = [...(config?.openaiCompatibility ?? [])];
          const current = list[idx];
          if (current) {
            list[idx] = { ...current, disabled };
            updateConfigValue('openai-compatibility', list);
            clearCache('openai-compatibility');
          }
        } else if (brand === 'ampcode') {
          /* ampcode toggle 不支持,跳过 */
        }
        refreshSnapshot();
      } finally {
        setMutating(false);
      }
    },
    [
      clearCache,
      config,
      persistClaudeConfigs,
      persistCodexConfigs,
      persistGeminiKeys,
      persistVertexConfigs,
      refreshSnapshot,
      updateConfigValue,
    ]
  );

  const saveAmpcode = useCallback(
    async (next: AmpcodeConfig) => {
      setMutating(true);
      try {
        // 细粒度 PUT 序列以保留兼容性
        const url = (next.upstreamUrl ?? '').trim();
        if (url) {
          await ampcodeApi.updateUpstreamUrl(url);
        } else {
          await ampcodeApi.clearUpstreamUrl();
        }

        const fallbackKey = (next.upstreamApiKey ?? '').trim();
        if (fallbackKey) {
          await ampcodeApi.updateUpstreamApiKey(fallbackKey);
        } else {
          await ampcodeApi.clearUpstreamApiKey();
        }

        if (Array.isArray(next.upstreamApiKeys) && next.upstreamApiKeys.length) {
          await ampcodeApi.saveUpstreamApiKeys(next.upstreamApiKeys);
        } else {
          await ampcodeApi.saveUpstreamApiKeys([]);
        }

        if (Array.isArray(next.modelMappings) && next.modelMappings.length) {
          await ampcodeApi.saveModelMappings(next.modelMappings);
        } else {
          await ampcodeApi.clearModelMappings();
        }

        await ampcodeApi.updateForceModelMappings(next.forceModelMappings === true);

        updateConfigValue('ampcode', next);
        clearCache('ampcode');
        refreshSnapshot();
      } finally {
        setMutating(false);
      }
    },
    [clearCache, refreshSnapshot, updateConfigValue]
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
    saveAmpcode,
    mutating,
    refreshSnapshot,
  };
}
