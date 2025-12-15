import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { configApi } from '@/services/api';
import type { Config } from '@/types';
import styles from './Settings/Settings.module.scss';

type PendingKey =
  | 'debug'
  | 'proxy'
  | 'retry'
  | 'switchProject'
  | 'switchPreview'
  | 'usage'
  | 'requestLog'
  | 'loggingToFile'
  | 'wsAuth';

export function SettingsPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);

  const [loading, setLoading] = useState(true);
  const [proxyValue, setProxyValue] = useState('');
  const [retryValue, setRetryValue] = useState(0);
  const [pending, setPending] = useState<Record<PendingKey, boolean>>({} as Record<PendingKey, boolean>);
  const [error, setError] = useState('');

  const disableControls = connectionStatus !== 'connected';

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const data = (await fetchConfig()) as Config;
        setProxyValue(data?.proxyUrl ?? '');
        setRetryValue(typeof data?.requestRetry === 'number' ? data.requestRetry : 0);
      } catch (err: any) {
        setError(err?.message || t('notification.refresh_failed'));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [fetchConfig, t]);

  useEffect(() => {
    if (config) {
      setProxyValue(config.proxyUrl ?? '');
      if (typeof config.requestRetry === 'number') {
        setRetryValue(config.requestRetry);
      }
    }
  }, [config?.proxyUrl, config?.requestRetry]);

  const setPendingFlag = (key: PendingKey, value: boolean) => {
    setPending((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSetting = async (
    section: PendingKey,
    rawKey: 'debug' | 'usage-statistics-enabled' | 'request-log' | 'logging-to-file' | 'ws-auth',
    value: boolean,
    updater: (val: boolean) => Promise<any>,
    successMessage: string
  ) => {
    const previous = (() => {
      switch (rawKey) {
        case 'debug':
          return config?.debug ?? false;
        case 'usage-statistics-enabled':
          return config?.usageStatisticsEnabled ?? false;
        case 'request-log':
          return config?.requestLog ?? false;
        case 'logging-to-file':
          return config?.loggingToFile ?? false;
        case 'ws-auth':
          return config?.wsAuth ?? false;
        default:
          return false;
      }
    })();

    setPendingFlag(section, true);
    updateConfigValue(rawKey, value);

    try {
      await updater(value);
      clearCache(rawKey);
      showNotification(successMessage, 'success');
    } catch (err: any) {
      updateConfigValue(rawKey, previous);
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag(section, false);
    }
  };

  const handleProxyUpdate = async () => {
    const previous = config?.proxyUrl ?? '';
    setPendingFlag('proxy', true);
    updateConfigValue('proxy-url', proxyValue);
    try {
      await configApi.updateProxyUrl(proxyValue.trim());
      clearCache('proxy-url');
      showNotification(t('notification.proxy_updated'), 'success');
    } catch (err: any) {
      setProxyValue(previous);
      updateConfigValue('proxy-url', previous);
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag('proxy', false);
    }
  };

  const handleProxyClear = async () => {
    const previous = config?.proxyUrl ?? '';
    setPendingFlag('proxy', true);
    updateConfigValue('proxy-url', '');
    try {
      await configApi.clearProxyUrl();
      clearCache('proxy-url');
      setProxyValue('');
      showNotification(t('notification.proxy_cleared'), 'success');
    } catch (err: any) {
      setProxyValue(previous);
      updateConfigValue('proxy-url', previous);
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag('proxy', false);
    }
  };

  const handleRetryUpdate = async () => {
    const previous = config?.requestRetry ?? 0;
    const parsed = Number(retryValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      showNotification(t('login.error_invalid'), 'error');
      setRetryValue(previous);
      return;
    }
    setPendingFlag('retry', true);
    updateConfigValue('request-retry', parsed);
    try {
      await configApi.updateRequestRetry(parsed);
      clearCache('request-retry');
      showNotification(t('notification.retry_updated'), 'success');
    } catch (err: any) {
      setRetryValue(previous);
      updateConfigValue('request-retry', previous);
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag('retry', false);
    }
  };

  const quotaSwitchProject = config?.quotaExceeded?.switchProject ?? false;
  const quotaSwitchPreview = config?.quotaExceeded?.switchPreviewModel ?? false;

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('basic_settings.title')}</h1>

      <div className={styles.grid}>
        <Card>
        {error && <div className="error-box">{error}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ToggleSwitch
            label={t('basic_settings.debug_enable')}
            checked={config?.debug ?? false}
            disabled={disableControls || pending.debug || loading}
            onChange={(value) =>
              toggleSetting('debug', 'debug', value, configApi.updateDebug, t('notification.debug_updated'))
            }
          />

          <ToggleSwitch
            label={t('basic_settings.usage_statistics_enable')}
            checked={config?.usageStatisticsEnabled ?? false}
            disabled={disableControls || pending.usage || loading}
            onChange={(value) =>
              toggleSetting(
                'usage',
                'usage-statistics-enabled',
                value,
                configApi.updateUsageStatistics,
                t('notification.usage_statistics_updated')
              )
            }
          />

          <ToggleSwitch
            label={t('basic_settings.request_log_enable')}
            checked={config?.requestLog ?? false}
            disabled={disableControls || pending.requestLog || loading}
            onChange={(value) =>
              toggleSetting(
                'requestLog',
                'request-log',
                value,
                configApi.updateRequestLog,
                t('notification.request_log_updated')
              )
            }
          />

          <ToggleSwitch
            label={t('basic_settings.logging_to_file_enable')}
            checked={config?.loggingToFile ?? false}
            disabled={disableControls || pending.loggingToFile || loading}
            onChange={(value) =>
              toggleSetting(
                'loggingToFile',
                'logging-to-file',
                value,
                configApi.updateLoggingToFile,
                t('notification.logging_to_file_updated')
              )
            }
          />

          <ToggleSwitch
            label={t('basic_settings.ws_auth_enable')}
            checked={config?.wsAuth ?? false}
            disabled={disableControls || pending.wsAuth || loading}
            onChange={(value) =>
              toggleSetting(
                'wsAuth',
                'ws-auth',
                value,
                configApi.updateWsAuth,
                t('notification.ws_auth_updated')
              )
            }
          />
        </div>
      </Card>

      <Card title={t('basic_settings.proxy_title')}>
        <Input
          label={t('basic_settings.proxy_url_label')}
          placeholder={t('basic_settings.proxy_url_placeholder')}
          value={proxyValue}
          onChange={(e) => setProxyValue(e.target.value)}
          disabled={disableControls || loading}
        />
        <div style={{ display: 'flex', gap: 12 }}>
          <Button variant="secondary" onClick={handleProxyClear} disabled={disableControls || pending.proxy || loading}>
            {t('basic_settings.proxy_clear')}
          </Button>
          <Button onClick={handleProxyUpdate} loading={pending.proxy} disabled={disableControls || loading}>
            {t('basic_settings.proxy_update')}
          </Button>
        </div>
      </Card>

      <Card title={t('basic_settings.retry_title')}>
        <div className={styles.retryRow}>
          <Input
            label={t('basic_settings.retry_count_label')}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={retryValue}
            onChange={(e) => setRetryValue(Number(e.target.value))}
            disabled={disableControls || loading}
            className={styles.retryInput}
          />
          <Button
            className={styles.retryButton}
            onClick={handleRetryUpdate}
            loading={pending.retry}
            disabled={disableControls || loading}
          >
            {t('basic_settings.retry_update')}
          </Button>
        </div>
      </Card>

      <Card title={t('basic_settings.quota_title')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ToggleSwitch
            label={t('basic_settings.quota_switch_project')}
            checked={quotaSwitchProject}
            disabled={disableControls || pending.switchProject || loading}
            onChange={(value) =>
              (async () => {
                const previous = config?.quotaExceeded?.switchProject ?? false;
                const nextQuota = { ...(config?.quotaExceeded || {}), switchProject: value };
                setPendingFlag('switchProject', true);
                updateConfigValue('quota-exceeded', nextQuota);
                try {
                  await configApi.updateSwitchProject(value);
                  clearCache('quota-exceeded');
                  showNotification(t('notification.quota_switch_project_updated'), 'success');
                } catch (err: any) {
                  updateConfigValue('quota-exceeded', { ...(config?.quotaExceeded || {}), switchProject: previous });
                  showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
                } finally {
                  setPendingFlag('switchProject', false);
                }
              })()
            }
          />
          <ToggleSwitch
            label={t('basic_settings.quota_switch_preview')}
            checked={quotaSwitchPreview}
            disabled={disableControls || pending.switchPreview || loading}
            onChange={(value) =>
              (async () => {
                const previous = config?.quotaExceeded?.switchPreviewModel ?? false;
                const nextQuota = { ...(config?.quotaExceeded || {}), switchPreviewModel: value };
                setPendingFlag('switchPreview', true);
                updateConfigValue('quota-exceeded', nextQuota);
                try {
                  await configApi.updateSwitchPreviewModel(value);
                  clearCache('quota-exceeded');
                  showNotification(t('notification.quota_switch_preview_updated'), 'success');
                } catch (err: any) {
                  updateConfigValue('quota-exceeded', { ...(config?.quotaExceeded || {}), switchPreviewModel: previous });
                  showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
                } finally {
                  setPendingFlag('switchPreview', false);
                }
              })()
            }
          />
        </div>
      </Card>
      </div>
    </div>
  );
}
