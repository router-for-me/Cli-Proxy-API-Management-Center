import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconDownload, IconTrash2, IconRefreshCw } from '@/components/ui/icons';
import { backupApi, type BackupConfig, type BackupInfo } from '@/services/api';
import { useNotificationStore } from '@/stores';
import { formatBytes, formatDateTimeValue } from '@/utils/format';
import styles from './BackupPage.module.scss';

export function BackupPage() {
  const { t, i18n } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();

  const [config, setConfig] = useState<BackupConfig | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const data = await backupApi.getConfig();
      setConfig(data);
    } catch (error) {
      showNotification(t('backup.load_config_error'), 'error');
      console.error('Failed to load backup config:', error);
    }
  }, [showNotification, t]);

  const loadBackups = useCallback(async () => {
    try {
      const data = await backupApi.listBackups();
      setBackups(data);
    } catch (error) {
      showNotification(t('backup.load_backups_error'), 'error');
      console.error('Failed to load backups:', error);
    }
  }, [showNotification, t]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadConfig(), loadBackups()]);
    } finally {
      setLoading(false);
    }
  }, [loadConfig, loadBackups]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveConfig = async () => {
    if (!config) return;

    setSaving(true);
    try {
      await backupApi.updateConfig(config);
      showNotification(t('backup.config_saved'), 'success');
    } catch (error) {
      showNotification(t('backup.save_config_error'), 'error');
      console.error('Failed to save backup config:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const result = await backupApi.testConnection();
      showNotification(result.message || t('backup.connection_success'), 'success');
    } catch (error: any) {
      const message = error?.response?.data?.message || error?.message || t('backup.connection_error');
      showNotification(message, 'error');
    } finally {
      setTesting(false);
    }
  };

  const handleCreateBackup = async () => {
    setCreating(true);
    try {
      if (config?.storage === 'local' || !config?.storage) {
        // Create and download directly
        const blob = await backupApi.downloadNewBackup();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showNotification(t('backup.backup_downloaded'), 'success');
      } else {
        // Upload to remote storage
        await backupApi.createBackup();
        showNotification(t('backup.backup_created'), 'success');
        await loadBackups();
      }
    } catch (error) {
      showNotification(t('backup.create_backup_error'), 'error');
      console.error('Failed to create backup:', error);
    } finally {
      setCreating(false);
    }
  };

  const handleDownloadBackup = async (backup: BackupInfo) => {
    try {
      const blob = await backupApi.downloadBackup(backup.name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backup.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showNotification(t('backup.backup_downloaded'), 'success');
    } catch (error) {
      showNotification(t('backup.download_backup_error'), 'error');
      console.error('Failed to download backup:', error);
    }
  };

  const handleDeleteBackup = async (backup: BackupInfo) => {
    const confirmed = await new Promise<boolean>((resolve) => {
      showConfirmation({
        title: t('backup.delete_backup_title'),
        message: t('backup.delete_backup_message', { name: backup.name }),
        confirmText: t('common.delete'),
        cancelText: t('common.cancel'),
        variant: 'danger',
        onConfirm: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });

    if (!confirmed) return;

    try {
      await backupApi.deleteBackup(backup.name);
      showNotification(t('backup.backup_deleted'), 'success');
      await loadBackups();
    } catch (error) {
      showNotification(t('backup.delete_backup_error'), 'error');
      console.error('Failed to delete backup:', error);
    }
  };

  const handleRefreshBackups = async () => {
    setRefreshing(true);
    try {
      await loadBackups();
      showNotification(t('backup.backups_refreshed'), 'success');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <LoadingSpinner />
      </div>
    );
  }

  if (!config) {
    return (
      <div className={styles.error}>
        <EmptyState title={t('backup.config_not_available')} />
      </div>
    );
  }

  return (
    <div className={styles.backupPage}>
      <div className={styles.header}>
        <h1>{t('backup.title')}</h1>
        <p className={styles.description}>{t('backup.description')}</p>
      </div>

      {/* Configuration Section */}
      <Card title={t('backup.configuration')} className={styles.configCard}>
        <div className={styles.configForm}>
          <div className={styles.formRow}>
            <label>{t('backup.enabled')}</label>
            <ToggleSwitch
              checked={config.enabled}
              onChange={(checked) => setConfig({ ...config, enabled: checked })}
            />
          </div>

          <div className={styles.formRow}>
            <label>{t('backup.storage_type')}</label>
            <Select
              value={config.storage}
              onChange={(value) => setConfig({ ...config, storage: value as any })}
              options={[
                { value: 'local', label: t('backup.storage_local') },
                { value: 's3', label: t('backup.storage_s3') },
                { value: 'webdav', label: t('backup.storage_webdav') },
              ]}
            />
          </div>

          <div className={styles.formRow}>
            <label>{t('backup.schedule')}</label>
            <Select
              value={config.schedule}
              onChange={(value) => setConfig({ ...config, schedule: value })}
              options={[
                { value: '', label: t('backup.schedule_manual') },
                { value: '@hourly', label: t('backup.schedule_hourly') },
                { value: '@daily', label: t('backup.schedule_daily') },
                { value: '@weekly', label: t('backup.schedule_weekly') },
                { value: '@monthly', label: t('backup.schedule_monthly') },
              ]}
            />
          </div>

          <div className={styles.formRow}>
            <label>{t('backup.max_backups')}</label>
            <Input
              type="number"
              min="0"
              value={config['max-backups'].toString()}
              onChange={(e) =>
                setConfig({ ...config, 'max-backups': parseInt(e.target.value) || 0 })
              }
              placeholder="0 = unlimited"
            />
          </div>

          {config.storage === 'local' && (
            <div className={styles.formRow}>
              <label>{t('backup.local_dir')}</label>
              <Input
                value={config['local-dir']}
                onChange={(e) => setConfig({ ...config, 'local-dir': e.target.value })}
                placeholder="./backups"
              />
            </div>
          )}

          {config.storage === 's3' && (
            <div className={styles.storageConfig}>
              <h3>{t('backup.s3_config')}</h3>
              <div className={styles.formRow}>
                <label>{t('backup.s3_endpoint')}</label>
                <Input
                  value={config.s3.endpoint}
                  onChange={(e) =>
                    setConfig({ ...config, s3: { ...config.s3, endpoint: e.target.value } })
                  }
                  placeholder="s3.amazonaws.com"
                />
              </div>
              <div className={styles.formRow}>
                <label>{t('backup.s3_region')}</label>
                <Input
                  value={config.s3.region}
                  onChange={(e) =>
                    setConfig({ ...config, s3: { ...config.s3, region: e.target.value } })
                  }
                  placeholder="us-east-1"
                />
              </div>
              <div className={styles.formRow}>
                <label>{t('backup.s3_bucket')}</label>
                <Input
                  value={config.s3.bucket}
                  onChange={(e) =>
                    setConfig({ ...config, s3: { ...config.s3, bucket: e.target.value } })
                  }
                  placeholder="my-backups"
                />
              </div>
              <div className={styles.formRow}>
                <label>{t('backup.s3_path')}</label>
                <Input
                  value={config.s3.path}
                  onChange={(e) =>
                    setConfig({ ...config, s3: { ...config.s3, path: e.target.value } })
                  }
                  placeholder="backups/"
                />
              </div>
              <div className={styles.formRow}>
                <label>{t('backup.s3_access_key')}</label>
                <Input
                  value={config.s3['access-key']}
                  onChange={(e) =>
                    setConfig({ ...config, s3: { ...config.s3, 'access-key': e.target.value } })
                  }
                  placeholder="Access Key ID"
                />
              </div>
              <div className={styles.formRow}>
                <label>{t('backup.s3_secret_key')}</label>
                <Input
                  type="password"
                  value={config.s3['secret-key']}
                  onChange={(e) =>
                    setConfig({ ...config, s3: { ...config.s3, 'secret-key': e.target.value } })
                  }
                  placeholder="Secret Access Key"
                />
              </div>
              <div className={styles.formRow}>
                <label>{t('backup.s3_use_ssl')}</label>
                <ToggleSwitch
                  checked={config.s3['use-ssl']}
                  onChange={(checked) =>
                    setConfig({ ...config, s3: { ...config.s3, 'use-ssl': checked } })
                  }
                />
              </div>
            </div>
          )}

          {config.storage === 'webdav' && (
            <div className={styles.storageConfig}>
              <h3>{t('backup.webdav_config')}</h3>
              <div className={styles.formRow}>
                <label>{t('backup.webdav_url')}</label>
                <Input
                  value={config.webdav.url}
                  onChange={(e) =>
                    setConfig({ ...config, webdav: { ...config.webdav, url: e.target.value } })
                  }
                  placeholder="https://webdav.example.com"
                />
              </div>
              <div className={styles.formRow}>
                <label>{t('backup.webdav_username')}</label>
                <Input
                  value={config.webdav.username}
                  onChange={(e) =>
                    setConfig({ ...config, webdav: { ...config.webdav, username: e.target.value } })
                  }
                  placeholder="Username"
                />
              </div>
              <div className={styles.formRow}>
                <label>{t('backup.webdav_password')}</label>
                <Input
                  type="password"
                  value={config.webdav.password}
                  onChange={(e) =>
                    setConfig({ ...config, webdav: { ...config.webdav, password: e.target.value } })
                  }
                  placeholder="Password"
                />
              </div>
              <div className={styles.formRow}>
                <label>{t('backup.webdav_path')}</label>
                <Input
                  value={config.webdav.path}
                  onChange={(e) =>
                    setConfig({ ...config, webdav: { ...config.webdav, path: e.target.value } })
                  }
                  placeholder="backups/"
                />
              </div>
            </div>
          )}

          <div className={styles.formActions}>
            <Button onClick={handleSaveConfig} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
            {config.storage !== 'local' && (
              <Button onClick={handleTestConnection} disabled={testing} variant="secondary">
                {testing ? t('backup.testing') : t('backup.test_connection')}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Backups List Section */}
      <Card
        title={t('backup.backups_list')}
        extra={
          <div className={styles.listActions}>
            <Button onClick={handleCreateBackup} disabled={creating}>
              {creating ? t('backup.creating') : t('backup.create_backup')}
            </Button>
            <Button
              onClick={handleRefreshBackups}
              disabled={refreshing}
              variant="secondary"
            >
              <IconRefreshCw />
            </Button>
          </div>
        }
        className={styles.backupsCard}
      >
        {backups.length === 0 ? (
          <EmptyState title={t('backup.no_backups')} />
        ) : (
          <div className={styles.backupsList}>
            {backups.map((backup) => (
              <div key={backup.name} className={styles.backupItem}>
                <div className={styles.backupInfo}>
                  <div className={styles.backupName}>{backup.name}</div>
                  <div className={styles.backupMeta}>
                    <span>{formatDateTimeValue(backup.timestamp, i18n.language)}</span>
                    <span>{formatBytes(backup.size)}</span>
                    {backup.storage && <span className={styles.storage}>{backup.storage}</span>}
                  </div>
                </div>
                <div className={styles.backupActions}>
                  <Button
                    onClick={() => handleDownloadBackup(backup)}
                    variant="secondary"
                  >
                    <IconDownload />
                  </Button>
                  <Button
                    onClick={() => handleDeleteBackup(backup)}
                    variant="danger"
                  >
                    <IconTrash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
