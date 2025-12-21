import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconKey, IconBot, IconFileText, IconChartLine, IconSettings, IconShield } from '@/components/ui/icons';
import { useAuthStore, useConfigStore } from '@/stores';
import { apiKeysApi, providersApi, authFilesApi } from '@/services/api';
import styles from './DashboardPage.module.scss';

interface QuickStat {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  path: string;
  loading?: boolean;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const apiBase = useAuthStore((state) => state.apiBase);
  const config = useConfigStore((state) => state.config);

  const [stats, setStats] = useState<{
    apiKeys: number | null;
    providers: number | null;
    authFiles: number | null;
  }>({
    apiKeys: null,
    providers: null,
    authFiles: null
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        const [keysRes, providersRes, filesRes] = await Promise.allSettled([
          apiKeysApi.list(),
          providersApi.getOpenAIProviders(),
          authFilesApi.list()
        ]);

        setStats({
          apiKeys: keysRes.status === 'fulfilled' ? keysRes.value.length : null,
          providers: providersRes.status === 'fulfilled' ? providersRes.value.length : null,
          authFiles: filesRes.status === 'fulfilled' ? filesRes.value.files.length : null
        });
      } finally {
        setLoading(false);
      }
    };

    if (connectionStatus === 'connected') {
      fetchStats();
    }
  }, [connectionStatus]);

  const quickStats: QuickStat[] = [
    {
      label: t('nav.api_keys'),
      value: stats.apiKeys ?? '-',
      icon: <IconKey size={24} />,
      path: '/api-keys',
      loading: loading && stats.apiKeys === null
    },
    {
      label: t('dashboard.openai_providers'),
      value: stats.providers ?? '-',
      icon: <IconBot size={24} />,
      path: '/ai-providers',
      loading: loading && stats.providers === null
    },
    {
      label: t('nav.auth_files'),
      value: stats.authFiles ?? '-',
      icon: <IconFileText size={24} />,
      path: '/auth-files',
      loading: loading && stats.authFiles === null
    }
  ];

  const quickActions = [
    { label: t('nav.basic_settings'), icon: <IconSettings size={18} />, path: '/settings' },
    { label: t('nav.ai_providers'), icon: <IconBot size={18} />, path: '/ai-providers' },
    { label: t('nav.oauth'), icon: <IconShield size={18} />, path: '/oauth' },
    { label: t('nav.usage_stats'), icon: <IconChartLine size={18} />, path: '/usage' }
  ];

  return (
    <div className={styles.dashboard}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t('dashboard.title')}</h1>
        <p className={styles.subtitle}>{t('dashboard.subtitle')}</p>
      </div>

      <div className={styles.connectionCard}>
        <div className={styles.connectionStatus}>
          <span
            className={`${styles.statusDot} ${
              connectionStatus === 'connected'
                ? styles.connected
                : connectionStatus === 'connecting'
                  ? styles.connecting
                  : styles.disconnected
            }`}
          />
          <span className={styles.statusText}>
            {t(
              connectionStatus === 'connected'
                ? 'common.connected'
                : connectionStatus === 'connecting'
                  ? 'common.connecting'
                  : 'common.disconnected'
            )}
          </span>
        </div>
        <div className={styles.connectionInfo}>
          <span className={styles.serverUrl}>{apiBase || '-'}</span>
          {serverVersion && <span className={styles.serverVersion}>v{serverVersion}</span>}
        </div>
      </div>

      <div className={styles.statsGrid}>
        {quickStats.map((stat) => (
          <Link key={stat.path} to={stat.path} className={styles.statCard}>
            <div className={styles.statIcon}>{stat.icon}</div>
            <div className={styles.statContent}>
              <span className={styles.statValue}>{stat.loading ? '...' : stat.value}</span>
              <span className={styles.statLabel}>{stat.label}</span>
            </div>
          </Link>
        ))}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>{t('dashboard.quick_actions')}</h2>
        <div className={styles.actionsGrid}>
          {quickActions.map((action) => (
            <Link key={action.path} to={action.path}>
              <Button variant="secondary" className={styles.actionButton}>
                {action.icon}
                {action.label}
              </Button>
            </Link>
          ))}
        </div>
      </div>

      {config && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('dashboard.current_config')}</h2>
          <div className={styles.configGrid}>
            <div className={styles.configItem}>
              <span className={styles.configLabel}>{t('basic_settings.debug_enable')}</span>
              <span className={`${styles.configValue} ${config.debug ? styles.enabled : styles.disabled}`}>
                {config.debug ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configItem}>
              <span className={styles.configLabel}>{t('basic_settings.usage_statistics_enable')}</span>
              <span className={`${styles.configValue} ${config.usageStatisticsEnabled ? styles.enabled : styles.disabled}`}>
                {config.usageStatisticsEnabled ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configItem}>
              <span className={styles.configLabel}>{t('basic_settings.logging_to_file_enable')}</span>
              <span className={`${styles.configValue} ${config.loggingToFile ? styles.enabled : styles.disabled}`}>
                {config.loggingToFile ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configItem}>
              <span className={styles.configLabel}>{t('basic_settings.retry_count_label')}</span>
              <span className={styles.configValue}>{config.requestRetry ?? 0}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
