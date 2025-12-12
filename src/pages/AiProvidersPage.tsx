import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { HeaderInputList } from '@/components/ui/HeaderInputList';
import { ModelInputList, modelsToEntries, entriesToModels } from '@/components/ui/ModelInputList';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { providersApi, usageApi } from '@/services/api';
import type {
  GeminiKeyConfig,
  ProviderKeyConfig,
  OpenAIProviderConfig,
  ApiKeyEntry
} from '@/types';
import type { KeyStats, KeyStatBucket } from '@/utils/usage';
import { headersToEntries, buildHeaderObject, type HeaderEntry } from '@/utils/headers';
import { maskApiKey } from '@/utils/format';
import styles from './AiProvidersPage.module.scss';

type ProviderModal =
  | { type: 'gemini'; index: number | null }
  | { type: 'codex'; index: number | null }
  | { type: 'claude'; index: number | null }
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

const parseExcludedModels = (text: string): string[] =>
  text
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const excludedModelsToText = (models?: string[]) => (Array.isArray(models) ? models.join('\n') : '');

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
  headers: input?.headers ?? {}
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
    excludedText: ''
  });
  const [providerForm, setProviderForm] = useState<ProviderKeyConfig & { modelEntries: ModelEntry[] }>({
    apiKey: '',
    baseUrl: '',
    proxyUrl: '',
    headers: {},
    models: [],
    modelEntries: [{ name: '', alias: '' }]
  });
  const [openaiForm, setOpenaiForm] = useState<OpenAIFormState>({
    name: '',
    baseUrl: '',
    headers: [],
    apiKeyEntries: [buildApiKeyEntry()],
    modelEntries: [{ name: '', alias: '' }]
  });
  const [saving, setSaving] = useState(false);

  const disableControls = useMemo(() => connectionStatus !== 'connected', [connectionStatus]);

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
      const data = await fetchConfig(undefined, true);
      setGeminiKeys(data?.geminiApiKeys || []);
      setCodexConfigs(data?.codexApiKeys || []);
      setClaudeConfigs(data?.claudeApiKeys || []);
      setOpenaiProviders(data?.openaiCompatibility || []);
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
  }, [config?.geminiApiKeys, config?.codexApiKeys, config?.claudeApiKeys, config?.openaiCompatibility]);

  const closeModal = () => {
    setModal(null);
    setGeminiForm({
      apiKey: '',
      baseUrl: '',
      headers: {},
      excludedModels: [],
      excludedText: ''
    });
    setProviderForm({
      apiKey: '',
      baseUrl: '',
      proxyUrl: '',
      headers: {},
      models: [],
      modelEntries: [{ name: '', alias: '' }]
    });
    setOpenaiForm({
      name: '',
      baseUrl: '',
      headers: [],
      apiKeyEntries: [buildApiKeyEntry()],
      modelEntries: [{ name: '', alias: '' }],
      testModel: undefined
    });
  };

  const openGeminiModal = (index: number | null) => {
    if (index !== null) {
      const entry = geminiKeys[index];
      setGeminiForm({
        ...entry,
        excludedText: excludedModelsToText(entry?.excludedModels)
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
        modelEntries: modelsToEntries(entry?.models)
      });
    }
    setModal({ type, index });
  };

  const openOpenaiModal = (index: number | null) => {
    if (index !== null) {
      const entry = openaiProviders[index];
      setOpenaiForm({
        name: entry.name,
        baseUrl: entry.baseUrl,
        headers: headersToEntries(entry.headers),
        testModel: entry.testModel,
        modelEntries: modelsToEntries(entry.models),
        apiKeyEntries: entry.apiKeyEntries?.length ? entry.apiKeyEntries : [buildApiKeyEntry()]
      });
    }
    setModal({ type: 'openai', index });
  };

  const saveGemini = async () => {
    setSaving(true);
    try {
      const payload: GeminiKeyConfig = {
        apiKey: geminiForm.apiKey.trim(),
        baseUrl: geminiForm.baseUrl?.trim() || undefined,
        headers: buildHeaderObject(headersToEntries(geminiForm.headers as any)),
        excludedModels: parseExcludedModels(geminiForm.excludedText)
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
        modal?.index !== null ? t('notification.gemini_key_updated') : t('notification.gemini_key_added');
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

  const saveProvider = async (type: 'codex' | 'claude') => {
    const baseUrl = (providerForm.baseUrl ?? '').trim();
    if (!baseUrl) {
      showNotification(t('codex_base_url_required'), 'error');
      return;
    }

    setSaving(true);
    try {
      const payload: ProviderKeyConfig = {
        apiKey: providerForm.apiKey.trim(),
        baseUrl,
        proxyUrl: providerForm.proxyUrl?.trim() || undefined,
        headers: buildHeaderObject(headersToEntries(providerForm.headers as any)),
        models: entriesToModels(providerForm.modelEntries)
      };

      const source = type === 'codex' ? codexConfigs : claudeConfigs;
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
          modal?.index !== null ? t('notification.codex_config_updated') : t('notification.codex_config_added');
        showNotification(message, 'success');
      } else {
        await providersApi.saveClaudeConfigs(nextList);
        setClaudeConfigs(nextList);
        updateConfigValue('claude-api-key', nextList);
        clearCache('claude-api-key');
        const message =
          modal?.index !== null ? t('notification.claude_config_updated') : t('notification.claude_config_added');
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
          headers: entry.headers
        }))
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
        modal?.index !== null ? t('notification.openai_provider_updated') : t('notification.openai_provider_added');
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
      setOpenaiForm((prev) => ({ ...prev, apiKeyEntries: next.length ? next : [buildApiKeyEntry()] }));
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
    deleteLabel?: string
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
        {items.map((item, index) => (
          <div key={keyField(item)} className="item-row">
            <div className="item-meta">{renderContent(item, index)}</div>
            <div className="item-actions">
              <Button variant="secondary" size="sm" onClick={() => onEdit(index)} disabled={disableControls}>
                {t('common.edit')}
              </Button>
              <Button variant="danger" size="sm" onClick={() => onDelete(item)} disabled={disableControls}>
                {deleteLabel || t('common.delete')}
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="stack">
      {error && <div className="error-box">{error}</div>}

      <Card
        title={t('ai_providers.gemini_title')}
        extra={
          <Button size="sm" onClick={() => openGeminiModal(null)} disabled={disableControls}>
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
                {/* 排除模型徽章 */}
                {item.excludedModels?.length ? (
                  <div className={styles.excludedModelsSection}>
                    <div className={styles.excludedModelsLabel}>
                      {t('ai_providers.excluded_models_count', { count: item.excludedModels.length })}
                    </div>
                    <div className={styles.modelTagList}>
                      {item.excludedModels.map((model) => (
                        <span key={model} className={`${styles.modelTag} ${styles.excludedModelTag}`}>
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
          t('ai_providers.gemini_add_button')
        )}
      </Card>

      <Card
        title={t('ai_providers.codex_title')}
        extra={
          <Button size="sm" onClick={() => openProviderModal('codex', null)} disabled={disableControls}>
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
          t('ai_providers.codex_add_button')
        )}
      </Card>

      <Card
        title={t('ai_providers.claude_title')}
        extra={
          <Button size="sm" onClick={() => openProviderModal('claude', null)} disabled={disableControls}>
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
                {/* 模型列表 */}
                {item.models?.length ? (
                  <div className={styles.modelTagList}>
                    <div className={styles.fieldRow}>
                      <span className={styles.fieldLabel}>
                        {t('ai_providers.claude_models_count')}: {item.models.length}
                      </span>
                    </div>
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
          t('ai_providers.claude_add_button')
        )}
      </Card>

      <Card
        title={t('ai_providers.openai_title')}
        extra={
          <Button size="sm" onClick={() => openOpenaiModal(null)} disabled={disableControls}>
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
                            <span className={styles.apiKeyEntryKey}>{maskApiKey(entry.apiKey)}</span>
                            {entry.proxyUrl && (
                              <span className={styles.apiKeyEntryProxy}>{entry.proxyUrl}</span>
                            )}
                            <div className={styles.apiKeyEntryStats}>
                              <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatSuccess}`}>
                                ✓ {entryStats.success}
                              </span>
                              <span className={`${styles.apiKeyEntryStat} ${styles.apiKeyEntryStatFailure}`}>
                                ✗ {entryStats.failure}
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
                  <span className={styles.fieldLabel}>{t('ai_providers.openai_models_count')}:</span>
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

      {/* Gemini Modal */}
      <Modal
        open={modal?.type === 'gemini'}
        onClose={closeModal}
        title={
          modal?.index !== null ? t('ai_providers.gemini_edit_modal_title') : t('ai_providers.gemini_add_modal_title')
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
          label={t('ai_providers.gemini_base_url_placeholder')}
          placeholder={t('ai_providers.gemini_base_url_placeholder')}
          value={geminiForm.baseUrl ?? ''}
          onChange={(e) => setGeminiForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
        />
        <HeaderInputList
          entries={headersToEntries(geminiForm.headers as any)}
          onChange={(entries) => setGeminiForm((prev) => ({ ...prev, headers: buildHeaderObject(entries) }))}
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
            <Button onClick={() => saveProvider(modal?.type as 'codex' | 'claude')} loading={saving}>
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
          onChange={(entries) => setProviderForm((prev) => ({ ...prev, headers: buildHeaderObject(entries) }))}
          addLabel={t('common.custom_headers_add')}
          keyPlaceholder={t('common.custom_headers_key_placeholder')}
          valuePlaceholder={t('common.custom_headers_value_placeholder')}
        />
        <div className="form-group">
          <label>{t('ai_providers.claude_models_label')}</label>
          <ModelInputList
            entries={providerForm.modelEntries}
            onChange={(entries) => setProviderForm((prev) => ({ ...prev, modelEntries: entries }))}
            addLabel={t('ai_providers.claude_models_add_btn')}
            namePlaceholder={t('common.model_name_placeholder')}
            aliasPlaceholder={t('common.model_alias_placeholder')}
            disabled={saving}
          />
        </div>
      </Modal>

      {/* OpenAI Modal */}
      <Modal
        open={modal?.type === 'openai'}
        onClose={closeModal}
        title={
          modal?.index !== null ? t('ai_providers.openai_edit_modal_title') : t('ai_providers.openai_add_modal_title')
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
        <Input
          label={t('ai_providers.openai_test_model_placeholder')}
          value={openaiForm.testModel ?? ''}
          onChange={(e) => setOpenaiForm((prev) => ({ ...prev, testModel: e.target.value }))}
        />

        <HeaderInputList
          entries={openaiForm.headers}
          onChange={(entries) => setOpenaiForm((prev) => ({ ...prev, headers: entries }))}
          addLabel={t('common.custom_headers_add')}
          keyPlaceholder={t('common.custom_headers_key_placeholder')}
          valuePlaceholder={t('common.custom_headers_value_placeholder')}
        />

        <div className="form-group">
          <label>{t('ai_providers.openai_models_fetch_title')}</label>
          <ModelInputList
            entries={openaiForm.modelEntries}
            onChange={(entries) => setOpenaiForm((prev) => ({ ...prev, modelEntries: entries }))}
            addLabel={t('ai_providers.openai_models_add_btn')}
            namePlaceholder={t('common.model_name_placeholder')}
            aliasPlaceholder={t('common.model_alias_placeholder')}
            disabled={saving}
          />
        </div>

        <div className="form-group">
          <label>{t('ai_providers.openai_add_modal_keys_label')}</label>
          {renderKeyEntries(openaiForm.apiKeyEntries)}
        </div>
      </Modal>
    </div>
  );
}
