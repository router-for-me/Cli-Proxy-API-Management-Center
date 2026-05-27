import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconKey,
  IconBot,
  IconFileText,
  IconSatellite
} from '@/components/ui/icons';
import { useAuthStore, useConfigStore, useModelsStore } from '@/stores';
import { apiKeysApi, providersApi, authFilesApi, usageStatisticsApi } from '@/services/api';
import type { SummaryTotal, SummaryRow } from '@/types/usageStatistics';
import { formatCost, formatTokens } from '@/types/usageStatistics';
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

type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

function getTimeOfDay(): TimeOfDay {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

function todayDateStr(): string {
  return toDateStrLocal(new Date());
}

function daysAgoDateStr(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days + 1);
  return toDateStrLocal(d);
}

function toDateStrLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const apiBase = useAuthStore((state) => state.apiBase);
  const config = useConfigStore((state) => state.config);

  const models = useModelsStore((state) => state.models);
  const modelsLoading = useModelsStore((state) => state.loading);
  const fetchModelsFromStore = useModelsStore((state) => state.fetchModels);

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

  const [_usageStatsToday, setUsageStatsToday] = useState<SummaryTotal | null>(null);
  const [usageStats7d, setUsageStats7d] = useState<SummaryTotal | null>(null);
  const [usageStats9dGroups, setUsageStats9dGroups] = useState<SummaryRow[] | null>(null);

  const [loading, setLoading] = useState(true);

  // Time-of-day state for dynamic greeting
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>(getTimeOfDay);
  const [currentTime, setCurrentTime] = useState(() => new Date());

  const apiKeysCache = useRef<string[]>([]);

  useEffect(() => {
    apiKeysCache.current = [];
  }, [apiBase, config?.apiKeys]);

  // Update time every 60 seconds
  useEffect(() => {
    const id = setInterval(() => {
      setTimeOfDay(getTimeOfDay());
      setCurrentTime(new Date());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const normalizeApiKeyList = (input: unknown): string[] => {
    if (!Array.isArray(input)) return [];
    const seen = new Set<string>();
    const keys: string[] = [];

    input.forEach((item) => {
      const record =
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : null;
      const value =
        typeof item === 'string'
          ? item
          : record
            ? (record['api-key'] ?? record['apiKey'] ?? record.key ?? record.Key)
            : '';
      const trimmed = String(value ?? '').trim();
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
    } catch {
      return [];
    }
  }, [config?.apiKeys]);

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
    const fetchStats = async () => {
      setLoading(true);
      try {
        const [keysRes, filesRes, geminiRes, codexRes, claudeRes, openaiRes, todayRes, sevendRes, ninedRes] = await Promise.allSettled([
          apiKeysApi.list(),
          authFilesApi.list(),
          providersApi.getGeminiKeys(),
          providersApi.getCodexConfigs(),
          providersApi.getClaudeConfigs(),
          providersApi.getOpenAIProviders(),
          // Usage statistics: today
          usageStatisticsApi.getSummary({ from: todayDateStr(), to: todayDateStr(), group_by: 'day' }),
          // Usage statistics: last 7 days summary
          usageStatisticsApi.getSummary({ from: daysAgoDateStr(7), to: todayDateStr(), group_by: 'day' }),
          // Usage statistics: last 9 days grouped by day (for chart)
          usageStatisticsApi.getSummary({ from: daysAgoDateStr(9), to: todayDateStr(), group_by: 'day' }),
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

        // Usage stats: only show card when calls succeed
        if (todayRes.status === 'fulfilled') {
          setUsageStatsToday(todayRes.value.summary);
        } else {
          console.warn('[Dashboard] usage stats (today) unavailable:', todayRes.reason);
        }
        if (sevendRes.status === 'fulfilled') {
          setUsageStats7d(sevendRes.value.summary);
        }
        if (ninedRes.status === 'fulfilled') {
          setUsageStats9dGroups(ninedRes.value.groups);
        }
      } finally {
        setLoading(false);
      }
    };

    if (connectionStatus === 'connected') {
      fetchStats();
      fetchModels();
    } else {
      setLoading(false);
    }
  }, [connectionStatus, fetchModels]);

  // Calculate total provider keys only when all provider stats are available.
  const providerStatsReady =
    providerStats.gemini !== null &&
    providerStats.codex !== null &&
    providerStats.claude !== null &&
    providerStats.openai !== null;
  const hasProviderStats =
    providerStats.gemini !== null ||
    providerStats.codex !== null ||
    providerStats.claude !== null ||
    providerStats.openai !== null;
  const totalProviderKeys = providerStatsReady
    ? (providerStats.gemini ?? 0) +
      (providerStats.codex ?? 0) +
      (providerStats.claude ?? 0) +
      (providerStats.openai ?? 0)
    : 0;

  const quickStats: QuickStat[] = [
    {
      label: t('dashboard.management_keys'),
      value: stats.apiKeys ?? '-',
      icon: <IconKey size={24} />,
      path: '/config',
      loading: loading && stats.apiKeys === null,
      sublabel: t('nav.config_management')
    },
    {
      label: t('nav.ai_providers'),
      value: loading ? '-' : providerStatsReady ? totalProviderKeys : '-',
      icon: <IconBot size={24} />,
      path: '/ai-providers',
      loading: loading,
      sublabel: hasProviderStats
        ? t('dashboard.provider_keys_detail', {
            gemini: providerStats.gemini ?? '-',
            codex: providerStats.codex ?? '-',
            claude: providerStats.claude ?? '-',
            openai: providerStats.openai ?? '-'
          })
        : undefined
    },
    {
      label: t('nav.auth_files'),
      value: stats.authFiles ?? '-',
      icon: <IconFileText size={24} />,
      path: '/auth-files',
      loading: loading && stats.authFiles === null,
      sublabel: t('dashboard.oauth_credentials')
    },
    {
      label: t('dashboard.available_models'),
      value: modelsLoading ? '-' : models.length,
      icon: <IconSatellite size={24} />,
      path: '/system',
      loading: modelsLoading,
      sublabel: t('dashboard.available_models_desc')
    }
  ];

  const routingStrategyRaw = config?.routingStrategy?.trim() || '';
  const routingStrategyDisplay = !routingStrategyRaw
    ? '-'
    : routingStrategyRaw === 'round-robin'
      ? t('basic_settings.routing_strategy_round_robin')
      : routingStrategyRaw === 'fill-first'
        ? t('basic_settings.routing_strategy_fill_first')
        : routingStrategyRaw;
  const routingStrategyBadgeClass = !routingStrategyRaw
    ? styles.configBadgeUnknown
    : routingStrategyRaw === 'round-robin'
      ? styles.configBadgeRoundRobin
      : routingStrategyRaw === 'fill-first'
        ? styles.configBadgeFillFirst
        : styles.configBadgeUnknown;

  // Derived time-based values
  const greetingKey = `dashboard.greeting_${timeOfDay}`;
  const caringKey = `dashboard.caring_${timeOfDay}`;

  const formattedDate = currentTime.toLocaleDateString(i18n.language, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const formattedTime = currentTime.toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit'
  });

  return (
    <div className={styles.dashboard}>
      {/* Decorative background orbs */}
      <div className={styles.backgroundOrbs} aria-hidden="true">
        <div className={styles.orb1} />
        <div className={styles.orb2} />
      </div>

      {/* Hero welcome section */}
      <section className={styles.hero}>
        <span className={styles.heroWatermark} aria-hidden="true">
          OVERVIEW
        </span>
        <div className={styles.heroContent}>
          <span className={styles.heroGreeting}>{t(greetingKey)}</span>
          <h1 className={styles.heroTitle}>{t('dashboard.welcome_back')}</h1>
          <p className={styles.heroCaring}>{t(caringKey)}</p>
        </div>
        <div className={styles.heroMeta}>
          <div className={styles.dateTimeBlock}>
            <span className={styles.time}>{formattedTime}</span>
            <span className={styles.date}>{formattedDate}</span>
          </div>
          <div className={styles.connectionPill}>
            <span
              className={`${styles.statusDot} ${
                connectionStatus === 'connected'
                  ? styles.connected
                  : connectionStatus === 'connecting'
                    ? styles.connecting
                    : styles.disconnected
              }`}
            />
            <span className={styles.pillText}>
              {serverVersion
                ? `v${serverVersion.trim().replace(/^[vV]+/, '')}`
                : t(
                    connectionStatus === 'connected'
                      ? 'common.connected'
                      : connectionStatus === 'connecting'
                        ? 'common.connecting'
                        : 'common.disconnected'
                  )}
            </span>
          </div>
          {serverBuildDate && (
            <span className={styles.buildDate}>
              {new Date(serverBuildDate).toLocaleDateString(i18n.language)}
            </span>
          )}
        </div>
      </section>

      {/* Usage overview section — only shown when usage stats available */}
      {usageStats7d && (
        <section className={`${styles.usageOverview} ${styles.statsSection}`}>
          <h2 className={styles.sectionHeading}>{t('usage_statistics.usage_stats_overview')}</h2>

          {/* 7-day summary cards */}
          <div className={styles.usageSummaryRow}>
            <div className={styles.usageSummaryCard}>
              <span className={styles.usageSummaryLabel}>{t('usage_statistics.usage_total_tokens')}</span>
              <span className={styles.usageSummaryValue}>{formatTokens(usageStats7d.tokens.total_tokens)}</span>
            </div>
            <div className={styles.usageSummaryCard}>
              <span className={styles.usageSummaryLabel}>{t('usage_statistics.usage_cost_cny')}</span>
              <span className={styles.usageSummaryValue}>{formatCost(usageStats7d.cost)}</span>
            </div>
            <div className={styles.usageSummaryCard}>
              <span className={styles.usageSummaryLabel}>{t('usage_statistics.usage_total_requests')}</span>
              <span className={styles.usageSummaryValue}>
                {formatTokens(usageStats7d.requests)}
                {usageStats7d.failed > 0 && (
                  <span className={styles.usageFailedBadge}>{t('usage_statistics.usage_failed_requests')} {formatTokens(usageStats7d.failed)}</span>
                )}
              </span>
            </div>
          </div>

          {/* 9-day bar chart */}
          {usageStats9dGroups && usageStats9dGroups.length > 0 && (
            <div className={styles.usageChart}>
              <h3 className={styles.usageChartTitle}>{t('usage_statistics.usage_chart_title')}</h3>
              <div className={styles.usageChartLegend}>
                <span className={styles.usageChartLegendItem}>
                  <span className={`${styles.usageChartLegendDot} ${styles.dotInput}`} />
                  {t('usage_statistics.usage_chart_input')}
                </span>
                <span className={styles.usageChartLegendItem}>
                  <span className={`${styles.usageChartLegendDot} ${styles.dotOutput}`} />
                  {t('usage_statistics.usage_chart_output')}
                </span>
              </div>
              <div className={styles.usageBarChart}>
                {(() => {
                  const groups = usageStats9dGroups;
                  const maxTokens = Math.max(1, ...groups.map(g => g.tokens.input_tokens + g.tokens.output_tokens));
                  return groups.map((g) => {
                    const inputPct = maxTokens > 0 ? (g.tokens.input_tokens / maxTokens) * 100 : 0;
                    const outputPct = maxTokens > 0 ? (g.tokens.output_tokens / maxTokens) * 100 : 0;
                    const label = g.key.length >= 10 ? g.key.slice(5) : g.key;
                    const costStr = g.cost.known ? formatCost(g.cost) : '-';
                    return (
                      <div key={g.key} className={styles.barCol}>
                        <div className={styles.barStack}>
                          <div className={`${styles.barSegment} ${styles.barInput}`} style={{ height: `${inputPct}%` }} />
                          <div className={`${styles.barSegment} ${styles.barOutput}`} style={{ height: `${outputPct}%` }} />
                        </div>
                        <div className={styles.barTooltip}>
                          <span className={styles.tooltipDate}>{g.key}</span>
                          <span>{t('usage_statistics.tooltip_cost')}{costStr}</span>
                          <span>{t('usage_statistics.tooltip_requests')}{formatTokens(g.requests)}</span>
                          <span>{t('usage_statistics.tooltip_success')}{formatTokens(g.success)}</span>
                          <span>{t('usage_statistics.tooltip_failed')}{formatTokens(g.failed)}</span>
                          <span className={styles.tooltipDivider} />
                          <span>{t('usage_statistics.tooltip_tokens')}{formatTokens(g.tokens.total_tokens)}</span>
                          <span>{t('usage_statistics.tooltip_input')}{formatTokens(g.tokens.input_tokens)}</span>
                          <span>{t('usage_statistics.tooltip_output')}{formatTokens(g.tokens.output_tokens)}</span>
                          <span>{t('usage_statistics.tooltip_cached')}{formatTokens(g.tokens.cached_tokens)}</span>
                        </div>
                        <span className={styles.barLabel}>{label}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Bento stats grid */}
      <section className={styles.statsSection}>
        <h2 className={styles.sectionHeading}>{t('dashboard.system_overview')}</h2>
        <div className={styles.bentoGrid}>
          {quickStats.map((stat, index) => (
            <Link
              key={stat.path}
              to={stat.path}
              className={`${styles.bentoCard} ${index === 0 ? styles.bentoLarge : ''}`}
              style={{ animationDelay: `${index * 80}ms` }}
            >
              <div className={styles.bentoIcon}>{stat.icon}</div>
              <div className={styles.bentoContent}>
                <span className={styles.bentoValue}>
                  {stat.loading ? '...' : stat.value}
                </span>
                <span className={styles.bentoLabel}>{stat.label}</span>
                {stat.sublabel && !stat.loading && (
                  <span className={styles.bentoSublabel}>{stat.sublabel}</span>
                )}
              </div>
            </Link>
          ))}

        </div>
      </section>

      {/* Config pills section */}
      {config && (
        <section className={styles.configSection}>
          <h2 className={styles.sectionHeading}>{t('dashboard.current_config')}</h2>
          <div className={styles.configPillGrid}>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.debug_enable')}</span>
              <span className={`${styles.configPillValue} ${config.debug ? styles.on : styles.off}`}>
                {config.debug ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.logging_to_file_enable')}</span>
              <span className={`${styles.configPillValue} ${config.loggingToFile ? styles.on : styles.off}`}>
                {config.loggingToFile ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.retry_count_label')}</span>
              <span className={styles.configPillValue}>{config.requestRetry ?? 0}</span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('basic_settings.ws_auth_enable')}</span>
              <span className={`${styles.configPillValue} ${config.wsAuth ? styles.on : styles.off}`}>
                {config.wsAuth ? t('common.yes') : t('common.no')}
              </span>
            </div>
            <div className={styles.configPill}>
              <span className={styles.configPillLabel}>{t('dashboard.routing_strategy')}</span>
              <span className={`${styles.configBadge} ${routingStrategyBadgeClass}`}>
                {routingStrategyDisplay}
              </span>
            </div>
            {config.proxyUrl && (
              <div className={`${styles.configPill} ${styles.configPillWide}`}>
                <span className={styles.configPillLabel}>{t('basic_settings.proxy_url_label')}</span>
                <span className={styles.configPillMono}>{config.proxyUrl}</span>
              </div>
            )}
          </div>
          <Link to="/config" className={styles.viewMoreLink}>
            {t('dashboard.edit_settings')} →
          </Link>
        </section>
      )}
    </div>
  );
}
