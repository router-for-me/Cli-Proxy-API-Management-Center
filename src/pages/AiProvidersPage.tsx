import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { entriesToModels } from '@/components/ui/ModelInputList';
import {
  AmpcodeSection,
  ClaudeSection,
  CodexSection,
  GeminiSection,
  OpenAISection,
  VertexSection,
  useProviderStats,
  type GeminiFormState,
  type OpenAIFormState,
  type ProviderFormState,
  type ProviderModal,
  type VertexFormState,
} from '@/components/providers';
import {
  parseExcludedModels,
  withDisableAllModelsRule,
  withoutDisableAllModelsRule,
} from '@/components/providers/utils';
import { ampcodeApi, providersApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore, useThemeStore } from '@/stores';
import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import { buildHeaderObject } from '@/utils/headers';
import styles from './AiProvidersPage.module.scss';

export function AiProvidersPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
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
  const [vertexConfigs, setVertexConfigs] = useState<ProviderKeyConfig[]>([]);
  const [openaiProviders, setOpenaiProviders] = useState<OpenAIProviderConfig[]>([]);

  const [saving, setSaving] = useState(false);
  const [configSwitchingKey, setConfigSwitchingKey] = useState<string | null>(null);
  const [modal, setModal] = useState<ProviderModal | null>(null);
  const [ampcodeBusy, setAmpcodeBusy] = useState(false);

  const disableControls = connectionStatus !== 'connected';
  const isSwitching = Boolean(configSwitchingKey);

  const { keyStats, usageDetails, loadKeyStats } = useProviderStats();

  const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return '';
  };

  const loadConfigs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [configResult, vertexResult, ampcodeResult] = await Promise.allSettled([
        fetchConfig(),
        providersApi.getVertexConfigs(),
        ampcodeApi.getAmpcode(),
      ]);

      if (configResult.status !== 'fulfilled') {
        throw configResult.reason;
      }

      const data = configResult.value;
      setGeminiKeys(data?.geminiApiKeys || []);
      setCodexConfigs(data?.codexApiKeys || []);
      setClaudeConfigs(data?.claudeApiKeys || []);
      setVertexConfigs(data?.vertexApiKeys || []);
      setOpenaiProviders(data?.openaiCompatibility || []);

      if (vertexResult.status === 'fulfilled') {
        setVertexConfigs(vertexResult.value || []);
        updateConfigValue('vertex-api-key', vertexResult.value || []);
        clearCache('vertex-api-key');
      }

      if (ampcodeResult.status === 'fulfilled') {
        updateConfigValue('ampcode', ampcodeResult.value);
        clearCache('ampcode');
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err) || t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [clearCache, fetchConfig, t, updateConfigValue]);

  useEffect(() => {
    loadConfigs();
    loadKeyStats();
  }, [loadConfigs, loadKeyStats]);

  useEffect(() => {
    if (config?.geminiApiKeys) setGeminiKeys(config.geminiApiKeys);
    if (config?.codexApiKeys) setCodexConfigs(config.codexApiKeys);
    if (config?.claudeApiKeys) setClaudeConfigs(config.claudeApiKeys);
    if (config?.vertexApiKeys) setVertexConfigs(config.vertexApiKeys);
    if (config?.openaiCompatibility) setOpenaiProviders(config.openaiCompatibility);
  }, [
    config?.geminiApiKeys,
    config?.codexApiKeys,
    config?.claudeApiKeys,
    config?.vertexApiKeys,
    config?.openaiCompatibility,
  ]);

  const closeModal = () => {
    setModal(null);
  };

  const openGeminiModal = (index: number | null) => {
    setModal({ type: 'gemini', index });
  };

  const openProviderModal = (type: 'codex' | 'claude', index: number | null) => {
    setModal({ type, index });
  };

  const openVertexModal = (index: number | null) => {
    setModal({ type: 'vertex', index });
  };

  const openAmpcodeModal = () => {
    setModal({ type: 'ampcode', index: null });
  };

  const openOpenaiModal = (index: number | null) => {
    setModal({ type: 'openai', index });
  };

  const saveGemini = async (form: GeminiFormState, editIndex: number | null) => {
    setSaving(true);
    try {
      const payload: GeminiKeyConfig = {
        apiKey: form.apiKey.trim(),
        prefix: form.prefix?.trim() || undefined,
        baseUrl: form.baseUrl?.trim() || undefined,
        headers: buildHeaderObject(form.headers),
        excludedModels: parseExcludedModels(form.excludedText),
      };
      const nextList =
        editIndex !== null
          ? geminiKeys.map((item, idx) => (idx === editIndex ? payload : item))
          : [...geminiKeys, payload];

      await providersApi.saveGeminiKeys(nextList);
      setGeminiKeys(nextList);
      updateConfigValue('gemini-api-key', nextList);
      clearCache('gemini-api-key');
      const message =
        editIndex !== null
          ? t('notification.gemini_key_updated')
          : t('notification.gemini_key_added');
      showNotification(message, 'success');
      closeModal();
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteGemini = async (index: number) => {
    const entry = geminiKeys[index];
    if (!entry) return;
    if (!window.confirm(t('ai_providers.gemini_delete_confirm'))) return;
    try {
      await providersApi.deleteGeminiKey(entry.apiKey);
      const next = geminiKeys.filter((_, idx) => idx !== index);
      setGeminiKeys(next);
      updateConfigValue('gemini-api-key', next);
      clearCache('gemini-api-key');
      showNotification(t('notification.gemini_key_deleted'), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
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
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        setGeminiKeys(previousList);
        updateConfigValue('gemini-api-key', previousList);
        clearCache('gemini-api-key');
        showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
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
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      if (provider === 'codex') {
        setCodexConfigs(previousList);
        updateConfigValue('codex-api-key', previousList);
        clearCache('codex-api-key');
      } else {
        setClaudeConfigs(previousList);
        updateConfigValue('claude-api-key', previousList);
        clearCache('claude-api-key');
      }
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setConfigSwitchingKey(null);
    }
  };

  const saveProvider = async (
    type: 'codex' | 'claude',
    form: ProviderFormState,
    editIndex: number | null
  ) => {
    const trimmedBaseUrl = (form.baseUrl ?? '').trim();
    const baseUrl = trimmedBaseUrl || undefined;
    if (type === 'codex' && !baseUrl) {
      showNotification(t('notification.codex_base_url_required'), 'error');
      return;
    }

    setSaving(true);
    try {
      const source = type === 'codex' ? codexConfigs : claudeConfigs;

      const payload: ProviderKeyConfig = {
        apiKey: form.apiKey.trim(),
        prefix: form.prefix?.trim() || undefined,
        baseUrl,
        proxyUrl: form.proxyUrl?.trim() || undefined,
        headers: buildHeaderObject(form.headers),
        models: entriesToModels(form.modelEntries),
        excludedModels: parseExcludedModels(form.excludedText),
      };

      const nextList =
        editIndex !== null
          ? source.map((item, idx) => (idx === editIndex ? payload : item))
          : [...source, payload];

      if (type === 'codex') {
        await providersApi.saveCodexConfigs(nextList);
        setCodexConfigs(nextList);
        updateConfigValue('codex-api-key', nextList);
        clearCache('codex-api-key');
        const message =
          editIndex !== null
            ? t('notification.codex_config_updated')
            : t('notification.codex_config_added');
        showNotification(message, 'success');
      } else {
        await providersApi.saveClaudeConfigs(nextList);
        setClaudeConfigs(nextList);
        updateConfigValue('claude-api-key', nextList);
        clearCache('claude-api-key');
        const message =
          editIndex !== null
            ? t('notification.claude_config_updated')
            : t('notification.claude_config_added');
        showNotification(message, 'success');
      }

      closeModal();
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteProviderEntry = async (type: 'codex' | 'claude', index: number) => {
    const source = type === 'codex' ? codexConfigs : claudeConfigs;
    const entry = source[index];
    if (!entry) return;
    if (!window.confirm(t(`ai_providers.${type}_delete_confirm`))) return;
    try {
      if (type === 'codex') {
        await providersApi.deleteCodexConfig(entry.apiKey);
        const next = codexConfigs.filter((_, idx) => idx !== index);
        setCodexConfigs(next);
        updateConfigValue('codex-api-key', next);
        clearCache('codex-api-key');
        showNotification(t('notification.codex_config_deleted'), 'success');
      } else {
        await providersApi.deleteClaudeConfig(entry.apiKey);
        const next = claudeConfigs.filter((_, idx) => idx !== index);
        setClaudeConfigs(next);
        updateConfigValue('claude-api-key', next);
        clearCache('claude-api-key');
        showNotification(t('notification.claude_config_deleted'), 'success');
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
    }
  };

  const saveVertex = async (form: VertexFormState, editIndex: number | null) => {
    const trimmedBaseUrl = (form.baseUrl ?? '').trim();
    const baseUrl = trimmedBaseUrl || undefined;
    if (!baseUrl) {
      showNotification(t('notification.vertex_base_url_required'), 'error');
      return;
    }

    setSaving(true);
    try {
      const payload: ProviderKeyConfig = {
        apiKey: form.apiKey.trim(),
        prefix: form.prefix?.trim() || undefined,
        baseUrl,
        proxyUrl: form.proxyUrl?.trim() || undefined,
        headers: buildHeaderObject(form.headers),
        models: form.modelEntries
          .map((entry) => {
            const name = entry.name.trim();
            const alias = entry.alias.trim();
            if (!name || !alias) return null;
            return { name, alias };
          })
          .filter(Boolean) as ProviderKeyConfig['models'],
      };

      const nextList =
        editIndex !== null
          ? vertexConfigs.map((item, idx) => (idx === editIndex ? payload : item))
          : [...vertexConfigs, payload];

      await providersApi.saveVertexConfigs(nextList);
      setVertexConfigs(nextList);
      updateConfigValue('vertex-api-key', nextList);
      clearCache('vertex-api-key');
      const message =
        editIndex !== null
          ? t('notification.vertex_config_updated')
          : t('notification.vertex_config_added');
      showNotification(message, 'success');
      closeModal();
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteVertex = async (index: number) => {
    const entry = vertexConfigs[index];
    if (!entry) return;
    if (!window.confirm(t('ai_providers.vertex_delete_confirm'))) return;
    try {
      await providersApi.deleteVertexConfig(entry.apiKey);
      const next = vertexConfigs.filter((_, idx) => idx !== index);
      setVertexConfigs(next);
      updateConfigValue('vertex-api-key', next);
      clearCache('vertex-api-key');
      showNotification(t('notification.vertex_config_deleted'), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
    }
  };

  const saveOpenai = async (form: OpenAIFormState, editIndex: number | null) => {
    setSaving(true);
    try {
      const payload: OpenAIProviderConfig = {
        name: form.name.trim(),
        prefix: form.prefix?.trim() || undefined,
        baseUrl: form.baseUrl.trim(),
        headers: buildHeaderObject(form.headers),
        apiKeyEntries: form.apiKeyEntries.map((entry) => ({
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
          ? openaiProviders.map((item, idx) => (idx === editIndex ? payload : item))
          : [...openaiProviders, payload];

      await providersApi.saveOpenAIProviders(nextList);
      setOpenaiProviders(nextList);
      updateConfigValue('openai-compatibility', nextList);
      clearCache('openai-compatibility');
      const message =
        editIndex !== null
          ? t('notification.openai_provider_updated')
          : t('notification.openai_provider_added');
      showNotification(message, 'success');
      closeModal();
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(`${t('notification.update_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteOpenai = async (index: number) => {
    const entry = openaiProviders[index];
    if (!entry) return;
    if (!window.confirm(t('ai_providers.openai_delete_confirm'))) return;
    try {
      await providersApi.deleteOpenAIProvider(entry.name);
      const next = openaiProviders.filter((_, idx) => idx !== index);
      setOpenaiProviders(next);
      updateConfigValue('openai-compatibility', next);
      clearCache('openai-compatibility');
      showNotification(t('notification.openai_provider_deleted'), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
    }
  };

  const geminiModalIndex = modal?.type === 'gemini' ? modal.index : null;
  const codexModalIndex = modal?.type === 'codex' ? modal.index : null;
  const claudeModalIndex = modal?.type === 'claude' ? modal.index : null;
  const vertexModalIndex = modal?.type === 'vertex' ? modal.index : null;
  const openaiModalIndex = modal?.type === 'openai' ? modal.index : null;

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('ai_providers.title')}</h1>
      <div className={styles.content}>
        {error && <div className="error-box">{error}</div>}

        <GeminiSection
          configs={geminiKeys}
          keyStats={keyStats}
          usageDetails={usageDetails}
          loading={loading}
          disableControls={disableControls}
          isSaving={saving}
          isSwitching={isSwitching}
          isModalOpen={modal?.type === 'gemini'}
          modalIndex={geminiModalIndex}
          onAdd={() => openGeminiModal(null)}
          onEdit={(index) => openGeminiModal(index)}
          onDelete={deleteGemini}
          onToggle={(index, enabled) => void setConfigEnabled('gemini', index, enabled)}
          onCloseModal={closeModal}
          onSave={saveGemini}
        />

        <CodexSection
          configs={codexConfigs}
          keyStats={keyStats}
          usageDetails={usageDetails}
          loading={loading}
          disableControls={disableControls}
          isSaving={saving}
          isSwitching={isSwitching}
          resolvedTheme={resolvedTheme}
          isModalOpen={modal?.type === 'codex'}
          modalIndex={codexModalIndex}
          onAdd={() => openProviderModal('codex', null)}
          onEdit={(index) => openProviderModal('codex', index)}
          onDelete={(index) => void deleteProviderEntry('codex', index)}
          onToggle={(index, enabled) => void setConfigEnabled('codex', index, enabled)}
          onCloseModal={closeModal}
          onSave={(form, editIndex) => saveProvider('codex', form, editIndex)}
        />

        <ClaudeSection
          configs={claudeConfigs}
          keyStats={keyStats}
          usageDetails={usageDetails}
          loading={loading}
          disableControls={disableControls}
          isSaving={saving}
          isSwitching={isSwitching}
          isModalOpen={modal?.type === 'claude'}
          modalIndex={claudeModalIndex}
          onAdd={() => openProviderModal('claude', null)}
          onEdit={(index) => openProviderModal('claude', index)}
          onDelete={(index) => void deleteProviderEntry('claude', index)}
          onToggle={(index, enabled) => void setConfigEnabled('claude', index, enabled)}
          onCloseModal={closeModal}
          onSave={(form, editIndex) => saveProvider('claude', form, editIndex)}
        />

        <VertexSection
          configs={vertexConfigs}
          keyStats={keyStats}
          usageDetails={usageDetails}
          loading={loading}
          disableControls={disableControls}
          isSaving={saving}
          isSwitching={isSwitching}
          isModalOpen={modal?.type === 'vertex'}
          modalIndex={vertexModalIndex}
          onAdd={() => openVertexModal(null)}
          onEdit={(index) => openVertexModal(index)}
          onDelete={deleteVertex}
          onCloseModal={closeModal}
          onSave={saveVertex}
        />

        <AmpcodeSection
          config={config?.ampcode}
          loading={loading}
          disableControls={disableControls}
          isSaving={saving}
          isSwitching={isSwitching}
          isBusy={ampcodeBusy}
          isModalOpen={modal?.type === 'ampcode'}
          onOpen={openAmpcodeModal}
          onCloseModal={closeModal}
          onBusyChange={setAmpcodeBusy}
        />

        <OpenAISection
          configs={openaiProviders}
          keyStats={keyStats}
          usageDetails={usageDetails}
          loading={loading}
          disableControls={disableControls}
          isSaving={saving}
          isSwitching={isSwitching}
          resolvedTheme={resolvedTheme}
          isModalOpen={modal?.type === 'openai'}
          modalIndex={openaiModalIndex}
          onAdd={() => openOpenaiModal(null)}
          onEdit={(index) => openOpenaiModal(index)}
          onDelete={deleteOpenai}
          onCloseModal={closeModal}
          onSave={saveOpenai}
        />
      </div>
    </div>
  );
}
