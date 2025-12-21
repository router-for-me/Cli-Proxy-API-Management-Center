import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  IconKey,
  IconBot,
  IconFileText,
  IconChartLine,
  IconSettings,
  IconShield,
  IconScrollText,
  IconInfo
} from '@/components/ui/icons';
import { useAuthStore, useConfigStore } from '@/stores';
import { apiKeysApi, providersApi, authFilesApi, usageApi } from '@/services/api';
import { collectUsageDetails, extractTotalTokens, calculateRecentPerMinuteRates, formatCompactNumber } from '@/utils/usage';
import styles from './DashboardPage.module.scss';

interface QuickStat {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  path: string;
  loading?: boolean;
  sublabel?: string;
}

interface ProviderStats {
  gemini: number | null;
  codex: number | null;
  claude: number | null;
  openai: number | null;
}

interface UsageStats {
  totalRequests: number;
  totalTokens: number;
  rpm: number;
  tpm: number;
  modelsUsed: number;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const apiBase = useAuthStore((state) => state.apiBase);
  const config = useConfigStore((state) => state.config);

  const [stats, setStats] = useState<{
    apiKeys: number | null;
    authFiles: number | null;
  }>({
    apiKeys: null,
    authFiles: null
  });

  const [providerStats, setProviderStats] = useState<ProviderStats>({
    gemini: null,
    codex: null,
    claude: null,
    openai: null
  });

  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [usageLoading, setUsageLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        const [keysRes, filesRes, geminiRes, codexRes, claudeRes, openaiRes] = await Promise.allSettled([
          apiKeysApi.list(),
          authFilesApi.list(),
          providersApi.getGeminiKeys(),
          providersApi.getCodexConfigs(),
          providersApi.getClaudeConfigs(),
          providersApi.getOpenAIProviders()
        ]);

        setStats({
          apiKeys: keysRes.status === 'fulfilled' ? keysRes.value.length : null,
          authFiles: filesRes.status === 'fulfilled' ? filesRes.value.files.length : null
        });

        setProviderStats({
          gemini: geminiRes.status === 'fulfilled' ? geminiRes.value.length : null,
          codex: codexRes.status === 'fulfilled' ? codexRes.value.length : null,
          claude: claudeRes.status === 'fulfilled' ? claudeRes.value.length : null,
          openai: openaiRes.status === 'fulfilled' ? openaiRes.value.length : null
        });
      } finally {
        setLoading(false);
      }
    };

    const fetchUsage = async () => {
      if (!config?.usageStatisticsEnabled) {
        setUsageLoading(false);
        return;
      }
      setUsageLoading(true);
      try {
        const response = await usageApi.getUsage();
        const usageData = response?.usage ?? response;

        if (usageData) {
          const details = collectUsageDetails(usageData);
          const totalRequests = details.length;
          const totalTokens = details.reduce((sum, d) => sum + extractTotalTokens(d), 0);
          const rateStats = calculateRecentPerMinuteRates(30, usageData);

          // Count unique models
          const modelSet = new Set<string>();
          details.forEach(d => {
            if (d.__modelName) modelSet.add(d.__modelName);
          });

          setUsageStats({
            totalRequests,
            totalTokens,
            rpm: rateStats.rpm,
            tpm: rateStats.tpm,
            modelsUsed: modelSet.size
          });
        }
      } catch {
        // Ignore usage fetch errors
      } finally {
        setUsageLoading(false);
      }
    };

    if (connectionStatus === 'connected') {
      fetchStats();
      fetchUsage();
    }
  }, [connectionStatus, config?.usageStatisticsEnabled]);

  // Calculate total provider keys
  const totalProviderKeys =
    (providerStats.gemini ?? 0) +
    (providerStats.codex ?? 0) +
    (providerStats.claude ?? 0) +
    (providerStats.openai ?? 0);

  const quickStats: QuickStat[] = [
    {
      label: t('nav.api_keys'),
      value: stats.apiKeys ?? '-',
      icon: <IconKey size={24} />,
      path: '/api-keys',
      loading: loading && stats.apiKeys === null,
      sublabel: t('dashboard.management_keys')
    },
    {
      label: t('nav.ai_providers'),
      value: loading ? '-' : totalProviderKeys,
      icon: <IconBot size={24} />,
      path: '/ai-providers',
      loading: loading,
      sublabel: t('dashboard.provider_keys_detail', {
        gemini: providerStats.gemini ?? 0,
        codex: providerStats.codex ?? 0,
        claude: providerStats.claude ?? 0,
        openai: providerStats.openai ?? 0
      })
    },
    {
      label: t('nav.auth_files'),
      value: stats.authFiles ?? '-',
      icon: <IconFileText size={24} />,
      path: '/auth-files',
      loading: loading && stats.authFiles === null,
      sublabel: t('dashboard.oauth_credentials')
    }
  ];

  const quickActions = [
    { label: t('nav.basic_settings'), icon: <IconSettings size={18} />, path: '/settings' },
    { label: t('nav.ai_providers'), icon: <IconBot size={18} />, path: '/ai-providers' },
    { label: t('nav.oauth'), icon: <IconShield size={18} />, path: '/oauth' },
    { label: t('nav.usage_stats'), icon: <IconChartLine size={18} />, path: '/usage' },
    ...(config?.loggingToFile ? [{ label: t('nav.logs'), icon: <IconScrollText size={18} />, path: '/logs' }] : []),
    { label: t('nav.system_info'), icon: <IconInfo size={18} />, path: '/system' }
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
          {serverBuildDate && (
            <span className={styles.buildDate}>
              {new Date(serverBuildDate).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      <div className={styles.statsGrid}>
        {quickStats.map((stat) => (
          <Link key={stat.path} to={stat.path} className={styles.statCard}>
            <div className={styles.statIcon}>{stat.icon}</div>
            <div className={styles.statContent}>
              <span className={styles.statValue}>{stat.loading ? '...' : stat.value}</span>
              <span className={styles.statLabel}>{stat.label}</span>
              {stat.sublabel && !stat.loading && (
                <span className={styles.statSublabel}>{stat.sublabel}</span>
              )}
            </div>
          </Link>
        ))}
      </div>

      {config?.usageStatisticsEnabled && (
        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('dashboard.usage_overview')}</h2>
          {usageLoading ? (
            <div className={styles.usageLoading}>{t('common.loading')}</div>
          ) : usageStats ? (
            <div className={styles.usageGrid}>
              <div className={styles.usageCard}>
                <span className={styles.usageValue}>{formatCompactNumber(usageStats.totalRequests)}</span>
                <span className={styles.usageLabel}>{t('dashboard.total_requests')}</span>
              </div>
              <div className={styles.usageCard}>
                <span className={styles.usageValue}>{formatCompactNumber(usageStats.totalTokens)}</span>
                <span className={styles.usageLabel}>{t('dashboard.total_tokens')}</span>
              </div>
              <div className={styles.usageCard}>
                <span className={styles.usageValue}>{usageStats.rpm.toFixed(1)}</span>
                <span className={styles.usageLabel}>{t('dashboard.rpm_30min')}</span>
              </div>
              <div className={styles.usageCard}>
                <span className={styles.usageValue}>{formatCompactNumber(usageStats.tpm)}</span>
                <span className={styles.usageLabel}>{t('dashboard.tpm_30min')}</span>
              </div>
              <div className={styles.usageCard}>
                <span className={styles.usageValue}>{usageStats.modelsUsed}</span>
                <span className={styles.usageLabel}>{t('dashboard.models_used')}</span>
              </div>
            </div>
          ) : (
            <div className={styles.usageEmpty}>{t('dashboard.no_usage_data')}</div>
          )}
          <Link to="/usage" className={styles.viewMoreLink}>
            {t('dashboard.view_detailed_usage')} →
          </Link>
        </div>
      )}

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
              <span className={styles.configLabel}>{t('basic_settings.request_log_enable')}</span>
              <span className={`${styles.configValue} ${config.requestLog ? styles.enabled : styles.disabled}`}>
                {config.requestLog ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configItem}>
              <span className={styles.configLabel}>{t('basic_settings.retry_count_label')}</span>
              <span className={styles.configValue}>{config.requestRetry ?? 0}</span>
            </div>
            <div className={styles.configItem}>
              <span className={styles.configLabel}>{t('basic_settings.ws_auth_enable')}</span>
              <span className={`${styles.configValue} ${config.wsAuth ? styles.enabled : styles.disabled}`}>
                {config.wsAuth ? t('common.yes') : t('common.no')}
              </span>
            </div>
            {config.proxyUrl && (
              <div className={`${styles.configItem} ${styles.configItemFull}`}>
                <span className={styles.configLabel}>{t('basic_settings.proxy_url_label')}</span>
                <span className={styles.configValueMono}>{config.proxyUrl}</span>
              </div>
            )}
          </div>
          <Link to="/settings" className={styles.viewMoreLink}>
            {t('dashboard.edit_settings')} →
          </Link>
        </div>
      )}
    </div>
  );
}
