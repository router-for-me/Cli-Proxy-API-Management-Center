import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RequestEventsDetailsCard, useUsageData } from '@/components/usage';
import { Card } from '@/components/ui/Card';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { authFilesApi } from '@/services/api';
import { useAuthStore, useConfigStore, useQuotaStore } from '@/stores';
import type { AuthFileItem, CodexQuotaWindow } from '@/types';
import {
  buildCodexUsageByAuthIndex,
  getCodexAuthIndex,
  isCodexAuthFile,
  refreshCodexQuotaFiles,
} from '@/features/codexCustomization/shared';
import { filterUsageByTimeRange, formatCompactNumber } from '@/utils/usage';
import styles from './DashboardOverviewPage.module.scss';

const OVERVIEW_TIME_RANGE = '24h' as const;

const formatLocaleNumber = (value: number, locale: string) =>
  new Intl.NumberFormat(locale).format(value);

const formatOverviewUpdatedTime = (value: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value);

const formatPlanLabel = (
  value: string | null | undefined,
  t: ReturnType<typeof useTranslation>['t']
) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

  if (!normalized) {
    return '--';
  }

  switch (normalized) {
    case 'plus':
      return t('codex_quota.plan_plus');
    case 'team':
      return t('codex_quota.plan_team');
    case 'free':
      return t('codex_quota.plan_free');
    case 'pro':
      return t('codex_quota.plan_pro');
    case 'prolite':
      return t('codex_quota.plan_prolite');
    default:
      return value ?? '--';
  }
};

const formatAccountName = (file: AuthFileItem) => {
  const rawName = String(file.name ?? '').trim();
  if (!rawName) {
    return '--';
  }

  return rawName
    .replace(/^codex-/i, '')
    .replace(/-(plus|team|free|pro|prolite|pro-lite)\.json$/i, '')
    .replace(/\.json$/i, '');
};

const formatRequestSummary = (requests: number, success: number, failed: number, locale: string) =>
  `${formatLocaleNumber(requests, locale)}(${formatLocaleNumber(success, locale)} ${formatLocaleNumber(failed, locale)})`;

const formatSuccessRate = (requests: number, success: number, locale: string) => {
  if (requests <= 0) {
    return '--';
  }

  const ratio = Math.max(0, Math.min(100, (success / requests) * 100));
  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: Math.abs(ratio - Math.round(ratio)) < 0.05 ? 0 : 1,
    minimumFractionDigits: Math.abs(ratio - Math.round(ratio)) < 0.05 ? 0 : 1,
  });
  return `${formatter.format(ratio)}%`;
};

const getSuccessTone = (requests: number, success: number) => {
  if (requests <= 0) {
    return {
      valueColor:
        'color-mix(in srgb, var(--text-secondary, #64748b) 88%, var(--text-primary, #0f172a))',
    };
  }

  const ratio = Math.max(0, Math.min(100, (success / requests) * 100));
  if (ratio >= 99) {
    return {
      valueColor: 'color-mix(in srgb, #15803d 88%, var(--text-primary, #0f172a))',
    };
  }
  if (ratio >= 95) {
    return {
      valueColor: 'color-mix(in srgb, #0f766e 86%, var(--text-primary, #0f172a))',
    };
  }
  if (ratio >= 85) {
    return {
      valueColor: 'color-mix(in srgb, #b45309 84%, var(--text-primary, #0f172a))',
    };
  }

  return {
    valueColor: 'color-mix(in srgb, #b91c1c 84%, var(--text-primary, #0f172a))',
  };
};

const getQuotaChipLabel = (windowItem: CodexQuotaWindow) => {
  const labelKey = String(windowItem.labelKey ?? '');
  if (labelKey.includes('primary_window')) {
    return '5H';
  }
  if (labelKey.includes('secondary_window')) {
    return '7D';
  }

  const fallback = String(windowItem.label ?? '').trim();
  return fallback ? fallback.slice(0, 6).toUpperCase() : 'QUOTA';
};

