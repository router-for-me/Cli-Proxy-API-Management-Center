import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useNotificationStore, useAuthStore } from '@/stores';
import { configFileApi } from '@/services/api/configFile';

export function ConfigPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  const disableControls = connectionStatus !== 'connected';

  const loadConfig = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await configFileApi.fetchConfigYaml();
      setContent(data);
      setDirty(false);
    } catch (err: any) {
      setError(err?.message || t('notification.refresh_failed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await configFileApi.saveConfigYaml(content);
      setDirty(false);
      showNotification(t('notification.saved_success'), 'success');
    } catch (err: any) {
      showNotification(`${t('notification.save_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={t('nav.config_management')}
      extra={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" size="sm" onClick={loadConfig} disabled={loading}>
            {t('common.refresh')}
          </Button>
          <Button size="sm" onClick={handleSave} loading={saving} disabled={disableControls || loading || !dirty}>
            {t('common.save')}
          </Button>
        </div>
      }
    >
      {error && <div className="error-box">{error}</div>}
      <div className="form-group">
        <label>{t('nav.config_management')}</label>
        <textarea
          className="input"
          rows={20}
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            setDirty(true);
          }}
          disabled={disableControls}
          placeholder="config.yaml"
        />
        <div className="hint">
          {dirty ? t('system_info.version_current_missing') : loading ? t('common.loading') : t('system_info.version_is_latest')}
        </div>
      </div>
    </Card>
  );
}
