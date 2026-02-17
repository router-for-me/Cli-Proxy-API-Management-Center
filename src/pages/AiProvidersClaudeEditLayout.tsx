import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { providersApi } from '@/services/api';
import { useAuthStore, useClaudeEditDraftStore, useConfigStore, useNotificationStore } from '@/stores';
import type { ProviderKeyConfig } from '@/types';
import type { ModelInfo } from '@/utils/models';
import type { ModelEntry, ProviderFormState } from '@/components/providers/types';
import { buildHeaderObject, headersToEntries } from '@/utils/headers';
import { excludedModelsToText, parseExcludedModels } from '@/components/providers/utils';
import { modelsToEntries } from '@/components/ui/modelInputListUtils';

type LocationState = { fromAiProviders?: boolean } | null;

type TestStatus = 'idle' | 'loading' | 'success' | 'error';

export type ClaudeEditOutletContext = {
  hasIndexParam: boolean;
  editIndex: number | null;
  invalidIndexParam: boolean;
  invalidIndex: boolean;
  disableControls: boolean;
  loading: boolean;
  saving: boolean;
  form: ProviderFormState;
  setForm: Dispatch<SetStateAction<ProviderFormState>>;
  testModel: string;
  setTestModel: Dispatch<SetStateAction<string>>;
  testStatus: TestStatus;
  setTestStatus: Dispatch<SetStateAction<TestStatus>>;
  testMessage: string;
  setTestMessage: Dispatch<SetStateAction<string>>;
  availableModels: string[];
  handleBack: () => void;
  handleSave: () => Promise<void>;
  mergeDiscoveredModels: (selectedModels: ModelInfo[]) => void;
};

const buildEmptyForm = (): ProviderFormState => ({
  apiKey: '',
  prefix: '',
  baseUrl: '',
  proxyUrl: '',
  headers: [],
  models: [],
  excludedModels: [],
  modelEntries: [{ name: '', alias: '' }],
  excludedText: '',
});

const parseIndexParam = (value: string | undefined) => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

export function AiProvidersClaudeEditLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotification } = useNotificationStore();

  const params = useParams<{ index?: string }>();
  const hasIndexParam = typeof params.index === 'string';
  const editIndex = useMemo(() => parseIndexParam(params.index), [params.index]);
  const invalidIndexParam = hasIndexParam && editIndex === null;

  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const disableControls = connectionStatus !== 'connected';

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const isCacheValid = useConfigStore((state) => state.isCacheValid);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);

  const [configs, setConfigs] = useState<ProviderKeyConfig[]>(() => config?.claudeApiKeys ?? []);
  const [loading, setLoading] = useState(() => !isCacheValid('claude-api-key'));
  const [saving, setSaving] = useState(false);

  const draftKey = useMemo(() => {
    if (invalidIndexParam) return `claude:invalid:${params.index ?? 'unknown'}`;
    if (editIndex === null) return 'claude:new';
    return `claude:${editIndex}`;
  }, [editIndex, invalidIndexParam, params.index]);

  const draft = useClaudeEditDraftStore((state) => state.drafts[draftKey]);
  const ensureDraft = useClaudeEditDraftStore((state) => state.ensureDraft);
  const initDraft = useClaudeEditDraftStore((state) => state.initDraft);
  const clearDraft = useClaudeEditDraftStore((state) => state.clearDraft);
  const setDraftForm = useClaudeEditDraftStore((state) => state.setDraftForm);
  const setDraftTestModel = useClaudeEditDraftStore((state) => state.setDraftTestModel);
  const setDraftTestStatus = useClaudeEditDraftStore((state) => state.setDraftTestStatus);
  const setDraftTestMessage = useClaudeEditDraftStore((state) => state.setDraftTestMessage);

  const form = draft?.form ?? buildEmptyForm();
  const testModel = draft?.testModel ?? '';
  const testStatus = draft?.testStatus ?? 'idle';
  const testMessage = draft?.testMessage ?? '';

  const setForm: Dispatch<SetStateAction<ProviderFormState>> = useCallback(
    (action) => {
      setDraftForm(draftKey, action);
    },
    [draftKey, setDraftForm]
  );

  const setTestModel: Dispatch<SetStateAction<string>> = useCallback(
    (action) => {
      setDraftTestModel(draftKey, action);
    },
    [draftKey, setDraftTestModel]
  );

  const setTestStatus: Dispatch<SetStateAction<TestStatus>> = useCallback(
    (action) => {
      setDraftTestStatus(draftKey, action);
    },
    [draftKey, setDraftTestStatus]
  );

  const setTestMessage: Dispatch<SetStateAction<string>> = useCallback(
    (action) => {
      setDraftTestMessage(draftKey, action);
    },
    [draftKey, setDraftTestMessage]
  );

  const initialData = useMemo(() => {
    if (editIndex === null) return undefined;
    return configs[editIndex];
  }, [configs, editIndex]);

  const invalidIndex = editIndex !== null && !initialData;

  const availableModels = useMemo(
    () => form.modelEntries.map((entry) => entry.name.trim()).filter(Boolean),
    [form.modelEntries]
  );

  useEffect(() => {
    ensureDraft(draftKey);
  }, [draftKey, ensureDraft]);

  const handleBack = useCallback(() => {
    clearDraft(draftKey);
    const state = location.state as LocationState;
    if (state?.fromAiProviders) {
      navigate(-1);
      return;
    }
    navigate('/ai-providers', { replace: true });
  }, [clearDraft, draftKey, location.state, navigate]);

  useEffect(() => {
    let cancelled = false;
    const hasValidCache = isCacheValid('claude-api-key');
    if (!hasValidCache) {
      setLoading(true);
    }

    fetchConfig('claude-api-key')
      .then((value) => {
        if (cancelled) return;
        setConfigs(Array.isArray(value) ? (value as ProviderKeyConfig[]) : []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = getErrorMessage(err) || t('notification.refresh_failed');
        showNotification(`${t('notification.load_failed')}: ${message}`, 'error');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchConfig, isCacheValid, showNotification, t]);

  useEffect(() => {
    if (loading) return;
    if (draft?.initialized) return;

    if (initialData) {
      const seededForm: ProviderFormState = {
        ...initialData,
        headers: headersToEntries(initialData.headers),
        modelEntries: modelsToEntries(initialData.models),
        excludedText: excludedModelsToText(initialData.excludedModels),
      };
      const available = seededForm.modelEntries.map((entry) => entry.name.trim()).filter(Boolean);
      initDraft(draftKey, {
        form: seededForm,
        testModel: available[0] || '',
        testStatus: 'idle',
        testMessage: '',
      });
      return;
    }

    initDraft(draftKey, {
      form: buildEmptyForm(),
      testModel: '',
      testStatus: 'idle',
      testMessage: '',
    });
  }, [draft?.initialized, draftKey, initDraft, initialData, loading]);

  const resolvedLoading = !draft?.initialized;

  useEffect(() => {
    if (resolvedLoading) return;

    if (availableModels.length === 0) {
      if (testModel) {
        setTestModel('');
        setTestStatus('idle');
        setTestMessage('');
      }
      return;
    }

    if (!testModel || !availableModels.includes(testModel)) {
      setTestModel(availableModels[0]);
      setTestStatus('idle');
      setTestMessage('');
    }
  }, [availableModels, resolvedLoading, setTestMessage, setTestModel, setTestStatus, testModel]);

  const mergeDiscoveredModels = useCallback(
    (selectedModels: ModelInfo[]) => {
      if (!selectedModels.length) return;

      let addedCount = 0;
      setForm((prev) => {
        const mergedMap = new Map<string, ModelEntry>();
        prev.modelEntries.forEach((entry) => {
          const name = entry.name.trim();
          if (!name) return;
          mergedMap.set(name, { name, alias: entry.alias?.trim() || '' });
        });

        selectedModels.forEach((model) => {
          const name = model.name.trim();
          if (!name || mergedMap.has(name)) return;
          mergedMap.set(name, { name, alias: model.alias ?? '' });
          addedCount += 1;
        });

        const mergedEntries = Array.from(mergedMap.values());
        return {
          ...prev,
          modelEntries: mergedEntries.length ? mergedEntries : [{ name: '', alias: '' }],
        };
      });

      if (addedCount > 0) {
        showNotification(t('ai_providers.claude_models_fetch_added', { count: addedCount }), 'success');
      }
    },
    [setForm, showNotification, t]
  );

  const handleSave = useCallback(async () => {
    const canSave =
      !disableControls && !saving && !resolvedLoading && !invalidIndexParam && !invalidIndex;
    if (!canSave) return;

    setSaving(true);
    try {
      const payload: ProviderKeyConfig = {
        apiKey: form.apiKey.trim(),
        prefix: form.prefix?.trim() || undefined,
        baseUrl: (form.baseUrl ?? '').trim() || undefined,
        proxyUrl: form.proxyUrl?.trim() || undefined,
        headers: buildHeaderObject(form.headers),
        models: form.modelEntries
          .map((entry) => {
            const name = entry.name.trim();
            if (!name) return null;
            const alias = entry.alias.trim();
            return { name, alias: alias || name };
          })
          .filter(Boolean) as ProviderKeyConfig['models'],
        excludedModels: parseExcludedModels(form.excludedText),
      };

      const nextList =
        editIndex !== null
          ? configs.map((item, idx) => (idx === editIndex ? payload : item))
          : [...configs, payload];

      await providersApi.saveClaudeConfigs(nextList);
      setConfigs(nextList);
      updateConfigValue('claude-api-key', nextList);
      clearCache('claude-api-key');
      showNotification(
        editIndex !== null ? t('notification.claude_config_updated') : t('notification.claude_config_added'),
        'success'
      );
      handleBack();
    } catch (err: unknown) {
      showNotification(`${t('notification.update_failed')}: ${getErrorMessage(err)}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [
    clearCache,
    configs,
    disableControls,
    editIndex,
    form,
    handleBack,
    invalidIndex,
    invalidIndexParam,
    resolvedLoading,
    saving,
    showNotification,
    t,
    updateConfigValue,
  ]);

  return (
    <Outlet
      context={{
        hasIndexParam,
        editIndex,
        invalidIndexParam,
        invalidIndex,
        disableControls,
        loading: resolvedLoading,
        saving,
        form,
        setForm,
        testModel,
        setTestModel,
        testStatus,
        setTestStatus,
        testMessage,
        setTestMessage,
        availableModels,
        handleBack,
        handleSave,
        mergeDiscoveredModels,
      } satisfies ClaudeEditOutletContext}
    />
  );
}