const getQuotaResetLabel = (windowItem: CodexQuotaWindow, locale: string) => {
  const labelKey = String(windowItem.labelKey ?? '');

  if (
    typeof windowItem.resetAtUnixSeconds === 'number' &&
    Number.isFinite(windowItem.resetAtUnixSeconds) &&
    windowItem.resetAtUnixSeconds > 0
  ) {
    const resetDate = new Date(windowItem.resetAtUnixSeconds * 1000);
    if (!Number.isNaN(resetDate.getTime())) {
      if (labelKey.includes('primary_window')) {
        return new Intl.DateTimeFormat(locale, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(resetDate);
      }

      if (labelKey.includes('secondary_window')) {
        return new Intl.DateTimeFormat(locale, {
          month: '2-digit',
          day: '2-digit',
        }).format(resetDate);
      }

      return new Intl.DateTimeFormat(locale, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(resetDate);
    }
  }

  return String(windowItem.resetLabel ?? '').trim() || '--';
};

const getQuotaFillClassName = (percent: number | null) => {
  if (percent === null) {
    return styles.quotaFillEmpty;
  }
  if (percent >= 70) {
    return styles.quotaFillGood;
  }
  if (percent >= 35) {
    return styles.quotaFillWarn;
  }
  return styles.quotaFillLow;
};

export function DashboardOverviewPage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const quotaScopeKey = useAuthStore((state) => `${state.apiBase}::${state.managementKey}`);
  const config = useConfigStore((state) => state.config);
  const codexQuota = useQuotaStore((state) => state.codexQuota);

  const { usage, loading, error, lastRefreshedAt, loadUsage } = useUsageData();

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const quotaSyncSignatureRef = useRef('');

  const loadOverviewFiles = useCallback(async (): Promise<AuthFileItem[]> => {
    if (connectionStatus !== 'connected') {
      setFiles([]);
      setFilesLoading(false);
      return [];
    }

    setFilesLoading(true);
    try {
      const result = await authFilesApi.list();
      const nextFiles = Array.isArray(result) ? result : result?.files;
      const resolvedFiles = Array.isArray(nextFiles) ? nextFiles : [];
      setFiles(resolvedFiles);
      return resolvedFiles;
    } catch {
      setFiles([]);
      return [];
    } finally {
      setFilesLoading(false);
    }
  }, [connectionStatus]);

  const handleHeaderRefresh = useCallback(async () => {
    if (connectionStatus !== 'connected') {
      setFiles([]);
      setFilesLoading(false);
      return;
    }

    const [refreshedFiles] = await Promise.all([loadOverviewFiles(), loadUsage()]);
    const refreshedCodexFiles = refreshedFiles.filter((file) => isCodexAuthFile(file));

    if (refreshedCodexFiles.length > 0) {
      quotaSyncSignatureRef.current = '';
      await refreshCodexQuotaFiles(refreshedCodexFiles, t, { silent: false });
    }
  }, [connectionStatus, loadOverviewFiles, loadUsage, t]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      setFiles([]);
      setFilesLoading(false);
      return;
    }

    void loadOverviewFiles();
  }, [connectionStatus, loadOverviewFiles, quotaScopeKey]);

  const overviewUsage = useMemo(
    () => (usage ? filterUsageByTimeRange(usage, OVERVIEW_TIME_RANGE) : null),
    [usage]
  );

  const codexFiles = useMemo(() => files.filter((file) => isCodexAuthFile(file)), [files]);
  const usageByAuthIndex = useMemo(
    () => buildCodexUsageByAuthIndex(overviewUsage),
    [overviewUsage]
  );
  const codexQuotaSignature = useMemo(
    () =>
      `${quotaScopeKey}::${codexFiles
        .map((file) => `${file.name}:${getCodexAuthIndex(file) ?? '-'}`)
        .join('|')}`,
    [codexFiles, quotaScopeKey]
  );

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      quotaSyncSignatureRef.current = '';
      return;
    }
  }, [connectionStatus]);

  useEffect(() => {
    if (
      connectionStatus !== 'connected' ||
      filesLoading ||
      codexFiles.length === 0 ||
      !codexQuotaSignature ||
      quotaSyncSignatureRef.current === codexQuotaSignature
    ) {
      return;
    }

    quotaSyncSignatureRef.current = codexQuotaSignature;
    void refreshCodexQuotaFiles(codexFiles, t, { silent: false });
  }, [codexFiles, codexQuotaSignature, connectionStatus, filesLoading, t]);

  const totalRequests = useMemo(
    () => Array.from(usageByAuthIndex.values()).reduce((sum, item) => sum + item.requests, 0),
    [usageByAuthIndex]
  );
  const totalTokens = useMemo(
    () => Array.from(usageByAuthIndex.values()).reduce((sum, item) => sum + item.tokens, 0),
    [usageByAuthIndex]
  );
  const hasUsageSnapshot = overviewUsage !== null;

  const accountCards = useMemo(
    () =>
      codexFiles.map((file) => {
        const authIndex = getCodexAuthIndex(file);
        const usageStats =
          authIndex !== null
            ? (usageByAuthIndex.get(authIndex) ?? {
                requests: 0,
                success: 0,
                failed: 0,
                tokens: 0,
              })
            : {
                requests: 0,
                success: 0,
                failed: 0,
                tokens: 0,
              };
        const quotaEntry = codexQuota[file.name];
        const quotaWindows = Array.isArray(quotaEntry?.windows) ? quotaEntry.windows : [];
        const fallbackResetLabel =
          !hasUsageSnapshot && filesLoading ? t('common.loading') : '--';
        const successTone = getSuccessTone(usageStats.requests, usageStats.success);

        const windows =
          quotaWindows.length > 0
            ? quotaWindows.slice(0, 2).map((windowItem) => ({
                id: windowItem.id,
                label: getQuotaChipLabel(windowItem),
                percent:
                  windowItem.usedPercent === null || windowItem.usedPercent === undefined
                    ? null
                    : Math.max(0, Math.min(100, 100 - Number(windowItem.usedPercent))),
                resetLabel: getQuotaResetLabel(windowItem, i18n.language),
              }))
            : [
                {
                  id: `${file.name}:primary`,
                  label: '5H',
                  percent: null,
                  resetLabel: fallbackResetLabel,
                },
                {
                  id: `${file.name}:secondary`,
                  label: '7D',
                  percent: null,
                  resetLabel: fallbackResetLabel,
                },
              ];

        return {
          file,
          displayName: formatAccountName(file),
          requestCountLabel: formatLocaleNumber(usageStats.requests, i18n.language),
          requestSummaryLabel: formatRequestSummary(
            usageStats.requests,
            usageStats.success,
            usageStats.failed,
            i18n.language
          ),
          requestSuccessLabel: formatLocaleNumber(usageStats.success, i18n.language),
          requestFailureLabel: formatLocaleNumber(usageStats.failed, i18n.language),
          successRateLabel: formatSuccessRate(
            usageStats.requests,
            usageStats.success,
            i18n.language
          ),
          successTone,
          planLabel: formatPlanLabel(quotaEntry?.planType, t),
          windows,
        };
      }),
    [codexFiles, codexQuota, filesLoading, hasUsageSnapshot, i18n.language, t, usageByAuthIndex]
  );

  const lastUpdatedLabel = lastRefreshedAt
    ? formatOverviewUpdatedTime(lastRefreshedAt, i18n.language)
    : hasUsageSnapshot
      ? '--'
      : t('common.loading');

  return (
    <div className={styles.page}>
      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.grid}>
        <Card
          className={styles.accountsCard}
          title={
            <div className={styles.titleGroup}>
              <span className={styles.cardTitle}>{t('dashboard.account_stats')}</span>
              <span className={styles.updatedText}>
                {t('usage_stats.last_updated')}: {lastUpdatedLabel}
              </span>
            </div>
          }
          extra={
            <div className={styles.summaryPills}>
              <span className={`${styles.summaryPill} ${styles.summaryPillRequests}`}>
                <span className={styles.summaryLabel}>{t('usage_stats.total_requests')}</span>
                <span className={styles.summaryValue}>
                  {hasUsageSnapshot ? formatLocaleNumber(totalRequests, i18n.language) : '--'}
                </span>
              </span>
              <span className={`${styles.summaryPill} ${styles.summaryPillTokens}`}>
                <span className={styles.summaryLabel}>{t('usage_stats.total_tokens')}</span>
                <span className={styles.summaryValue}>
                  {hasUsageSnapshot ? formatCompactNumber(totalTokens) : '--'}
                </span>
              </span>
            </div>
          }
        >
          {accountCards.length === 0 ? (
            <div className={styles.emptyState}>
              {!hasUsageSnapshot && filesLoading
                ? t('common.loading')
                : t('dashboard.no_codex_accounts')}
            </div>
          ) : (
            <div className={styles.accountGrid}>
              {accountCards.map((account) => (
                <div key={account.file.name} className={styles.accountCard}>
                  <div className={styles.accountHeader}>
                    <div className={styles.accountName} title={account.file.name}>
                      {account.displayName}
                    </div>
                    <span className={styles.planBadge}>{account.planLabel}</span>
                  </div>

                  <div className={styles.accountMetrics}>
                    <div className={styles.accountMetric}>
                      <span className={styles.accountMetricLabel}>
                        {t('usage_stats.requests_count')}
                      </span>
                      <div className={styles.requestSummary} title={account.requestSummaryLabel}>
                        <span className={styles.requestSummaryValue}>
                          {account.requestCountLabel}
                        </span>
                        <span className={styles.requestBreakdown}>
                          <span>(</span>
                          <span className={styles.requestSuccess}>
                            {account.requestSuccessLabel}
                          </span>
                          <span> </span>
                          <span className={styles.requestFailure}>
                            {account.requestFailureLabel}
                          </span>
                          <span>)</span>
                        </span>
                      </div>
                    </div>

                    <div className={styles.accountMetric}>
                      <span className={styles.accountMetricLabel}>
                        {t('usage_stats.success_rate')}
                      </span>
                      <span
                        className={styles.accountMetricValue}
                        style={{ color: account.successTone.valueColor }}
                      >
                        {account.successRateLabel}
                      </span>
                    </div>
                  </div>

                  <div className={styles.quotaGrid}>
                    {account.windows.map((windowItem) => (
                      <div key={windowItem.id} className={styles.quotaChip}>
                        <span className={styles.quotaLabel}>{windowItem.label}</span>
                        <span className={styles.quotaPercent}>
                          {windowItem.percent === null
                            ? '--'
                            : `${Math.round(windowItem.percent)}%`}
                        </span>
                        <div className={styles.quotaBar}>
                          <div
                            className={`${styles.quotaFill} ${getQuotaFillClassName(windowItem.percent)}`}
                            style={{ width: `${windowItem.percent ?? 0}%` }}
                          />
                        </div>
                        <span className={styles.quotaReset}>{windowItem.resetLabel}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <RequestEventsDetailsCard
          usage={overviewUsage}
          loading={loading}
          geminiKeys={config?.geminiApiKeys || []}
          claudeConfigs={config?.claudeApiKeys || []}
          codexConfigs={config?.codexApiKeys || []}
          vertexConfigs={config?.vertexApiKeys || []}
          openaiProviders={config?.openaiCompatibility || []}
          compact
          maxRows={10}
          liveRefresh
          cardClassName={styles.eventsCard}
        />
      </div>
    </div>
  );
}
