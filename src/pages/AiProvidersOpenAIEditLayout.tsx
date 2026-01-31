import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { providersApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { entriesToModels, modelsToEntries } from '@/components/ui/modelInputListUtils';
import type { ApiKeyEntry, OpenAIProviderConfig } from '@/types';
import type { ModelInfo } from '@/utils/models';
import { buildHeaderObject, headersToEntries } from '@/utils/headers';
import { buildApiKeyEntry } from '@/components/providers/utils';
import type { ModelEntry, OpenAIFormState } from '@/components/providers/types';

type LocationState = { fromAiProviders?: boolean } | null;

export type OpenAIEditOutletContext = {
  hasIndexParam: boolean;
  editIndex: number | null;
  invalidIndexParam: boolean;
  invalidIndex: boolean;
  disableControls: boolean;
  loading: boolean;
  saving: boolean;
  form: OpenAIFormState;
  setForm: Dispatch<SetStateAction<OpenAIFormState>>;
  testModel: string;
  setTestModel: Dispatch<SetStateAction<string>>;
  testStatus: 'idle' | 'loading' | 'success' | 'error';
  setTestStatus: Dispatch<SetStateAction<'idle' | 'loading' | 'success' | 'error'>>;
  testMessage: string;
  setTestMessage: Dispatch<SetStateAction<string>>;
  availableModels: string[];
  handleBack: () => void;
  handleSave: () => Promise<void>;
  mergeDiscoveredModels: (selectedModels: ModelInfo[]) => void;
};

const buildEmptyForm = (): OpenAIFormState => ({
  name: '',
  prefix: '',
  baseUrl: '',
  headers: [],
  apiKeyEntries: [buildApiKeyEntry()],
  modelEntries: [{ name: '', alias: '' }],
  testModel: undefined,
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

export function AiProvidersOpenAIEditLayout() {
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

  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);

  const [providers, setProviders] = useState<OpenAIProviderConfig[]>([]);
  const [form, setForm] = useState<OpenAIFormState>(() => buildEmptyForm());
  const [testModel, setTestModel] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const initialData = useMemo(() => {
    if (editIndex === null) return undefined;
    return providers[editIndex];
  }, [editIndex, providers]);

  const invalidIndex = editIndex !== null && !initialData;

  const availableModels = useMemo(
    () => form.modelEntries.map((entry) => entry.name.trim()).filter(Boolean),
    [form.modelEntries]
  );

  const handleBack = useCallback(() => {
    const state = location.state as LocationState;
    if (state?.fromAiProviders) {
      navigate(-1);
      return;
    }
    navigate('/ai-providers', { replace: true });
  }, [location.state, navigate]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchConfig('openai-compatibility')
      .then((value) => {
        if (cancelled) return;
        setProviders(Array.isArray(value) ? (value as OpenAIProviderConfig[]) : []);
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
  }, [fetchConfig, showNotification, t]);

  useEffect(() => {
    if (loading) return;

    if (initialData) {
      const modelEntries = modelsToEntries(initialData.models);
      setForm({
        name: initialData.name,
        prefix: initialData.prefix ?? '',
        baseUrl: initialData.baseUrl,
        headers: headersToEntries(initialData.headers),
        testModel: initialData.testModel,
        modelEntries,
        apiKeyEntries: initialData.apiKeyEntries?.length
          ? initialData.apiKeyEntries
          : [buildApiKeyEntry()],
      });

      const available = modelEntries.map((entry) => entry.name.trim()).filter(Boolean);
      const initialTestModel =
        initialData.testModel && available.includes(initialData.testModel)
          ? initialData.testModel
          : available[0] || '';
      setTestModel(initialTestModel);
    } else {
      setForm(buildEmptyForm());
      setTestModel('');
    }

    setTestStatus('idle');
    setTestMessage('');
  }, [initialData, loading]);

  useEffect(() => {
    if (loading) return;

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
  }, [availableModels, loading, testModel]);

  const mergeDiscoveredModels = useCallback(
    (selectedModels: ModelInfo[]) => {
      if (!selectedModels.length) return;

      const mergedMap = new Map<string, ModelEntry>();
      form.modelEntries.forEach((entry) => {
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
      setForm((prev) => ({
        ...prev,
        modelEntries: mergedEntries.length ? mergedEntries : [{ name: '', alias: '' }],
      }));

      if (addedCount > 0) {
        showNotification(t('ai_providers.openai_models_fetch_added', { count: addedCount }), 'success');
      }
    },
    [form.modelEntries, showNotification, t]
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const payload: OpenAIProviderConfig = {
        name: form.name.trim(),
        prefix: form.prefix?.trim() || undefined,
        baseUrl: form.baseUrl.trim(),
        headers: buildHeaderObject(form.headers),
        apiKeyEntries: form.apiKeyEntries.map((entry: ApiKeyEntry) => ({
          apiKey: entry.apiKey.trim(),
          proxyUrl: entry.proxyUrl?.trim() || undefined,
          headers: entry.headers,
        })),
      };
      if (form.testModel) payload.testModel = form.testModel.trim();
      const models = entriesToModels(form.modelEntries);
      if (models.length) payload.models = models;

      const nextList =
        editIndex !== null
          ? providers.map((item, idx) => (idx === editIndex ? payload : item))
          : [...providers, payload];

      await providersApi.saveOpenAIProviders(nextList);
      setProviders(nextList);
      updateConfigValue('openai-compatibility', nextList);
      clearCache('openai-compatibility');
      showNotification(
        editIndex !== null
          ? t('notification.openai_provider_updated')
          : t('notification.openai_provider_added'),
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
    editIndex,
    form,
    handleBack,
    providers,
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
        loading,
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
      } satisfies OpenAIEditOutletContext}
    />
  );
}

