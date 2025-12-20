import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { HeaderInputList } from '@/components/ui/HeaderInputList';
import { ModelInputList, modelsToEntries, entriesToModels } from '@/components/ui/ModelInputList';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconCheck, IconX } from '@/components/ui/icons';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { ampcodeApi, modelsApi, providersApi, usageApi } from '@/services/api';
import type {
  GeminiKeyConfig,
  ProviderKeyConfig,
  OpenAIProviderConfig,
  ApiKeyEntry,
  AmpcodeConfig,
  AmpcodeModelMapping,
} from '@/types';
import type { KeyStats, KeyStatBucket } from '@/utils/usage';
import type { ModelInfo } from '@/utils/models';
import { headersToEntries, buildHeaderObject, type HeaderEntry } from '@/utils/headers';
import { maskApiKey } from '@/utils/format';
import styles from './AiProvidersPage.module.scss';

type ProviderModal =
  | { type: 'gemini'; index: number | null }
  | { type: 'codex'; index: number | null }
  | { type: 'claude'; index: number | null }
  | { type: 'ampcode'; index: null }
  | { type: 'openai'; index: number | null };

interface ModelEntry {
  name: string;
  alias: string;
}

interface OpenAIFormState {
  name: string;
  baseUrl: string;
  headers: HeaderEntry[];
  testModel?: string;
  modelEntries: ModelEntry[];
  apiKeyEntries: ApiKeyEntry[];
}

interface AmpcodeFormState {
  upstreamUrl: string;
  upstreamApiKey: string;
  forceModelMappings: boolean;
  mappingEntries: ModelEntry[];
}

const DISABLE_ALL_MODELS_RULE = '*';

const hasDisableAllModelsRule = (models?: string[]) =>
  Array.isArray(models) &&
  models.some((model) => String(model ?? '').trim() === DISABLE_ALL_MODELS_RULE);

const stripDisableAllModelsRule = (models?: string[]) =>
  Array.isArray(models)
    ? models.filter((model) => String(model ?? '').trim() !== DISABLE_ALL_MODELS_RULE)
    : [];

const withDisableAllModelsRule = (models?: string[]) => {
  const base = stripDisableAllModelsRule(models);
  return [...base, DISABLE_ALL_MODELS_RULE];
};

const withoutDisableAllModelsRule = (models?: string[]) => {
  const base = stripDisableAllModelsRule(models);
  return base;
};

const parseExcludedModels = (text: string): string[] =>
  text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const excludedModelsToText = (models?: string[]) =>
  Array.isArray(models) ? models.join('\n') : '';

const buildOpenAIModelsEndpoint = (baseUrl: string): string => {
  const trimmed = String(baseUrl || '')
    .trim()
    .replace(/\/+$/g, '');
  if (!trimmed) return '';
  return trimmed.endsWith('/v1') ? `${trimmed}/models` : `${trimmed}/v1/models`;
};

const buildOpenAIChatCompletionsEndpoint = (baseUrl: string): string => {
  const trimmed = String(baseUrl || '')
    .trim()
    .replace(/\/+$/g, '');
  if (!trimmed) return '';
  if (trimmed.endsWith('/chat/completions')) {
    return trimmed;
  }
  return trimmed.endsWith('/v1') ? `${trimmed}/chat/completions` : `${trimmed}/v1/chat/completions`;
};

const OPENAI_TEST_TIMEOUT_MS = 30_000;

// 根据 source (apiKey) 获取统计数据 - 与旧版逻辑一致
const getStatsBySource = (
  apiKey: string,
  keyStats: KeyStats,
  maskFn: (key: string) => string
): KeyStatBucket => {
  const bySource = keyStats.bySource ?? {};
  const masked = maskFn(apiKey);
  return bySource[apiKey] || bySource[masked] || { success: 0, failure: 0 };
};

// 对于 OpenAI 提供商，汇总所有 apiKeyEntries 的统计 - 与旧版逻辑一致
const getOpenAIProviderStats = (
  apiKeyEntries: ApiKeyEntry[] | undefined,
  keyStats: KeyStats,
  maskFn: (key: string) => string
): KeyStatBucket => {
  const bySource = keyStats.bySource ?? {};
  let totalSuccess = 0;
  let totalFailure = 0;

  (apiKeyEntries || []).forEach((entry) => {
    const key = entry?.apiKey || '';
    if (!key) return;
    const masked = maskFn(key);
    const stats = bySource[key] || bySource[masked] || { success: 0, failure: 0 };
    totalSuccess += stats.success;
    totalFailure += stats.failure;
  });

  return { success: totalSuccess, failure: totalFailure };
};

const buildApiKeyEntry = (input?: Partial<ApiKeyEntry>): ApiKeyEntry => ({
  apiKey: input?.apiKey ?? '',
  proxyUrl: input?.proxyUrl ?? '',
  headers: input?.headers ?? {},
});

const ampcodeMappingsToEntries = (mappings?: AmpcodeModelMapping[]): ModelEntry[] => {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    return [{ name: '', alias: '' }];
  }
  return mappings.map((mapping) => ({
    name: mapping.from ?? '',
    alias: mapping.to ?? '',
  }));
};

