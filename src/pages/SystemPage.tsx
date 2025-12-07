import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { modelsApi } from '@/services/api/models';
import { classifyModels, type ModelInfo } from '@/utils/models';

export function SystemPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const auth = useAuthStore();
  const configStore = useConfigStore();

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState('');

  const openaiProviders = configStore.config?.openaiCompatibility || [];
  const primaryProvider = openaiProviders[0];
  const primaryKey = primaryProvider?.apiKeyEntries?.[0]?.apiKey;

  const groupedModels = useMemo(() => classifyModels(models, { otherLabel: 'Other' }), [models]);

  const fetchModels = async () => {
    if (!primaryProvider?.baseUrl) {
      showNotification('No OpenAI provider configured for model fetch', 'warning');
      return;
    }
    setLoadingModels(true);
    setError('');
    try {
      const list = await modelsApi.fetchModels(primaryProvider.baseUrl, primaryKey);
      setModels(list);
    } catch (err: any) {
      setError(err?.message || t('notification.refresh_failed'));
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    configStore.fetchConfig().catch(() => {
      // ignore
    });
  }, []);

  return (
    <div className="stack">
      <Card
        title={t('nav.system_info')}
        extra={
          <Button variant="secondary" size="sm" onClick={() => configStore.fetchConfig(undefined, true)}>
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
        title="Models"
        extra={
          <Button variant="secondary" size="sm" onClick={fetchModels} loading={loadingModels}>
            {t('common.refresh')}
          </Button>
        }
      >
        {error && <div className="error-box">{error}</div>}
        {loadingModels ? (
          <div className="hint">{t('common.loading')}</div>
        ) : models.length === 0 ? (
          <div className="hint">{t('usage_stats.no_data')}</div>
        ) : (
          <div className="item-list">
            {groupedModels.map((group) => (
              <div key={group.id} className="item-row">
                <div className="item-meta">
                  <div className="item-title">
                    {group.label} ({group.items.length})
                  </div>
                  <div className="item-subtitle">
                    {group.items.map((model) => model.name).slice(0, 5).join(', ')}
                    {group.items.length > 5 ? '…' : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
