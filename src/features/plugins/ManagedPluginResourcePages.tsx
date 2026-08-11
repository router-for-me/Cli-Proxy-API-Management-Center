import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconExternalLink,
  IconRefreshCw,
  IconSettings,
  IconShield,
  IconTimer,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { apiClient } from '@/services/api/client';
import { getErrorMessage } from '@/utils/helpers';
import { openAgentIdentityManagement } from './agentIdentityManagement';
import {
  normalizeQuotaSchedulerStatus,
  type QuotaSchedulerStatus,
} from './quotaSchedulerManagement';
import styles from './PluginResourcePage.module.scss';

function ManagedPluginHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions: ReactNode;
}) {
  return (
    <div className={styles.managedHeader}>
      <div className={styles.managedHeading}>
        <span className={styles.managedIcon} aria-hidden={true}>
          <IconShield size={20} />
        </span>
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      <div className={styles.managedActions}>{actions}</div>
    </div>
  );
}

export function AgentIdentityManagementPage({ apiBase }: { apiBase: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  const openManagement = async () => {
    setOpening(true);
    setError('');
    try {
      await openAgentIdentityManagement(apiBase);
    } catch (err: unknown) {
      setError(getErrorMessage(err, t('plugin_resource.agent_identity_open_failed')));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className={styles.managedPage}>
      <ManagedPluginHeader
        title={t('plugin_resource.agent_identity_title')}
        description={t('plugin_resource.agent_identity_desc')}
        actions={
          <>
            <Button variant={'secondary'} onClick={() => navigate('/plugins')}>
              <IconSettings size={15} />
              {t('plugin_resource.plugin_settings')}
            </Button>
            <Button onClick={() => void openManagement()} loading={opening}>
              <IconExternalLink size={15} />
              {t('plugin_resource.agent_identity_open')}
            </Button>
          </>
        }
      />
      <div className={styles.managedBody}>
        <div className={styles.introCard}>
          <h2>{t('plugin_resource.agent_identity_import_title')}</h2>
          <p>{t('plugin_resource.agent_identity_import_desc')}</p>
          {error ? <div className={styles.errorMessage}>{error}</div> : null}
        </div>
      </div>
    </div>
  );
}

export function QuotaSchedulerManagementPage({ connected }: { connected: boolean }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<QuotaSchedulerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    if (!connected) {
      setLoading(false);
      setError(t('notification.connection_required'));
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [quota, bans] = await Promise.all([
        apiClient.get('/plugins/codex-quota-scheduler/quota'),
        apiClient.get('/plugins/codex-quota-scheduler/bans'),
      ]);
      setStatus(normalizeQuotaSchedulerStatus(quota, bans));
    } catch (err: unknown) {
      setError(getErrorMessage(err, t('plugin_resource.scheduler_load_failed')));
    } finally {
      setLoading(false);
    }
  }, [connected, t]);

  useHeaderRefresh(loadStatus, connected);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const formatValue = (value: string | number | null) =>
    value === null || value === '' ? t('plugin_resource.unknown') : String(value);
  const formatBoolean = (value: boolean | null) =>
    value === null
      ? t('plugin_resource.unknown')
      : value
        ? t('plugin_resource.enabled')
        : t('plugin_resource.disabled');
  const formatTimestamp = (value: string) => {
    if (!value) return t('plugin_resource.unknown');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(i18n.resolvedLanguage || undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };
  const runtimeHealthy = Boolean(
    status?.enabled && status.generationActive && status.generationManaged && status.serialActive
  );
  const modeText = formatValue(status?.schedulerMode ?? null);
  const generationText = formatValue(status?.runtimeGeneration ?? null);
  const snapshotText = formatValue(status?.freshSnapshots ?? null);

  return (
    <div className={styles.managedPage}>
      <ManagedPluginHeader
        title={t('plugin_resource.scheduler_title')}
        description={t('plugin_resource.scheduler_desc')}
        actions={
          <>
            <Button variant={'secondary'} size={'sm'} onClick={() => navigate('/plugins')}>
              <IconSettings size={15} />
              {t('plugin_resource.plugin_settings')}
            </Button>
            <Button size={'sm'} onClick={() => void loadStatus()} loading={loading}>
              <IconRefreshCw size={15} />
              {t('common.refresh')}
            </Button>
          </>
        }
      />
      <div className={styles.managedBody}>
        {error ? (
          <EmptyState
            title={t('plugin_resource.unavailable')}
            description={error}
            action={
              <Button variant={'secondary'} onClick={() => void loadStatus()}>
                {t('common.refresh')}
              </Button>
            }
          />
        ) : loading && !status ? (
          <div className={styles.statusPanel}>{t('common.loading')}</div>
        ) : (
          <div className={styles.schedulerSurface}>
            <section className={styles.schedulerOverview}>
              <div className={styles.overviewLead}>
                <div
                  className={`${styles.healthPill} ${
                    runtimeHealthy ? styles.healthGood : styles.healthWarning
                  }`}
                >
                  {runtimeHealthy ? (
                    <IconCheckCircle2 size={15} />
                  ) : (
                    <IconAlertTriangle size={15} />
                  )}
                  {runtimeHealthy
                    ? t('plugin_resource.scheduler_runtime_healthy')
                    : t('plugin_resource.scheduler_runtime_attention')}
                </div>
                <h2>{t('plugin_resource.scheduler_overview_title')}</h2>
                <p>
                  {t('plugin_resource.scheduler_overview_desc', {
                    generation: generationText,
                    snapshots: snapshotText,
                  })}
                </p>
              </div>
              <div className={styles.refreshStamp}>
                <span>{t('plugin_resource.last_refresh')}</span>
                <time dateTime={status?.lastRefresh || undefined} title={status?.lastRefresh}>
                  {formatTimestamp(status?.lastRefresh ?? '')}
                </time>
              </div>
            </section>

            <div className={styles.schedulerPanelGrid}>
              <section className={`${styles.schedulerPanel} ${styles.runtimePanel}`}>
                <header className={styles.panelHeader}>
                  <div>
                    <IconTimer size={17} />
                    <h3>{t('plugin_resource.scheduler_runtime_title')}</h3>
                  </div>
                  <span className={styles.modeBadge}>{modeText}</span>
                </header>
                <div className={styles.runtimeMetrics}>
                  <div className={styles.primaryMetric}>
                    <span>{t('plugin_resource.runtime_generation')}</span>
                    <strong>{generationText}</strong>
                  </div>
                  <div className={styles.inlineMetric}>
                    <span>{t('plugin_resource.scheduler_active_auth')}</span>
                    <strong className={status?.serialActive ? styles.valueGood : undefined}>
                      {status?.serialActive
                        ? t('plugin_resource.scheduler_locked')
                        : t('plugin_resource.scheduler_unassigned')}
                    </strong>
                  </div>
                  <div className={styles.inlineMetric}>
                    <span>{t('plugin_resource.fresh_snapshots')}</span>
                    <strong>{snapshotText}</strong>
                  </div>
                </div>
              </section>

              <section className={styles.schedulerPanel}>
                <header className={styles.panelHeader}>
                  <div>
                    <IconRefreshCw size={17} />
                    <h3>{t('plugin_resource.scheduler_warmup_title')}</h3>
                  </div>
                  <span
                    className={`${styles.modeBadge} ${
                      status?.warmupEnabled ? styles.modeBadgeGood : ''
                    }`}
                  >
                    {formatBoolean(status?.warmupEnabled ?? null)}
                  </span>
                </header>
                <div className={styles.warmupContent}>
                  <div className={styles.warmupTotal}>
                    <strong>{formatValue(status?.warmups ?? null)}</strong>
                    <span>{t('plugin_resource.warmups')}</span>
                  </div>
                  <div className={styles.warmupRows}>
                    <div>
                      <span>{t('plugin_resource.warmup_candidates')}</span>
                      <strong>{formatValue(status?.warmupCandidates ?? null)}</strong>
                    </div>
                    <div>
                      <span>{t('plugin_resource.warmup_execution')}</span>
                      <strong>{formatValue(status?.warmupExecutionMode ?? null)}</strong>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <section className={styles.guardRail}>
              <div className={styles.guardTitle}>
                <IconShield size={17} />
                <div>
                  <h3>{t('plugin_resource.scheduler_guard_title')}</h3>
                  <p>{t('plugin_resource.scheduler_guard_desc')}</p>
                </div>
              </div>
              <div className={styles.guardItems}>
                <div
                  className={`${styles.guardItem} ${
                    (status?.activeBans ?? 0) > 0 ? styles.guardWarning : styles.guardGood
                  }`}
                >
                  <strong>{formatValue(status?.activeBans ?? null)}</strong>
                  <span>{t('plugin_resource.active_bans')}</span>
                </div>
                <div
                  className={`${styles.guardItem} ${
                    (status?.total429s ?? 0) > 0 ? styles.guardWarning : styles.guardGood
                  }`}
                >
                  <strong>{formatValue(status?.total429s ?? null)}</strong>
                  <span>{t('plugin_resource.total_429s')}</span>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
