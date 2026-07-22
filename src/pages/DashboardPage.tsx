import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconKey, IconBot, IconFileText, IconSatellite } from '@/components/ui/icons';
import { useAuthStore, useConfigStore, useModelsStore } from '@/stores';
import { authFilesApi } from '@/services/api';
import { useApiKeysForModels } from '@/hooks/useApiKeysForModels';
import { formatDateValue } from '@/utils/format';
import { getDashboardModelsStatValue } from '@/utils/dashboard';
import styles from './DashboardPage.module.scss';

interface QuickStat {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  path: string;
  loading?: boolean;
  sublabel?: string;
}

const PROVIDER_LABELS: Array<{ key: string; label: string }> = [
  { key: 'gemini', label: 'Gemini' },
  { key: 'codex', label: 'Codex' },
  { key: 'xai', label: 'xAI' },
  { key: 'claude', label: 'Claude' },
  { key: 'vertex', label: 'Vertex' },
  { key: 'openai', label: 'OpenAI' },
];

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const apiBase = useAuthStore((state) => state.apiBase);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const modelsError = useModelsStore((state) => state.error);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

  const [authFilesCount, setAuthFilesCount] = useState<number | null>(null);
  const [authFilesLoading, setAuthFilesLoading] = useState(false);

  const resolveApiKeysForModels = useApiKeysForModels();

  const fetchModels = useCallback(async () => {
    if (connectionStatus !== 'connected' || !apiBase) {
      return;
    }

    try {
      const apiKeys = await resolveApiKeysForModels();
      const primaryKey = apiKeys[0];
      await fetchModelsFromStore(apiBase, primaryKey);
    } catch {
      // Ignore model fetch errors on dashboard
    }
  }, [connectionStatus, apiBase, resolveApiKeysForModels, fetchModelsFromStore]);

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      return;
    }

    let cancelled = false;

    const loadAuthFiles = async () => {
      setAuthFilesLoading(true);
      try {
        const res = await authFilesApi.list();
        if (!cancelled) setAuthFilesCount(res.files.length);
      } catch {
        if (!cancelled) setAuthFilesCount(null);
      } finally {
        setAuthFilesLoading(false);
      }
    };

    // Provider/key counts come from the config store; ensure config is loaded and fetch auth files.
    fetchConfig().catch(() => undefined);
    fetchModels();
    void loadAuthFiles();

    return () => {
      cancelled = true;
    };
  }, [connectionStatus, fetchConfig, fetchModels]);

  const configLoading = !config;
  const providerStats: Record<string, number> | null = config
    ? {
        gemini: config.geminiApiKeys?.length ?? 0,
        codex: config.codexApiKeys?.length ?? 0,
        xai: config.xaiApiKeys?.length ?? 0,
        claude: config.claudeApiKeys?.length ?? 0,
        vertex: config.vertexApiKeys?.length ?? 0,
        openai: config.openaiCompatibility?.length ?? 0,
      }
    : null;
  const totalProviderKeys = providerStats
    ? Object.values(providerStats).reduce((sum, count) => sum + count, 0)
    : 0;
  const providerBreakdown = providerStats
    ? PROVIDER_LABELS.filter(({ key }) => (providerStats[key] ?? 0) > 0)
        .map(({ key, label }) => `${label} ${providerStats[key]}`)
        .join(' · ')
    : '';

  const quickStats: QuickStat[] = [
    {
      label: t('dashboard.management_keys'),
      value: config ? (config.apiKeys?.length ?? 0) : '—',
      icon: <IconKey size={16} />,
      path: '/config',
      loading: configLoading,
      sublabel: t('nav.config_management'),
    },
    {
      label: t('nav.ai_providers'),
      value: providerStats ? totalProviderKeys : '—',
      icon: <IconBot size={16} />,
      path: '/ai-providers',
      loading: configLoading,
      sublabel: providerBreakdown || undefined,
    },
    {
      label: t('nav.auth_files'),
      value: authFilesCount ?? '—',
      icon: <IconFileText size={16} />,
      path: '/auth-files',
      loading: authFilesLoading && authFilesCount === null,
      sublabel: t('dashboard.oauth_credentials'),
    },
    {
      label: t('dashboard.available_models'),
      value: getDashboardModelsStatValue(models.length, modelsLoading, modelsError),
      icon: <IconSatellite size={16} />,
      path: '/system',
      loading: modelsLoading,
      sublabel: t('dashboard.available_models_desc'),
    },
  ];

  const routingStrategyRaw = config?.routingStrategy?.trim() || '';
  const routingStrategyDisplay = !routingStrategyRaw
    ? '—'
    : routingStrategyRaw === 'round-robin'
      ? t('basic_settings.routing_strategy_round_robin')
      : routingStrategyRaw === 'fill-first'
        ? t('basic_settings.routing_strategy_fill_first')
        : routingStrategyRaw;

  const connectionClass =
    connectionStatus === 'connected'
      ? styles.connected
      : connectionStatus === 'connecting'
        ? styles.connecting
        : styles.disconnected;
  const connectionLabel = t(
    connectionStatus === 'connected'
      ? 'common.connected'
      : connectionStatus === 'connecting'
        ? 'common.connecting'
        : 'common.disconnected'
  );
  const serverBuildDateDisplay = formatDateValue(serverBuildDate, i18n.language);
  const versionDisplay = serverVersion ? `v${serverVersion.trim().replace(/^[vV]+/, '')}` : null;

  const boolBadge = (value: boolean | undefined) => (
    <span className={`${styles.boolBadge} ${value ? styles.on : styles.off}`}>
      {value ? t('common.yes') : t('common.no')}
    </span>
  );

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <h1>{t('nav.dashboard')}</h1>
        <div className={styles.serverMeta}>
          <span className={styles.connection}>
            <span className={`${styles.statusDot} ${connectionClass}`} />
            {versionDisplay ?? connectionLabel}
          </span>
          {serverBuildDateDisplay && (
            <span className={styles.buildDate}>{serverBuildDateDisplay}</span>
          )}
        </div>
      </header>

      <section className={styles.statGrid}>
        {quickStats.map((stat) => (
          <Link key={stat.path} to={stat.path} className={styles.statCard}>
            <div className={styles.statTop}>
              <span className={styles.statLabel}>{stat.label}</span>
              <span className={styles.statIcon}>{stat.icon}</span>
            </div>
            <span className={styles.statValue}>{stat.loading ? '—' : stat.value}</span>
            {stat.sublabel && !stat.loading && (
              <span className={styles.statSub} title={stat.sublabel}>
                {stat.sublabel}
              </span>
            )}
          </Link>
        ))}
      </section>

      {config && (
        <section className={styles.configCard}>
          <div className={styles.configHeader}>
            <h2>{t('dashboard.current_config')}</h2>
            <Link to="/config" className={styles.configEditLink}>
              {t('dashboard.edit_settings')}
            </Link>
          </div>
          <div className={styles.configGrid}>
            <div className={styles.configRow}>
              <span className={styles.configLabel}>{t('basic_settings.debug_enable')}</span>
              {boolBadge(config.debug)}
            </div>
            <div className={styles.configRow}>
              <span className={styles.configLabel}>
                {t('basic_settings.logging_to_file_enable')}
              </span>
              {boolBadge(config.loggingToFile)}
            </div>
            <div className={styles.configRow}>
              <span className={styles.configLabel}>{t('basic_settings.retry_count_label')}</span>
              <span className={styles.configValue}>{config.requestRetry ?? 0}</span>
            </div>
            <div className={styles.configRow}>
              <span className={styles.configLabel}>{t('basic_settings.ws_auth_enable')}</span>
              {boolBadge(config.wsAuth)}
            </div>
            <div className={styles.configRow}>
              <span className={styles.configLabel}>{t('dashboard.routing_strategy')}</span>
              <span className={styles.configValue}>{routingStrategyDisplay}</span>
            </div>
            {config.proxyUrl && (
              <div className={`${styles.configRow} ${styles.configRowWide}`}>
                <span className={styles.configLabel}>{t('basic_settings.proxy_url_label')}</span>
                <span className={styles.configMono} title={config.proxyUrl}>
                  {config.proxyUrl}
                </span>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
