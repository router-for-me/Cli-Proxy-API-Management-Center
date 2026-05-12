import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useNotificationStore } from '@/stores';
import { webdavClient } from '../client/webdavClient';
import { useWebdavStore } from '../store/useWebdavStore';
import { normalizeServerUrl, normalizeDavPath } from '../utils';
import styles from '../backup.module.scss';

export function WebdavConnectionCard() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();

  const connection = useWebdavStore((s) => s.connection);
  const connectionStatus = useWebdavStore((s) => s.connectionStatus);
  const setConnection = useWebdavStore((s) => s.setConnection);
  const setConnectionStatus = useWebdavStore((s) => s.setConnectionStatus);

  const [localConfig, setLocalConfig] = useState(connection);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setLocalConfig(connection);
  }, [connection]);

  const handleChange = useCallback(
    (field: string, value: string) => {
      setLocalConfig((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleTest = useCallback(async () => {
    setTesting(true);
    setConnectionStatus('testing');
    try {
      const normalized = {
        ...localConfig,
        serverUrl: normalizeServerUrl(localConfig.serverUrl),
        basePath: normalizeDavPath(localConfig.basePath),
      };
      await webdavClient.testConnection(normalized);
      setConnectionStatus('connected');
      showNotification(t('backup.connection_success'), 'success');
    } catch (err) {
      setConnectionStatus('error');
      const msg = err instanceof Error ? err.message : String(err);
      showNotification(`${t('backup.connection_failed')}: ${msg}`, 'error');
    } finally {
      setTesting(false);
    }
  }, [localConfig, setConnectionStatus, showNotification, t]);

  const handleSave = useCallback(() => {
    const normalized = {
      ...localConfig,
      serverUrl: normalizeServerUrl(localConfig.serverUrl),
      basePath: normalizeDavPath(localConfig.basePath),
    };
    setConnection(normalized);
    setLocalConfig(normalized);
    showNotification(t('backup.config_saved'), 'success');
  }, [localConfig, setConnection, showNotification, t]);

  const statusBadge =
    connectionStatus === 'connected'
      ? 'success'
      : connectionStatus === 'error'
        ? 'error'
        : connectionStatus === 'testing'
          ? 'warning'
          : 'muted';

  const statusText =
    connectionStatus === 'connected'
      ? t('backup.status_connected')
      : connectionStatus === 'error'
        ? t('backup.status_error')
        : connectionStatus === 'testing'
          ? t('backup.status_testing')
          : t('backup.status_idle');

  const titleNode = (
    <span className={styles.titleRow}>
      {t('backup.connection_title')}
      <span className={`status-badge ${statusBadge} ${styles.statusBadgeInline}`}>{statusText}</span>
    </span>
  );

  return (
    <Card title={titleNode}>
      <div className={`card-body ${styles.connForm} ${styles.stack}`}>
        <div className={styles.formGrid}>
          <Input
            label={t('backup.server_url')}
            placeholder="https://dav.example.com"
            value={localConfig.serverUrl}
            onChange={(e) => handleChange('serverUrl', e.target.value)}
          />
          <Input
            label={t('backup.base_path')}
            placeholder="/cpamc-backups/"
            value={localConfig.basePath}
            onChange={(e) => handleChange('basePath', e.target.value)}
          />
          <Input
            label={t('backup.username')}
            value={localConfig.username}
            onChange={(e) => handleChange('username', e.target.value)}
          />
          <Input
            label={t('backup.password')}
            type="password"
            value={localConfig.password}
            onChange={(e) => handleChange('password', e.target.value)}
          />
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={handleTest} loading={testing}>
            {t('backup.test_connection')}
          </Button>
          <Button variant="primary" onClick={handleSave}>
            {t('backup.save_config')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
