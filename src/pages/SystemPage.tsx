import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { modelsApi } from '@/services/api/models';
import { apiKeysApi } from '@/services/api/apiKeys';
import { classifyModels, type ModelInfo } from '@/utils/models';
import styles from './SystemPage.module.scss';

export function SystemPage() {
  const { t, i18n } = useTranslation();
  const { showNotification } = useNotificationStore();
  const auth = useAuthStore();
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelStatus, setModelStatus] = useState<{ type: 'success' | 'warning' | 'error' | 'muted'; message: string }>();
  const [error, setError] = useState('');

  const apiKeysCache = useRef<string[]>([]);

  const otherLabel = useMemo(
    () => (i18n.language?.toLowerCase().startsWith('zh') ? '其他' : 'Other'),
    [i18n.language]
  );
  const groupedModels = useMemo(() => classifyModels(models, { otherLabel }), [models, otherLabel]);

  const normalizeApiKeyList = (input: any): string[] => {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const keys: string[] = [];

    input.forEach((item) => {
      const value = typeof item === 'string' ? item : item?.['api-key'] ?? item?.apiKey ?? '';
      const trimmed = String(value || '').trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      keys.push(trimmed);
    });

    return keys;
  };

  const resolveApiKeysForModels = useCallback(async () => {
    if (apiKeysCache.current.length) {
      return apiKeysCache.current;
    }

    const configKeys = normalizeApiKeyList(config?.apiKeys);
    if (configKeys.length) {
      apiKeysCache.current = configKeys;
      return configKeys;
    }

    try {
      const list = await apiKeysApi.list();
      const normalized = normalizeApiKeyList(list);
      if (normalized.length) {
        apiKeysCache.current = normalized;
      }
      return normalized;
    } catch (err) {
      console.warn('Auto loading API keys for models failed:', err);
      return [];
    }
  }, [config?.apiKeys]);

  const fetchModels = async ({ forceRefreshKeys = false }: { forceRefreshKeys?: boolean } = {}) => {
    if (auth.connectionStatus !== 'connected') {
      setModelStatus({
        type: 'warning',
        message: t('notification.connection_required')
      });
      setModels([]);
      return;
    }

    if (!auth.apiBase) {
      showNotification(t('notification.connection_required'), 'warning');
      return;
    }

    if (forceRefreshKeys) {
      apiKeysCache.current = [];
    }

    setLoadingModels(true);
    setError('');
    setModelStatus({ type: 'muted', message: t('system_info.models_loading') });
    try {
      const apiKeys = await resolveApiKeysForModels();
      const primaryKey = apiKeys[0];
      const list = await modelsApi.fetchModels(auth.apiBase, primaryKey);
      setModels(list);
      const hasModels = list.length > 0;
      setModelStatus({
        type: hasModels ? 'success' : 'warning',
        message: hasModels ? t('system_info.models_count', { count: list.length }) : t('system_info.models_empty')
      });
    } catch (err: any) {
      const message = `${t('system_info.models_error')}: ${err?.message || ''}`;
      setError(message);
      setModels([]);
      setModelStatus({ type: 'error', message });
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    fetchConfig().catch(() => {
      // ignore
    });
  }, [fetchConfig]);

  useEffect(() => {
    fetchModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.connectionStatus, auth.apiBase]);

  return (
    <div className="stack">
      <Card
        title={t('system_info.title')}
        extra={
          <Button variant="secondary" size="sm" onClick={() => fetchConfig(undefined, true)}>
            {t('common.refresh')}
          </Button>
        }
      >
        <div className="grid cols-2">
          <div className="stat-card">
            <div className="stat-label">{t('connection.server_address')}</div>
            <div className="stat-value">{auth.apiBase || '-'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{t('footer.api_version')}</div>
            <div className="stat-value">{auth.serverVersion || t('system_info.version_unknown')}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{t('footer.build_date')}</div>
            <div className="stat-value">
              {auth.serverBuildDate ? new Date(auth.serverBuildDate).toLocaleString() : t('system_info.version_unknown')}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">{t('connection.status')}</div>
            <div className="stat-value">{t(`common.${auth.connectionStatus}_status` as any)}</div>
          </div>
        </div>
      </Card>

      <Card
        title={t('system_info.models_title')}
        extra={
          <Button variant="secondary" size="sm" onClick={() => fetchModels({ forceRefreshKeys: true })} loading={loadingModels}>
            {t('common.refresh')}
          </Button>
        }
      >
        <p className={styles.sectionDescription}>{t('system_info.models_desc')}</p>
        {modelStatus && <div className={`status-badge ${modelStatus.type}`}>{modelStatus.message}</div>}
        {error && <div className="error-box">{error}</div>}
        {loadingModels ? (
          <div className="hint">{t('common.loading')}</div>
        ) : models.length === 0 ? (
          <div className="hint">{t('system_info.models_empty')}</div>
        ) : (
          <div className="item-list">
            {groupedModels.map((group) => (
              <div key={group.id} className="item-row">
                <div className="item-meta">
                  <div className="item-title">{group.label}</div>
                  <div className="item-subtitle">{t('system_info.models_count', { count: group.items.length })}</div>
                </div>
                <div className={styles.modelTags}>
                  {group.items.map((model) => (
                    <span
                      key={`${model.name}-${model.alias ?? 'default'}`}
                      className={styles.modelTag}
                      title={model.description || ''}
                    >
                      <span className={styles.modelName}>{model.name}</span>
                      {model.alias && <span className={styles.modelAlias}>{model.alias}</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