const entriesToAmpcodeMappings = (entries: ModelEntry[]): AmpcodeModelMapping[] => {
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

const buildAmpcodeFormState = (ampcode?: AmpcodeConfig | null): AmpcodeFormState => ({
  upstreamUrl: ampcode?.upstreamUrl ?? '',
  upstreamApiKey: '',
  forceModelMappings: ampcode?.forceModelMappings ?? false,
  mappingEntries: ampcodeMappingsToEntries(ampcode?.modelMappings),
});

export function AiProvidersPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [geminiKeys, setGeminiKeys] = useState<GeminiKeyConfig[]>([]);
  const [codexConfigs, setCodexConfigs] = useState<ProviderKeyConfig[]>([]);
  const [claudeConfigs, setClaudeConfigs] = useState<ProviderKeyConfig[]>([]);
  const [openaiProviders, setOpenaiProviders] = useState<OpenAIProviderConfig[]>([]);
  const [keyStats, setKeyStats] = useState<KeyStats>({ bySource: {}, byAuthIndex: {} });

  const [modal, setModal] = useState<ProviderModal | null>(null);

  const [geminiForm, setGeminiForm] = useState<GeminiKeyConfig & { excludedText: string }>({
    apiKey: '',
    baseUrl: '',
    headers: {},
    excludedModels: [],
    excludedText: '',
  });
  const [providerForm, setProviderForm] = useState<
    ProviderKeyConfig & { modelEntries: ModelEntry[]; excludedText: string }
  >({
    apiKey: '',
    baseUrl: '',
    proxyUrl: '',
    headers: {},
    models: [],
    excludedModels: [],
    modelEntries: [{ name: '', alias: '' }],
    excludedText: '',
  });
  const [openaiForm, setOpenaiForm] = useState<OpenAIFormState>({
    name: '',
    baseUrl: '',
    headers: [],
    apiKeyEntries: [buildApiKeyEntry()],
    modelEntries: [{ name: '', alias: '' }],
  });
  const [ampcodeForm, setAmpcodeForm] = useState<AmpcodeFormState>(() =>
    buildAmpcodeFormState(null)
  );
  const [ampcodeModalLoading, setAmpcodeModalLoading] = useState(false);
  const [ampcodeLoaded, setAmpcodeLoaded] = useState(false);
  const [ampcodeMappingsDirty, setAmpcodeMappingsDirty] = useState(false);
  const [ampcodeModalError, setAmpcodeModalError] = useState('');
  const [ampcodeSaving, setAmpcodeSaving] = useState(false);
  const [openaiDiscoveryOpen, setOpenaiDiscoveryOpen] = useState(false);
  const [openaiDiscoveryEndpoint, setOpenaiDiscoveryEndpoint] = useState('');
  const [openaiDiscoveryModels, setOpenaiDiscoveryModels] = useState<ModelInfo[]>([]);
  const [openaiDiscoveryLoading, setOpenaiDiscoveryLoading] = useState(false);
  const [openaiDiscoveryError, setOpenaiDiscoveryError] = useState('');
  const [openaiDiscoverySearch, setOpenaiDiscoverySearch] = useState('');
  const [openaiDiscoverySelected, setOpenaiDiscoverySelected] = useState<Set<string>>(new Set());
  const [openaiTestModel, setOpenaiTestModel] = useState('');
  const [openaiTestStatus, setOpenaiTestStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [openaiTestMessage, setOpenaiTestMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [configSwitchingKey, setConfigSwitchingKey] = useState<string | null>(null);

  const disableControls = useMemo(() => connectionStatus !== 'connected', [connectionStatus]);
  const filteredOpenaiDiscoveryModels = useMemo(() => {
    const filter = openaiDiscoverySearch.trim().toLowerCase();
    if (!filter) return openaiDiscoveryModels;
    return openaiDiscoveryModels.filter((model) => {
      const name = (model.name || '').toLowerCase();
      const alias = (model.alias || '').toLowerCase();
      const desc = (model.description || '').toLowerCase();
      return name.includes(filter) || alias.includes(filter) || desc.includes(filter);
    });
  }, [openaiDiscoveryModels, openaiDiscoverySearch]);
  const openaiAvailableModels = useMemo(
    () => openaiForm.modelEntries.map((entry) => entry.name.trim()).filter(Boolean),
    [openaiForm.modelEntries]
  );

  // 加载 key 统计
  const loadKeyStats = useCallback(async () => {
    try {
      const stats = await usageApi.getKeyStats();
      setKeyStats(stats);
    } catch {
      // 静默失败
    }
  }, []);

  const loadConfigs = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchConfig();
      setGeminiKeys(data?.geminiApiKeys || []);
      setCodexConfigs(data?.codexApiKeys || []);
      setClaudeConfigs(data?.claudeApiKeys || []);
      setOpenaiProviders(data?.openaiCompatibility || []);
      try {
        const ampcode = await ampcodeApi.getAmpcode();
        updateConfigValue('ampcode', ampcode);
        clearCache('ampcode');
      } catch {
        // ignore
      }
    } catch (err: any) {
      setError(err?.message || t('notification.refresh_failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfigs();
    loadKeyStats();
  }, [loadKeyStats]);

  useEffect(() => {
    if (config?.geminiApiKeys) setGeminiKeys(config.geminiApiKeys);
    if (config?.codexApiKeys) setCodexConfigs(config.codexApiKeys);
    if (config?.claudeApiKeys) setClaudeConfigs(config.claudeApiKeys);
    if (config?.openaiCompatibility) setOpenaiProviders(config.openaiCompatibility);
  }, [
    config?.geminiApiKeys,
    config?.codexApiKeys,
    config?.claudeApiKeys,
    config?.openaiCompatibility,
  ]);

  const closeModal = () => {
    setModal(null);
    setGeminiForm({
      apiKey: '',
      baseUrl: '',
      headers: {},
      excludedModels: [],
      excludedText: '',
    });
    setProviderForm({
      apiKey: '',
      baseUrl: '',
      proxyUrl: '',
      headers: {},
      models: [],
      excludedModels: [],
      modelEntries: [{ name: '', alias: '' }],
      excludedText: '',
    });
    setOpenaiForm({
      name: '',
      baseUrl: '',
      headers: [],
      apiKeyEntries: [buildApiKeyEntry()],
      modelEntries: [{ name: '', alias: '' }],
      testModel: undefined,
    });
    setAmpcodeForm(buildAmpcodeFormState(null));
    setAmpcodeModalLoading(false);
    setAmpcodeLoaded(false);
    setAmpcodeMappingsDirty(false);
    setAmpcodeModalError('');
    setAmpcodeSaving(false);
    setOpenaiDiscoveryOpen(false);
    setOpenaiDiscoveryModels([]);
    setOpenaiDiscoverySelected(new Set());
    setOpenaiDiscoverySearch('');
    setOpenaiDiscoveryError('');
    setOpenaiDiscoveryEndpoint('');
    setOpenaiTestModel('');
    setOpenaiTestStatus('idle');
    setOpenaiTestMessage('');
  };

  const openGeminiModal = (index: number | null) => {
    if (index !== null) {
      const entry = geminiKeys[index];
      setGeminiForm({
        ...entry,
        excludedText: excludedModelsToText(entry?.excludedModels),
      });
    }
    setModal({ type: 'gemini', index });
  };

  const openProviderModal = (type: 'codex' | 'claude', index: number | null) => {
    const source = type === 'codex' ? codexConfigs : claudeConfigs;
    if (index !== null) {
      const entry = source[index];
      setProviderForm({
        ...entry,
        modelEntries: modelsToEntries(entry?.models),
        excludedText: excludedModelsToText(entry?.excludedModels),
      });
    }
    setModal({ type, index });
  };

  const openAmpcodeModal = () => {
    setAmpcodeModalLoading(true);
    setAmpcodeLoaded(false);
    setAmpcodeMappingsDirty(false);
    setAmpcodeModalError('');
    setAmpcodeForm(buildAmpcodeFormState(config?.ampcode ?? null));
    setModal({ type: 'ampcode', index: null });

    void (async () => {
      try {
        const ampcode = await ampcodeApi.getAmpcode();
        setAmpcodeLoaded(true);
        updateConfigValue('ampcode', ampcode);
        clearCache('ampcode');
        setAmpcodeForm(buildAmpcodeFormState(ampcode));
      } catch (err: any) {
        setAmpcodeModalError(err?.message || t('notification.refresh_failed'));
      } finally {
        setAmpcodeModalLoading(false);
      }
    })();
  };

  const openOpenaiModal = (index: number | null) => {
    if (index !== null) {
      const entry = openaiProviders[index];
      const modelEntries = modelsToEntries(entry.models);
      setOpenaiForm({
        name: entry.name,
        baseUrl: entry.baseUrl,
        headers: headersToEntries(entry.headers),
        testModel: entry.testModel,
        modelEntries,
        apiKeyEntries: entry.apiKeyEntries?.length ? entry.apiKeyEntries : [buildApiKeyEntry()],
      });
      const available = modelEntries.map((m) => m.name.trim()).filter(Boolean);
      const initialModel =
        entry.testModel && available.includes(entry.testModel)
          ? entry.testModel
          : available[0] || '';
      setOpenaiTestModel(initialModel);
    } else {
      setOpenaiTestModel('');
    }
    setOpenaiTestStatus('idle');
    setOpenaiTestMessage('');
    setModal({ type: 'openai', index });
  };

  const closeOpenaiModelDiscovery = () => {
    setOpenaiDiscoveryOpen(false);
    setOpenaiDiscoveryModels([]);
    setOpenaiDiscoverySelected(new Set());
    setOpenaiDiscoverySearch('');
    setOpenaiDiscoveryError('');
  };

  const fetchOpenaiModelDiscovery = async ({
    allowFallback = true,
  }: { allowFallback?: boolean } = {}) => {
    const baseUrl = openaiForm.baseUrl.trim();
    if (!baseUrl) return;

    setOpenaiDiscoveryLoading(true);
    setOpenaiDiscoveryError('');
    try {
      const headers = buildHeaderObject(openaiForm.headers);
      const firstKey = openaiForm.apiKeyEntries
        .find((entry) => entry.apiKey?.trim())
        ?.apiKey?.trim();
      const hasAuthHeader = Boolean(headers.Authorization || headers['authorization']);
      const list = await modelsApi.fetchModels(
        baseUrl,
        hasAuthHeader ? undefined : firstKey,
        headers
      );
      setOpenaiDiscoveryModels(list);
    } catch (err: any) {
      if (allowFallback) {
        try {
          const list = await modelsApi.fetchModels(baseUrl);
          setOpenaiDiscoveryModels(list);
          return;
        } catch (fallbackErr: any) {
          const message = fallbackErr?.message || err?.message || '';
          setOpenaiDiscoveryModels([]);
          setOpenaiDiscoveryError(`${t('ai_providers.openai_models_fetch_error')}: ${message}`);
        }
      } else {
        setOpenaiDiscoveryModels([]);
        setOpenaiDiscoveryError(
          `${t('ai_providers.openai_models_fetch_error')}: ${err?.message || ''}`
        );
      }
    } finally {
      setOpenaiDiscoveryLoading(false);
    }
  };

  const openOpenaiModelDiscovery = () => {
    const baseUrl = openaiForm.baseUrl.trim();
    if (!baseUrl) {
      showNotification(t('ai_providers.openai_models_fetch_invalid_url'), 'error');
      return;
    }

    setOpenaiDiscoveryEndpoint(buildOpenAIModelsEndpoint(baseUrl));
    setOpenaiDiscoveryModels([]);
    setOpenaiDiscoverySearch('');
    setOpenaiDiscoverySelected(new Set());
    setOpenaiDiscoveryError('');
    setOpenaiDiscoveryOpen(true);
    void fetchOpenaiModelDiscovery();
  };

  const toggleOpenaiModelSelection = (name: string) => {
    setOpenaiDiscoverySelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const applyOpenaiModelDiscoverySelection = () => {
    const selectedModels = openaiDiscoveryModels.filter((model) =>
      openaiDiscoverySelected.has(model.name)
    );
    if (!selectedModels.length) {
      closeOpenaiModelDiscovery();
      return;
    }

    const mergedMap = new Map<string, ModelEntry>();
    openaiForm.modelEntries.forEach((entry) => {
      const name = entry.name.trim();
      if (!name) return;
      mergedMap.set(name, { name, alias: entry.alias?.trim() || '' });
    });

    let addedCount = 0;
    selectedModels.forEach((model) => {
      const name = model.name.trim();
      if (!name || mergedMap.has(name)) return;
      mergedMap.set(name, { name, alias: model.alias ?? '' });
      addedCount += 1;
    });

    const mergedEntries = Array.from(mergedMap.values());
    setOpenaiForm((prev) => ({
      ...prev,
      modelEntries: mergedEntries.length ? mergedEntries : [{ name: '', alias: '' }],
    }));

    closeOpenaiModelDiscovery();
    if (addedCount > 0) {
      showNotification(
        t('ai_providers.openai_models_fetch_added', { count: addedCount }),
        'success'
      );
    }
  };

  useEffect(() => {
    if (modal?.type !== 'openai') return;
    if (openaiAvailableModels.length === 0) {
      if (openaiTestModel) {
        setOpenaiTestModel('');
        setOpenaiTestStatus('idle');
        setOpenaiTestMessage('');
      }
      return;
    }

    if (!openaiTestModel || !openaiAvailableModels.includes(openaiTestModel)) {
      setOpenaiTestModel(openaiAvailableModels[0]);
      setOpenaiTestStatus('idle');
      setOpenaiTestMessage('');
    }
  }, [modal?.type, openaiAvailableModels, openaiTestModel]);

  const testOpenaiProviderConnection = async () => {
    const baseUrl = openaiForm.baseUrl.trim();
    if (!baseUrl) {
      const message = t('notification.openai_test_url_required');
      setOpenaiTestStatus('error');
      setOpenaiTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const endpoint = buildOpenAIChatCompletionsEndpoint(baseUrl);
    if (!endpoint) {
      const message = t('notification.openai_test_url_required');
      setOpenaiTestStatus('error');
      setOpenaiTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const firstKeyEntry = openaiForm.apiKeyEntries.find((entry) => entry.apiKey?.trim());
    if (!firstKeyEntry) {
      const message = t('notification.openai_test_key_required');
      setOpenaiTestStatus('error');
      setOpenaiTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const modelName = openaiTestModel.trim() || openaiAvailableModels[0] || '';
    if (!modelName) {
      const message = t('notification.openai_test_model_required');
      setOpenaiTestStatus('error');
      setOpenaiTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const customHeaders = buildHeaderObject(openaiForm.headers);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };
    if (!headers.Authorization && !headers['authorization']) {
      headers.Authorization = `Bearer ${firstKeyEntry.apiKey.trim()}`;
    }

    setOpenaiTestStatus('loading');
    setOpenaiTestMessage(t('ai_providers.openai_test_running'));

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), OPENAI_TEST_TIMEOUT_MS);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: 'Hi' }],
          stream: false,
          max_tokens: 5,
        }),
      });
      const rawText = await response.text();

      if (!response.ok) {
        let errorMessage = `${response.status} ${response.statusText}`;
        try {
          const parsed = rawText ? JSON.parse(rawText) : null;
          errorMessage = parsed?.error?.message || parsed?.message || errorMessage;
        } catch {
          if (rawText) {
            errorMessage = rawText;
          }
        }
        throw new Error(errorMessage);
      }

      setOpenaiTestStatus('success');
      setOpenaiTestMessage(t('ai_providers.openai_test_success'));
    } catch (err: any) {
      setOpenaiTestStatus('error');
      if (err?.name === 'AbortError') {
        setOpenaiTestMessage(
          t('ai_providers.openai_test_timeout', { seconds: OPENAI_TEST_TIMEOUT_MS / 1000 })
        );
      } else {
        setOpenaiTestMessage(`${t('ai_providers.openai_test_failed')}: ${err?.message || ''}`);
      }
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  const clearAmpcodeUpstreamApiKey = async () => {
    if (!window.confirm(t('ai_providers.ampcode_clear_upstream_api_key_confirm'))) return;
    setAmpcodeSaving(true);
    setAmpcodeModalError('');
    try {
      await ampcodeApi.clearUpstreamApiKey();
      const previous = config?.ampcode ?? {};
      const next: AmpcodeConfig = { ...previous };
      delete (next as any).upstreamApiKey;
      updateConfigValue('ampcode', next);
      clearCache('ampcode');
      showNotification(t('notification.ampcode_upstream_api_key_cleared'), 'success');
    } catch (err: any) {
      const message = err?.message || '';
      setAmpcodeModalError(message);
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setAmpcodeSaving(false);
    }
  };

  const saveAmpcode = async () => {
    if (!ampcodeLoaded && ampcodeMappingsDirty) {
      const confirmed = window.confirm(t('ai_providers.ampcode_mappings_overwrite_confirm'));
      if (!confirmed) return;
    }

    setAmpcodeSaving(true);
    setAmpcodeModalError('');
    try {
      const upstreamUrl = ampcodeForm.upstreamUrl.trim();
      const overrideKey = ampcodeForm.upstreamApiKey.trim();
      const modelMappings = entriesToAmpcodeMappings(ampcodeForm.mappingEntries);

      if (upstreamUrl) {
        await ampcodeApi.updateUpstreamUrl(upstreamUrl);
      } else {
        await ampcodeApi.clearUpstreamUrl();
      }

      await ampcodeApi.updateForceModelMappings(ampcodeForm.forceModelMappings);

      if (ampcodeLoaded || ampcodeMappingsDirty) {
        if (modelMappings.length) {
          await ampcodeApi.saveModelMappings(modelMappings);
        } else {
          await ampcodeApi.clearModelMappings();
        }
      }

      if (overrideKey) {
        await ampcodeApi.updateUpstreamApiKey(overrideKey);
      }

      const previous = config?.ampcode ?? {};
      const next: AmpcodeConfig = {
        upstreamUrl: upstreamUrl || undefined,
        forceModelMappings: ampcodeForm.forceModelMappings,
      };

      if (previous.upstreamApiKey) {
        next.upstreamApiKey = previous.upstreamApiKey;
      }

      if (Array.isArray(previous.modelMappings)) {
        next.modelMappings = previous.modelMappings;
      }

      if (overrideKey) {
        next.upstreamApiKey = overrideKey;
      }

      if (ampcodeLoaded || ampcodeMappingsDirty) {
        if (modelMappings.length) {
          next.modelMappings = modelMappings;
        } else {
          delete (next as any).modelMappings;
        }
      }

      updateConfigValue('ampcode', next);
      clearCache('ampcode');
      showNotification(t('notification.ampcode_updated'), 'success');
      closeModal();
    } catch (err: any) {
      const message = err?.message || '';
      setAmpcodeModalError(message);
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setAmpcodeSaving(false);
    }
  };

  const saveGemini = async () => {
    setSaving(true);
    try {
      const payload: GeminiKeyConfig = {
        apiKey: geminiForm.apiKey.trim(),
        baseUrl: geminiForm.baseUrl?.trim() || undefined,
        headers: buildHeaderObject(headersToEntries(geminiForm.headers as any)),
        excludedModels: parseExcludedModels(geminiForm.excludedText),
      };
      const nextList =
        modal?.type === 'gemini' && modal.index !== null
          ? geminiKeys.map((item, idx) => (idx === modal.index ? payload : item))
          : [...geminiKeys, payload];

      await providersApi.saveGeminiKeys(nextList);
      setGeminiKeys(nextList);
      updateConfigValue('gemini-api-key', nextList);
      clearCache('gemini-api-key');
      const message =
        modal?.index !== null
          ? t('notification.gemini_key_updated')
          : t('notification.gemini_key_added');
      showNotification(message, 'success');
      closeModal();
    } catch (err: any) {
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteGemini = async (apiKey: string) => {
    if (!window.confirm(t('ai_providers.gemini_delete_confirm'))) return;
    try {
      await providersApi.deleteGeminiKey(apiKey);
      const next = geminiKeys.filter((item) => item.apiKey !== apiKey);
      setGeminiKeys(next);
      updateConfigValue('gemini-api-key', next);
      clearCache('gemini-api-key');
      showNotification(t('notification.gemini_key_deleted'), 'success');
    } catch (err: any) {
      showNotification(`${t('notification.delete_failed')}: ${err?.message || ''}`, 'error');
    }
  };

  const setConfigEnabled = async (
    provider: 'gemini' | 'codex' | 'claude',
    index: number,
    enabled: boolean
  ) => {
    if (provider === 'gemini') {
      const current = geminiKeys[index];
      if (!current) return;

      const switchingKey = `${provider}:${current.apiKey}`;
      setConfigSwitchingKey(switchingKey);

      const previousList = geminiKeys;
      const nextExcluded = enabled
        ? withoutDisableAllModelsRule(current.excludedModels)
        : withDisableAllModelsRule(current.excludedModels);
      const nextItem: GeminiKeyConfig = { ...current, excludedModels: nextExcluded };
      const nextList = previousList.map((item, idx) => (idx === index ? nextItem : item));

      setGeminiKeys(nextList);
      updateConfigValue('gemini-api-key', nextList);
      clearCache('gemini-api-key');

      try {
        await providersApi.saveGeminiKeys(nextList);
        showNotification(
          enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
          'success'
        );
      } catch (err: any) {
        setGeminiKeys(previousList);
        updateConfigValue('gemini-api-key', previousList);
        clearCache('gemini-api-key');
        showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
      } finally {
        setConfigSwitchingKey(null);
      }
      return;
    }

    const source = provider === 'codex' ? codexConfigs : claudeConfigs;
    const current = source[index];
    if (!current) return;

    const switchingKey = `${provider}:${current.apiKey}`;
    setConfigSwitchingKey(switchingKey);

    const previousList = source;
    const nextExcluded = enabled
      ? withoutDisableAllModelsRule(current.excludedModels)
      : withDisableAllModelsRule(current.excludedModels);
    const nextItem: ProviderKeyConfig = { ...current, excludedModels: nextExcluded };
    const nextList = previousList.map((item, idx) => (idx === index ? nextItem : item));

    if (provider === 'codex') {
      setCodexConfigs(nextList);
      updateConfigValue('codex-api-key', nextList);
      clearCache('codex-api-key');
    } else {
      setClaudeConfigs(nextList);
      updateConfigValue('claude-api-key', nextList);
      clearCache('claude-api-key');
    }

    try {
      if (provider === 'codex') {
        await providersApi.saveCodexConfigs(nextList);
      } else {
        await providersApi.saveClaudeConfigs(nextList);
      }
      showNotification(
        enabled ? t('notification.config_enabled') : t('notification.config_disabled'),
        'success'
      );
    } catch (err: any) {
      if (provider === 'codex') {
        setCodexConfigs(previousList);
        updateConfigValue('codex-api-key', previousList);
        clearCache('codex-api-key');
      } else {
        setClaudeConfigs(previousList);
        updateConfigValue('claude-api-key', previousList);
        clearCache('claude-api-key');
      }
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setConfigSwitchingKey(null);
    }
  };

  const saveProvider = async (type: 'codex' | 'claude') => {
    const baseUrl = (providerForm.baseUrl ?? '').trim();
    if (!baseUrl) {
      showNotification(t('codex_base_url_required'), 'error');
      return;
    }

    setSaving(true);
    try {
      const source = type === 'codex' ? codexConfigs : claudeConfigs;

      const payload: ProviderKeyConfig = {
        apiKey: providerForm.apiKey.trim(),
        baseUrl,
        proxyUrl: providerForm.proxyUrl?.trim() || undefined,
        headers: buildHeaderObject(headersToEntries(providerForm.headers as any)),
        models: entriesToModels(providerForm.modelEntries),
        excludedModels: parseExcludedModels(providerForm.excludedText),
      };

      const nextList =
        modal?.type === type && modal.index !== null
          ? source.map((item, idx) => (idx === modal.index ? payload : item))
          : [...source, payload];

      if (type === 'codex') {
        await providersApi.saveCodexConfigs(nextList);
        setCodexConfigs(nextList);
        updateConfigValue('codex-api-key', nextList);
        clearCache('codex-api-key');
        const message =
          modal?.index !== null
            ? t('notification.codex_config_updated')
            : t('notification.codex_config_added');
        showNotification(message, 'success');
      } else {
        await providersApi.saveClaudeConfigs(nextList);
        setClaudeConfigs(nextList);
        updateConfigValue('claude-api-key', nextList);
        clearCache('claude-api-key');
        const message =
          modal?.index !== null
            ? t('notification.claude_config_updated')
            : t('notification.claude_config_added');
        showNotification(message, 'success');
      }

      closeModal();
    } catch (err: any) {
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteProviderEntry = async (type: 'codex' | 'claude', apiKey: string) => {
    if (!window.confirm(t(`ai_providers.${type}_delete_confirm` as any))) return;
    try {
      if (type === 'codex') {
        await providersApi.deleteCodexConfig(apiKey);
        const next = codexConfigs.filter((item) => item.apiKey !== apiKey);
        setCodexConfigs(next);
        updateConfigValue('codex-api-key', next);
        clearCache('codex-api-key');
        showNotification(t('notification.codex_config_deleted'), 'success');
      } else {
        await providersApi.deleteClaudeConfig(apiKey);
        const next = claudeConfigs.filter((item) => item.apiKey !== apiKey);
        setClaudeConfigs(next);
        updateConfigValue('claude-api-key', next);
        clearCache('claude-api-key');
        showNotification(t('notification.claude_config_deleted'), 'success');
      }
    } catch (err: any) {
      showNotification(`${t('notification.delete_failed')}: ${err?.message || ''}`, 'error');
    }
  };

  const saveOpenai = async () => {
    setSaving(true);
    try {
      const payload: OpenAIProviderConfig = {
        name: openaiForm.name.trim(),
        baseUrl: openaiForm.baseUrl.trim(),
        headers: buildHeaderObject(openaiForm.headers),
        apiKeyEntries: openaiForm.apiKeyEntries.map((entry) => ({
          apiKey: entry.apiKey.trim(),
          proxyUrl: entry.proxyUrl?.trim() || undefined,
          headers: entry.headers,
        })),
      };
      if (openaiForm.testModel) payload.testModel = openaiForm.testModel.trim();
      const models = entriesToModels(openaiForm.modelEntries);
      if (models.length) payload.models = models;

      const nextList =
        modal?.type === 'openai' && modal.index !== null
          ? openaiProviders.map((item, idx) => (idx === modal.index ? payload : item))
          : [...openaiProviders, payload];

      await providersApi.saveOpenAIProviders(nextList);
      setOpenaiProviders(nextList);
      updateConfigValue('openai-compatibility', nextList);
      clearCache('openai-compatibility');
      const message =
        modal?.index !== null
          ? t('notification.openai_provider_updated')
          : t('notification.openai_provider_added');
      showNotification(message, 'success');
      closeModal();
    } catch (err: any) {
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteOpenai = async (name: string) => {
    if (!window.confirm(t('ai_providers.openai_delete_confirm'))) return;
    try {
      await providersApi.deleteOpenAIProvider(name);
      const next = openaiProviders.filter((item) => item.name !== name);
      setOpenaiProviders(next);
      updateConfigValue('openai-compatibility', next);
      clearCache('openai-compatibility');
      showNotification(t('notification.openai_provider_deleted'), 'success');
    } catch (err: any) {
      showNotification(`${t('notification.delete_failed')}: ${err?.message || ''}`, 'error');
    }
  };

  const renderKeyEntries = (entries: ApiKeyEntry[]) => {
    const list = entries.length ? entries : [buildApiKeyEntry()];
    const updateEntry = (idx: number, field: keyof ApiKeyEntry, value: string) => {
      const next = list.map((entry, i) => (i === idx ? { ...entry, [field]: value } : entry));
      setOpenaiForm((prev) => ({ ...prev, apiKeyEntries: next }));
    };

    const removeEntry = (idx: number) => {
      const next = list.filter((_, i) => i !== idx);
      setOpenaiForm((prev) => ({
        ...prev,
        apiKeyEntries: next.length ? next : [buildApiKeyEntry()],
      }));
    };

    const addEntry = () => {
      setOpenaiForm((prev) => ({ ...prev, apiKeyEntries: [...list, buildApiKeyEntry()] }));
    };

    return (
      <div className="stack">
        {list.map((entry, index) => (
          <div key={index} className="item-row">
            <div className="item-meta">
              <Input
                label={`${t('common.api_key')} #${index + 1}`}
                value={entry.apiKey}
                onChange={(e) => updateEntry(index, 'apiKey', e.target.value)}
              />
              <Input
                label={t('common.proxy_url')}
                value={entry.proxyUrl ?? ''}
                onChange={(e) => updateEntry(index, 'proxyUrl', e.target.value)}
              />
            </div>
            <div className="item-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeEntry(index)}
                disabled={list.length <= 1 || saving}
              >
                {t('common.delete')}
              </Button>
            </div>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={addEntry} disabled={saving}>
          {t('ai_providers.openai_keys_add_btn')}
        </Button>
      </div>
    );
  };

  const renderList = <T,>(
    items: T[],
    keyField: (item: T) => string,
    renderContent: (item: T, index: number) => ReactNode,
    onEdit: (index: number) => void,
    onDelete: (item: T) => void,
    addLabel: string,
    deleteLabel?: string,
    options?: {
      getRowDisabled?: (item: T, index: number) => boolean;
      renderExtraActions?: (item: T, index: number) => ReactNode;
    }
  ) => {
    if (loading) {
      return <div className="hint">{t('common.loading')}</div>;
    }

    if (!items.length) {
      return (
        <EmptyState
          title={t('common.info')}
          description={t('ai_providers.gemini_empty_desc')}
          action={
            <Button onClick={() => onEdit(-1)} disabled={disableControls}>
              {addLabel}
            </Button>
          }
        />
      );
    }

    return (
      <div className="item-list">
        {items.map((item, index) => {
          const rowDisabled = options?.getRowDisabled ? options.getRowDisabled(item, index) : false;
          return (
            <div
              key={keyField(item)}
              className="item-row"
              style={rowDisabled ? { opacity: 0.6 } : undefined}
            >
              <div className="item-meta">{renderContent(item, index)}</div>
              <div className="item-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onEdit(index)}
                  disabled={disableControls || saving || Boolean(configSwitchingKey)}
                >
                  {t('common.edit')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => onDelete(item)}
                  disabled={disableControls || saving || Boolean(configSwitchingKey)}
                >
                  {deleteLabel || t('common.delete')}
                </Button>
                {options?.renderExtraActions ? options.renderExtraActions(item, index) : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('ai_providers.title')}</h1>
      <div className={styles.content}>
        {error && <div className="error-box">{error}</div>}

        <Card
          title={t('ai_providers.gemini_title')}
          extra={
            <Button
              size="sm"
              onClick={() => openGeminiModal(null)}
              disabled={disableControls || saving || Boolean(configSwitchingKey)}
            >
              {t('ai_providers.gemini_add_button')}
            </Button>
          }
        >
          {renderList<GeminiKeyConfig>(
            geminiKeys,
            (item) => item.apiKey,
            (item, index) => {
              const stats = getStatsBySource(item.apiKey, keyStats, maskApiKey);
              const headerEntries = Object.entries(item.headers || {});
              const configDisabled = hasDisableAllModelsRule(item.excludedModels);
              const excludedModels = item.excludedModels ?? [];
              return (
                <Fragment>
                  <div className="item-title">
                    {t('ai_providers.gemini_item_title')} #{index + 1}
                  </div>
                  {/* API Key 行 */}
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>{t('common.api_key')}:</span>
                    <span className={styles.fieldValue}>{maskApiKey(item.apiKey)}</span>
                  </div>
                  {/* Base URL 行 */}
                  {item.baseUrl && (
                    <div className={styles.fieldRow}>
                      <span className={styles.fieldLabel}>{t('common.base_url')}:</span>
                      <span className={styles.fieldValue}>{item.baseUrl}</span>
                    </div>
                  )}
                  {/* 自定义请求头徽章 */}
                  {headerEntries.length > 0 && (
                    <div className={styles.headerBadgeList}>
                      {headerEntries.map(([key, value]) => (
                        <span key={key} className={styles.headerBadge}>
                          <strong>{key}:</strong> {value}
                        </span>
                      ))}
                    </div>
                  )}
                  {configDisabled && (
                    <div className="status-badge warning" style={{ marginTop: 8, marginBottom: 0 }}>
                      {t('ai_providers.config_disabled_badge')}
                    </div>
                  )}
                  {/* 排除模型徽章 */}
                  {excludedModels.length ? (
                    <div className={styles.excludedModelsSection}>
                      <div className={styles.excludedModelsLabel}>
                        {t('ai_providers.excluded_models_count', { count: excludedModels.length })}
                      </div>
                      <div className={styles.modelTagList}>
                        {excludedModels.map((model) => (
                          <span
                            key={model}
                            className={`${styles.modelTag} ${styles.excludedModelTag}`}
                          >
                            <span className={styles.modelName}>{model}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {/* 成功/失败统计 */}
                  <div className={styles.cardStats}>
                    <span className={`${styles.statPill} ${styles.statSuccess}`}>
                      {t('stats.success')}: {stats.success}
                    </span>
                    <span className={`${styles.statPill} ${styles.statFailure}`}>
                      {t('stats.failure')}: {stats.failure}
                    </span>
                  </div>
                </Fragment>
              );
            },
            (index) => openGeminiModal(index),
            (item) => deleteGemini(item.apiKey),
            t('ai_providers.gemini_add_button'),
            undefined,
            {
              getRowDisabled: (item) => hasDisableAllModelsRule(item.excludedModels),
              renderExtraActions: (item, index) => (
                <ToggleSwitch
                  label={t('ai_providers.config_toggle_label')}
                  checked={!hasDisableAllModelsRule(item.excludedModels)}
                  disabled={disableControls || loading || saving || Boolean(configSwitchingKey)}
                  onChange={(value) => void setConfigEnabled('gemini', index, value)}
                />
              ),
            }
          )}
        </Card>

        <Card
          title={t('ai_providers.codex_title')}
          extra={
            <Button
              size="sm"
              onClick={() => openProviderModal('codex', null)}
              disabled={disableControls || saving || Boolean(configSwitchingKey)}
            >
              {t('ai_providers.codex_add_button')}
            </Button>
          }
        >
          {renderList<ProviderKeyConfig>(
            codexConfigs,
            (item) => item.apiKey,
            (item, _index) => {
              const stats = getStatsBySource(item.apiKey, keyStats, maskApiKey);
              const headerEntries = Object.entries(item.headers || {});
              const configDisabled = hasDisableAllModelsRule(item.excludedModels);
              const excludedModels = item.excludedModels ?? [];
              return (
                <Fragment>
                  <div className="item-title">{t('ai_providers.codex_item_title')}</div>
                  {/* API Key 行 */}
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>{t('common.api_key')}:</span>
                    <span className={styles.fieldValue}>{maskApiKey(item.apiKey)}</span>
                  </div>
                  {/* Base URL 行 */}
                  {item.baseUrl && (
                    <div className={styles.fieldRow}>
                      <span className={styles.fieldLabel}>{t('common.base_url')}:</span>
                      <span className={styles.fieldValue}>{item.baseUrl}</span>
                    </div>
                  )}
                  {/* Proxy URL 行 */}
                  {item.proxyUrl && (
                    <div className={styles.fieldRow}>
                      <span className={styles.fieldLabel}>{t('common.proxy_url')}:</span>
                      <span className={styles.fieldValue}>{item.proxyUrl}</span>
                    </div>
                  )}
                  {/* 自定义请求头徽章 */}
                  {headerEntries.length > 0 && (
                    <div className={styles.headerBadgeList}>
                      {headerEntries.map(([key, value]) => (
                        <span key={key} className={styles.headerBadge}>
                          <strong>{key}:</strong> {value}
                        </span>
                      ))}
                    </div>
                  )}
                  {configDisabled && (
                    <div className="status-badge warning" style={{ marginTop: 8, marginBottom: 0 }}>
                      {t('ai_providers.config_disabled_badge')}
                    </div>
                  )}
                  {/* 排除模型徽章 */}
                  {excludedModels.length ? (
                    <div className={styles.excludedModelsSection}>
                      <div className={styles.excludedModelsLabel}>
                        {t('ai_providers.excluded_models_count', { count: excludedModels.length })}
                      </div>
                      <div className={styles.modelTagList}>
                        {excludedModels.map((model) => (
                          <span
                            key={model}
                            className={`${styles.modelTag} ${styles.excludedModelTag}`}
                          >
                            <span className={styles.modelName}>{model}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {/* 成功/失败统计 */}
                  <div className={styles.cardStats}>
                    <span className={`${styles.statPill} ${styles.statSuccess}`}>
                      {t('stats.success')}: {stats.success}
                    </span>
                    <span className={`${styles.statPill} ${styles.statFailure}`}>
                      {t('stats.failure')}: {stats.failure}
                    </span>
                  </div>
                </Fragment>
              );
            },
            (index) => openProviderModal('codex', index),
            (item) => deleteProviderEntry('codex', item.apiKey),
            t('ai_providers.codex_add_button'),
            undefined,
            {
              getRowDisabled: (item) => hasDisableAllModelsRule(item.excludedModels),
              renderExtraActions: (item, index) => (
                <ToggleSwitch
                  label={t('ai_providers.config_toggle_label')}
                  checked={!hasDisableAllModelsRule(item.excludedModels)}
                  disabled={disableControls || loading || saving || Boolean(configSwitchingKey)}
                  onChange={(value) => void setConfigEnabled('codex', index, value)}
                />
              ),
            }
          )}
        </Card>

        <Card
          title={t('ai_providers.claude_title')}
          extra={
            <Button
              size="sm"
              onClick={() => openProviderModal('claude', null)}
              disabled={disableControls || saving || Boolean(configSwitchingKey)}
            >
              {t('ai_providers.claude_add_button')}
            </Button>
          }
        >
          {renderList<ProviderKeyConfig>(
            claudeConfigs,
            (item) => item.apiKey,
            (item, _index) => {
              const stats = getStatsBySource(item.apiKey, keyStats, maskApiKey);
              const headerEntries = Object.entries(item.headers || {});
              const configDisabled = hasDisableAllModelsRule(item.excludedModels);
              const excludedModels = item.excludedModels ?? [];
              return (
                <Fragment>
                  <div className="item-title">{t('ai_providers.claude_item_title')}</div>
                  {/* API Key 行 */}
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>{t('common.api_key')}:</span>
                    <span className={styles.fieldValue}>{maskApiKey(item.apiKey)}</span>
                  </div>
                  {/* Base URL 行 */}
                  {item.baseUrl && (
                    <div className={styles.fieldRow}>
                      <span className={styles.fieldLabel}>{t('common.base_url')}:</span>
                      <span className={styles.fieldValue}>{item.baseUrl}</span>
                    </div>
                  )}
                  {/* Proxy URL 行 */}
                  {item.proxyUrl && (
                    <div className={styles.fieldRow}>
                      <span className={styles.fieldLabel}>{t('common.proxy_url')}:</span>
                      <span className={styles.fieldValue}>{item.proxyUrl}</span>
                    </div>
                  )}
                  {/* 自定义请求头徽章 */}
                  {headerEntries.length > 0 && (
                    <div className={styles.headerBadgeList}>
                      {headerEntries.map(([key, value]) => (
                        <span key={key} className={styles.headerBadge}>
                          <strong>{key}:</strong> {value}
                        </span>
                      ))}
                    </div>
                  )}
                  {configDisabled && (
                    <div className="status-badge warning" style={{ marginTop: 8, marginBottom: 0 }}>
                      {t('ai_providers.config_disabled_badge')}
                    </div>
                  )}
                  {/* 模型列表 */}
                  {item.models?.length ? (
                    <div className={styles.modelTagList}>
                      <span className={styles.modelCountLabel}>
                        {t('ai_providers.claude_models_count')}: {item.models.length}
                      </span>
                      {item.models.map((model) => (
                        <span key={model.name} className={styles.modelTag}>
                          <span className={styles.modelName}>{model.name}</span>
                          {model.alias && model.alias !== model.name && (
                            <span className={styles.modelAlias}>{model.alias}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {/* 排除模型徽章 */}
                  {excludedModels.length ? (
                    <div className={styles.excludedModelsSection}>
                      <div className={styles.excludedModelsLabel}>
                        {t('ai_providers.excluded_models_count', { count: excludedModels.length })}
                      </div>
                      <div className={styles.modelTagList}>
                        {excludedModels.map((model) => (
                          <span
                            key={model}
                            className={`${styles.modelTag} ${styles.excludedModelTag}`}
                          >
                            <span className={styles.modelName}>{model}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {/* 成功/失败统计 */}
                  <div className={styles.cardStats}>
                    <span className={`${styles.statPill} ${styles.statSuccess}`}>
                      {t('stats.success')}: {stats.success}
                    </span>
                    <span className={`${styles.statPill} ${styles.statFailure}`}>
                      {t('stats.failure')}: {stats.failure}
                    </span>
                  </div>
                </Fragment>
              );
            },
            (index) => openProviderModal('claude', index),
            (item) => deleteProviderEntry('claude', item.apiKey),
            t('ai_providers.claude_add_button'),
            undefined,
            {
              getRowDisabled: (item) => hasDisableAllModelsRule(item.excludedModels),
              renderExtraActions: (item, index) => (
                <ToggleSwitch
                  label={t('ai_providers.config_toggle_label')}
                  checked={!hasDisableAllModelsRule(item.excludedModels)}
                  disabled={disableControls || loading || saving || Boolean(configSwitchingKey)}
                  onChange={(value) => void setConfigEnabled('claude', index, value)}
                />
              ),
            }
          )}
        </Card>

        <Card
          title={t('ai_providers.ampcode_title')}
          extra={
            <Button
              size="sm"
              onClick={openAmpcodeModal}
              disabled={disableControls || saving || ampcodeSaving || Boolean(configSwitchingKey)}
            >
              {t('common.edit')}
            </Button>
          }
        >
          {loading ? (
            <div className="hint">{t('common.loading')}</div>
          ) : (
            <>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>
                  {t('ai_providers.ampcode_upstream_url_label')}:
                </span>
                <span className={styles.fieldValue}>
                  {config?.ampcode?.upstreamUrl || t('common.not_set')}
                </span>
              </div>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>
                  {t('ai_providers.ampcode_upstream_api_key_label')}:
                </span>
                <span className={styles.fieldValue}>
                  {config?.ampcode?.upstreamApiKey
                    ? maskApiKey(config.ampcode.upstreamApiKey)
                    : t('common.not_set')}
                </span>
              </div>
              <div className={styles.fieldRow}>
                <span className={styles.fieldLabel}>
                  {t('ai_providers.ampcode_force_model_mappings_label')}:
                </span>
                <span className={styles.fieldValue}>
                  {(config?.ampcode?.forceModelMappings ?? false)
                    ? t('common.yes')
                    : t('common.no')}
                </span>
              </div>
              <div className={styles.fieldRow} style={{ marginTop: 8 }}>
                <span className={styles.fieldLabel}>
                  {t('ai_providers.ampcode_model_mappings_count')}:
                </span>
                <span className={styles.fieldValue}>
                  {config?.ampcode?.modelMappings?.length || 0}
                </span>
              </div>
              {config?.ampcode?.modelMappings?.length ? (
                <div className={styles.modelTagList}>
                  {config.ampcode.modelMappings.slice(0, 5).map((mapping) => (
                    <span key={`${mapping.from}→${mapping.to}`} className={styles.modelTag}>
                      <span className={styles.modelName}>{mapping.from}</span>
                      <span className={styles.modelAlias}>{mapping.to}</span>
                    </span>
                  ))}
                  {config.ampcode.modelMappings.length > 5 && (
                    <span className={styles.modelTag}>
                      <span className={styles.modelName}>
                        +{config.ampcode.modelMappings.length - 5}
                      </span>
                    </span>
                  )}
                </div>
              ) : null}
            </>
          )}
        </Card>

        <Card
          title={t('ai_providers.openai_title')}
          extra={
            <Button
              size="sm"
              onClick={() => openOpenaiModal(null)}
              disabled={disableControls || saving || Boolean(configSwitchingKey)}
            >
              {t('ai_providers.openai_add_button')}
            </Button>
          }
        >
          {renderList<OpenAIProviderConfig>(
            openaiProviders,
            (item) => item.name,
            (item, _index) => {
              const stats = getOpenAIProviderStats(item.apiKeyEntries, keyStats, maskApiKey);
              const headerEntries = Object.entries(item.headers || {});
              const apiKeyEntries = item.apiKeyEntries || [];
              return (
                <Fragment>
                  <div className="item-title">{item.name}</div>
                  {/* Base URL 行 */}
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>{t('common.base_url')}:</span>
                    <span className={styles.fieldValue}>{item.baseUrl}</span>
                  </div>
                  {/* 自定义请求头徽章 */}
                  {headerEntries.length > 0 && (
                    <div className={styles.headerBadgeList}>
                      {headerEntries.map(([key, value]) => (
                        <span key={key} className={styles.headerBadge}>
                          <strong>{key}:</strong> {value}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* API密钥条目二级卡片 */}
                  {apiKeyEntries.length > 0 && (
                    <div className={styles.apiKeyEntriesSection}>
                      <div className={styles.apiKeyEntriesLabel}>
                        {t('ai_providers.openai_keys_count')}: {apiKeyEntries.length}
                      </div>
                      <div className={styles.apiKeyEntryList}>
                        {apiKeyEntries.map((entry, entryIndex) => {
                          const entryStats = getStatsBySource(entry.apiKey, keyStats, maskApiKey);
                          return (
                            <div key={entryIndex} className={styles.apiKeyEntryCard}>
                              <span className={styles.apiKeyEntryIndex}>{entryIndex + 1}</span>
                              <span className={styles.apiKeyEntryKey}>
                                {maskApiKey(entry.apiKey)}
                              </span>
                              {entry.proxyUrl && (
                                <span className={styles.apiKeyEntryProxy}>{entry.proxyUrl}</span>
                              )}
                              <div className={styles.apiKeyEntryStats}>
                                <span
                                  className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatSuccess}`}
                                >
                                  <IconCheck size={12} /> {entryStats.success}
                                </span>
                                <span
                                  className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatFailure}`}
                                >
                                  <IconX size={12} /> {entryStats.failure}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* 模型数量标签 */}
                  <div className={styles.fieldRow} style={{ marginTop: '8px' }}>
                    <span className={styles.fieldLabel}>
                      {t('ai_providers.openai_models_count')}:
                    </span>
                    <span className={styles.fieldValue}>{item.models?.length || 0}</span>
                  </div>
                  {/* 模型列表徽章 */}
                  {item.models?.length ? (
                    <div className={styles.modelTagList}>
                      {item.models.map((model) => (
                        <span key={model.name} className={styles.modelTag}>
                          <span className={styles.modelName}>{model.name}</span>
                          {model.alias && model.alias !== model.name && (
                            <span className={styles.modelAlias}>{model.alias}</span>
                          )}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {/* 测试模型 */}
                  {item.testModel && (
                    <div className={styles.fieldRow}>
                      <span className={styles.fieldLabel}>Test Model:</span>
                      <span className={styles.fieldValue}>{item.testModel}</span>
                    </div>
                  )}
                  {/* 成功/失败统计（汇总） */}
                  <div className={styles.cardStats}>
                    <span className={`${styles.statPill} ${styles.statSuccess}`}>
                      {t('stats.success')}: {stats.success}
                    </span>
                    <span className={`${styles.statPill} ${styles.statFailure}`}>
                      {t('stats.failure')}: {stats.failure}
                    </span>
                  </div>
                </Fragment>
              );
            },
            (index) => openOpenaiModal(index),
            (item) => deleteOpenai(item.name),
            t('ai_providers.openai_add_button')
          )}
        </Card>

        {/* Ampcode Modal */}
        <Modal
          open={modal?.type === 'ampcode'}
          onClose={closeModal}
          title={t('ai_providers.ampcode_modal_title')}
          footer={
            <>
              <Button variant="secondary" onClick={closeModal} disabled={ampcodeSaving}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={saveAmpcode}
                loading={ampcodeSaving}
                disabled={disableControls || ampcodeModalLoading}
              >
                {t('common.save')}
              </Button>
            </>
          }
        >
          {ampcodeModalError && <div className="error-box">{ampcodeModalError}</div>}
          <Input
            label={t('ai_providers.ampcode_upstream_url_label')}
            placeholder={t('ai_providers.ampcode_upstream_url_placeholder')}
            value={ampcodeForm.upstreamUrl}
            onChange={(e) => setAmpcodeForm((prev) => ({ ...prev, upstreamUrl: e.target.value }))}
            disabled={ampcodeModalLoading || ampcodeSaving}
            hint={t('ai_providers.ampcode_upstream_url_hint')}
          />
          <Input
            label={t('ai_providers.ampcode_upstream_api_key_label')}
            placeholder={t('ai_providers.ampcode_upstream_api_key_placeholder')}
            type="password"
            value={ampcodeForm.upstreamApiKey}
            onChange={(e) =>
              setAmpcodeForm((prev) => ({ ...prev, upstreamApiKey: e.target.value }))
            }
            disabled={ampcodeModalLoading || ampcodeSaving}
            hint={t('ai_providers.ampcode_upstream_api_key_hint')}
          />
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              marginTop: -8,
              marginBottom: 12,
              flexWrap: 'wrap',
            }}
          >
            <div className="hint" style={{ margin: 0 }}>
              {t('ai_providers.ampcode_upstream_api_key_current', {
                key: config?.ampcode?.upstreamApiKey
                  ? maskApiKey(config.ampcode.upstreamApiKey)
                  : t('common.not_set'),
              })}
            </div>
            <Button
              variant="danger"
              size="sm"
              onClick={clearAmpcodeUpstreamApiKey}
              disabled={ampcodeModalLoading || ampcodeSaving || !config?.ampcode?.upstreamApiKey}
            >
              {t('ai_providers.ampcode_clear_upstream_api_key')}
            </Button>
          </div>

          <div className="form-group">
            <ToggleSwitch
              label={t('ai_providers.ampcode_force_model_mappings_label')}
              checked={ampcodeForm.forceModelMappings}
              onChange={(value) =>
                setAmpcodeForm((prev) => ({ ...prev, forceModelMappings: value }))
              }
              disabled={ampcodeModalLoading || ampcodeSaving}
            />
            <div className="hint">{t('ai_providers.ampcode_force_model_mappings_hint')}</div>
          </div>

          <div className="form-group">
            <label>{t('ai_providers.ampcode_model_mappings_label')}</label>
            <ModelInputList
              entries={ampcodeForm.mappingEntries}
              onChange={(entries) => {
                setAmpcodeMappingsDirty(true);
                setAmpcodeForm((prev) => ({ ...prev, mappingEntries: entries }));
              }}
              addLabel={t('ai_providers.ampcode_model_mappings_add_btn')}
              namePlaceholder={t('ai_providers.ampcode_model_mappings_from_placeholder')}
              aliasPlaceholder={t('ai_providers.ampcode_model_mappings_to_placeholder')}
              disabled={ampcodeModalLoading || ampcodeSaving}
            />
            <div className="hint">{t('ai_providers.ampcode_model_mappings_hint')}</div>
          </div>
        </Modal>

        {/* Gemini Modal */}
        <Modal
          open={modal?.type === 'gemini'}
          onClose={closeModal}
          title={
            modal?.index !== null
              ? t('ai_providers.gemini_edit_modal_title')
              : t('ai_providers.gemini_add_modal_title')
          }
          footer={
            <>
              <Button variant="secondary" onClick={closeModal} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button onClick={saveGemini} loading={saving}>
                {t('common.save')}
              </Button>
            </>
          }
        >
          <Input
            label={t('ai_providers.gemini_add_modal_key_label')}
            placeholder={t('ai_providers.gemini_add_modal_key_placeholder')}
            value={geminiForm.apiKey}
            onChange={(e) => setGeminiForm((prev) => ({ ...prev, apiKey: e.target.value }))}
          />
          <Input
            label={t('ai_providers.gemini_base_url_label')}
            placeholder={t('ai_providers.gemini_base_url_placeholder')}
            value={geminiForm.baseUrl ?? ''}
            onChange={(e) => setGeminiForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
          />
          <HeaderInputList
            entries={headersToEntries(geminiForm.headers as any)}
            onChange={(entries) =>
              setGeminiForm((prev) => ({ ...prev, headers: buildHeaderObject(entries) }))
            }
            addLabel={t('common.custom_headers_add')}
            keyPlaceholder={t('common.custom_headers_key_placeholder')}
            valuePlaceholder={t('common.custom_headers_value_placeholder')}
          />
          <div className="form-group">
            <label>{t('ai_providers.excluded_models_label')}</label>
            <textarea
              className="input"
              placeholder={t('ai_providers.excluded_models_placeholder')}
              value={geminiForm.excludedText}
              onChange={(e) => setGeminiForm((prev) => ({ ...prev, excludedText: e.target.value }))}
              rows={4}
            />
            <div className="hint">{t('ai_providers.excluded_models_hint')}</div>
          </div>
        </Modal>

        {/* Codex / Claude Modal */}
        <Modal
          open={modal?.type === 'codex' || modal?.type === 'claude'}
          onClose={closeModal}
          title={
            modal?.type === 'codex'
              ? modal.index !== null
                ? t('ai_providers.codex_edit_modal_title')
                : t('ai_providers.codex_add_modal_title')
              : modal?.type === 'claude' && modal.index !== null
                ? t('ai_providers.claude_edit_modal_title')
                : t('ai_providers.claude_add_modal_title')
          }
          footer={
            <>
              <Button variant="secondary" onClick={closeModal} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={() => saveProvider(modal?.type as 'codex' | 'claude')}
                loading={saving}
              >
                {t('common.save')}
              </Button>
            </>
          }
        >
          <Input
            label={
              modal?.type === 'codex'
                ? t('ai_providers.codex_add_modal_key_label')
                : t('ai_providers.claude_add_modal_key_label')
            }
            value={providerForm.apiKey}
            onChange={(e) => setProviderForm((prev) => ({ ...prev, apiKey: e.target.value }))}
          />
          <Input
            label={
              modal?.type === 'codex'
                ? t('ai_providers.codex_add_modal_url_label')
                : t('ai_providers.claude_add_modal_url_label')
            }
            value={providerForm.baseUrl ?? ''}
            onChange={(e) => setProviderForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
          />
          <Input
            label={
              modal?.type === 'codex'
                ? t('ai_providers.codex_add_modal_proxy_label')
                : t('ai_providers.claude_add_modal_proxy_label')
            }
            value={providerForm.proxyUrl ?? ''}
            onChange={(e) => setProviderForm((prev) => ({ ...prev, proxyUrl: e.target.value }))}
          />
          <HeaderInputList
            entries={headersToEntries(providerForm.headers as any)}
            onChange={(entries) =>
              setProviderForm((prev) => ({ ...prev, headers: buildHeaderObject(entries) }))
            }
            addLabel={t('common.custom_headers_add')}
            keyPlaceholder={t('common.custom_headers_key_placeholder')}
            valuePlaceholder={t('common.custom_headers_value_placeholder')}
          />
          {modal?.type === 'claude' && (
            <div className="form-group">
              <label>{t('ai_providers.claude_models_label')}</label>
              <ModelInputList
                entries={providerForm.modelEntries}
                onChange={(entries) =>
                  setProviderForm((prev) => ({ ...prev, modelEntries: entries }))
                }
                addLabel={t('ai_providers.claude_models_add_btn')}
                namePlaceholder={t('common.model_name_placeholder')}
                aliasPlaceholder={t('common.model_alias_placeholder')}
                disabled={saving}
              />
            </div>
          )}
          <div className="form-group">
            <label>{t('ai_providers.excluded_models_label')}</label>
            <textarea
              className="input"
              placeholder={t('ai_providers.excluded_models_placeholder')}
              value={providerForm.excludedText}
              onChange={(e) =>
                setProviderForm((prev) => ({ ...prev, excludedText: e.target.value }))
              }
              rows={4}
            />
            <div className="hint">{t('ai_providers.excluded_models_hint')}</div>
          </div>
        </Modal>

        {/* OpenAI Modal */}
        <Modal
          open={modal?.type === 'openai'}
          onClose={closeModal}
          title={
            modal?.index !== null
              ? t('ai_providers.openai_edit_modal_title')
              : t('ai_providers.openai_add_modal_title')
          }
          footer={
            <>
              <Button variant="secondary" onClick={closeModal} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button onClick={saveOpenai} loading={saving}>
                {t('common.save')}
              </Button>
            </>
          }
        >
          <Input
            label={t('ai_providers.openai_add_modal_name_label')}
            value={openaiForm.name}
            onChange={(e) => setOpenaiForm((prev) => ({ ...prev, name: e.target.value }))}
          />
          <Input
            label={t('ai_providers.openai_add_modal_url_label')}
            value={openaiForm.baseUrl}
            onChange={(e) => setOpenaiForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
          />

          <HeaderInputList
            entries={openaiForm.headers}
            onChange={(entries) => setOpenaiForm((prev) => ({ ...prev, headers: entries }))}
            addLabel={t('common.custom_headers_add')}
            keyPlaceholder={t('common.custom_headers_key_placeholder')}
            valuePlaceholder={t('common.custom_headers_value_placeholder')}
          />

          <div className="form-group">
            <label>
              {modal?.index !== null
                ? t('ai_providers.openai_edit_modal_models_label')
                : t('ai_providers.openai_add_modal_models_label')}
            </label>
            <div className="hint">{t('ai_providers.openai_models_hint')}</div>
            <ModelInputList
              entries={openaiForm.modelEntries}
              onChange={(entries) => setOpenaiForm((prev) => ({ ...prev, modelEntries: entries }))}
              addLabel={t('ai_providers.openai_models_add_btn')}
              namePlaceholder={t('common.model_name_placeholder')}
              aliasPlaceholder={t('common.model_alias_placeholder')}
              disabled={saving}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={openOpenaiModelDiscovery}
              disabled={saving}
            >
              {t('ai_providers.openai_models_fetch_button')}
            </Button>
          </div>

          <div className="form-group">
            <label>{t('ai_providers.openai_test_title')}</label>
            <div className="hint">{t('ai_providers.openai_test_hint')}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select
                className={`input ${styles.openaiTestSelect}`}
                value={openaiTestModel}
                onChange={(e) => {
                  setOpenaiTestModel(e.target.value);
                  setOpenaiTestStatus('idle');
                  setOpenaiTestMessage('');
                }}
                disabled={saving || openaiAvailableModels.length === 0}
              >
                <option value="">
                  {openaiAvailableModels.length
                    ? t('ai_providers.openai_test_select_placeholder')
                    : t('ai_providers.openai_test_select_empty')}
                </option>
                {openaiForm.modelEntries
                  .filter((entry) => entry.name.trim())
                  .map((entry, idx) => {
                    const name = entry.name.trim();
                    const alias = entry.alias.trim();
                    const label = alias && alias !== name ? `${name} (${alias})` : name;
                    return (
                      <option key={`${name}-${idx}`} value={name}>
                        {label}
                      </option>
                    );
                  })}
              </select>
              <Button
                variant={openaiTestStatus === 'error' ? 'danger' : 'secondary'}
                className={`${styles.openaiTestButton} ${openaiTestStatus === 'success' ? styles.openaiTestButtonSuccess : ''}`}
                onClick={testOpenaiProviderConnection}
                loading={openaiTestStatus === 'loading'}
                disabled={saving || openaiAvailableModels.length === 0}
              >
                {t('ai_providers.openai_test_action')}
              </Button>
            </div>
            {openaiTestMessage && (
              <div
                className={`status-badge ${
                  openaiTestStatus === 'error'
                    ? 'error'
                    : openaiTestStatus === 'success'
                      ? 'success'
                      : 'muted'
                }`}
              >
                {openaiTestMessage}
              </div>
            )}
          </div>

          <div className="form-group">
            <label>{t('ai_providers.openai_add_modal_keys_label')}</label>
            {renderKeyEntries(openaiForm.apiKeyEntries)}
          </div>
        </Modal>

        {/* OpenAI Models Discovery Modal */}
        <Modal
          open={openaiDiscoveryOpen}
          onClose={closeOpenaiModelDiscovery}
          title={t('ai_providers.openai_models_fetch_title')}
          width={720}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={closeOpenaiModelDiscovery}
                disabled={openaiDiscoveryLoading}
              >
                {t('ai_providers.openai_models_fetch_back')}
              </Button>
              <Button
                onClick={applyOpenaiModelDiscoverySelection}
                disabled={openaiDiscoveryLoading}
              >
                {t('ai_providers.openai_models_fetch_apply')}
              </Button>
            </>
          }
        >
          <div className="hint" style={{ marginBottom: 8 }}>
            {t('ai_providers.openai_models_fetch_hint')}
          </div>
          <div className="form-group">
            <label>{t('ai_providers.openai_models_fetch_url_label')}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="input" readOnly value={openaiDiscoveryEndpoint} />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fetchOpenaiModelDiscovery({ allowFallback: true })}
                loading={openaiDiscoveryLoading}
              >
                {t('ai_providers.openai_models_fetch_refresh')}
              </Button>
            </div>
          </div>
          <Input
            label={t('ai_providers.openai_models_search_label')}
            placeholder={t('ai_providers.openai_models_search_placeholder')}
            value={openaiDiscoverySearch}
            onChange={(e) => setOpenaiDiscoverySearch(e.target.value)}
          />
          {openaiDiscoveryError && <div className="error-box">{openaiDiscoveryError}</div>}
          {openaiDiscoveryLoading ? (
            <div className="hint">{t('ai_providers.openai_models_fetch_loading')}</div>
          ) : openaiDiscoveryModels.length === 0 ? (
            <div className="hint">{t('ai_providers.openai_models_fetch_empty')}</div>
          ) : filteredOpenaiDiscoveryModels.length === 0 ? (
            <div className="hint">{t('ai_providers.openai_models_search_empty')}</div>
          ) : (
            <div className={styles.modelDiscoveryList}>
              {filteredOpenaiDiscoveryModels.map((model) => {
                const checked = openaiDiscoverySelected.has(model.name);
                return (
                  <label
                    key={model.name}
                    className={`${styles.modelDiscoveryRow} ${checked ? styles.modelDiscoveryRowSelected : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOpenaiModelSelection(model.name)}
                    />
                    <div className={styles.modelDiscoveryMeta}>
                      <div className={styles.modelDiscoveryName}>
                        {model.name}
                        {model.alias && (
                          <span className={styles.modelDiscoveryAlias}>{model.alias}</span>
                        )}
                      </div>
                      {model.description && (
                        <div className={styles.modelDiscoveryDesc}>{model.description}</div>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
}
