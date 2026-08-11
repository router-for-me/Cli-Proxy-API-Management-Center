import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconExternalLink,
  IconNetwork,
  IconRefreshCw,
  IconSatellite,
  IconSettings,
  IconShield,
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
      const [quota, bans, authFiles] = await Promise.all([
        apiClient.get('/plugins/codex-quota-scheduler/quota'),
        apiClient.get('/plugins/codex-quota-scheduler/bans'),
        apiClient.get('/auth-files'),
      ]);
      setStatus(normalizeQuotaSchedulerStatus(quota, bans, authFiles));
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
  const protectionActive = Boolean(
    (status?.activeBans ?? 0) > 0 || (status?.total429s ?? 0) > 0 || status?.lastError
  );
  const modeText = formatValue(status?.schedulerMode ?? null);
  const generationText = formatValue(status?.runtimeGeneration ?? null);
  const snapshotText = formatValue(status?.freshSnapshots ?? null);
  const activeAuthText = formatValue(status?.activeAuthLabel || status?.activeAuthId || null);
  const snapshotCoverage = status?.snapshotCount
    ? `${formatValue(status.freshSnapshots)}/${status.snapshotCount}`
    : snapshotText;
  const warmupSummary = status?.warmupSummary;
  const warmupAttention = Boolean(
    (warmupSummary?.failed ?? 0) > 0 || (warmupSummary?.blocked ?? 0) > 0
  );
  const warmupQueueClear = status?.warmupCandidates === 0;
  const runtimeStatusText = !runtimeHealthy
    ? t('plugin_resource.scheduler_runtime_attention')
    : protectionActive
      ? t('plugin_resource.scheduler_runtime_guarded')
      : t('plugin_resource.scheduler_runtime_healthy');
  const formatWarmupState = (value: string) => {
    switch (value) {
      case 'confirmed':
        return t('plugin_resource.warmup_confirmed');
      case 'pending_confirmation':
        return t('plugin_resource.warmup_pending');
      case 'failed':
        return t('plugin_resource.warmup_failed');
      case 'blocked':
        return t('plugin_resource.warmup_blocked');
      case 'attempted':
        return t('plugin_resource.warmup_attempted');
      default:
        return t('plugin_resource.unknown');
    }
  };

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
            <section
              className={`${styles.schedulerCommand} ${
                runtimeHealthy && !protectionActive
                  ? styles.commandRunning
                  : styles.commandAttention
              }`}
            >
              <div className={styles.commandLead}>
                <div
                  className={`${styles.healthPill} ${
                    runtimeHealthy && !protectionActive ? styles.healthGood : styles.healthWarning
                  }`}
                >
                  {runtimeHealthy && !protectionActive ? (
                    <IconCheckCircle2 size={15} />
                  ) : (
                    <IconAlertTriangle size={15} />
                  )}
                  {runtimeStatusText}
                </div>

                <div className={styles.activeLaneLabel}>
                  <IconNetwork size={17} />
                  <span>{t('plugin_resource.scheduler_active_lane')}</span>
                </div>
                <div className={styles.activeIdentity}>
                  <span
                    className={`${styles.liveDot} ${protectionActive ? styles.liveDotWarning : ''}`}
                    aria-hidden={true}
                  />
                  <strong title={status?.activeAuthLabel || status?.activeAuthId || undefined}>
                    {activeAuthText}
                  </strong>
                </div>
                <div className={styles.activeMeta}>
                  <span>
                    {t('plugin_resource.scheduler_active_since')}
                    <time
                      dateTime={status?.serialSelectedAt || undefined}
                      title={status?.serialSelectedAt}
                    >
                      {formatTimestamp(status?.serialSelectedAt ?? '')}
                    </time>
                  </span>
                  <span>
                    {t('plugin_resource.scheduler_switches')}
                    <strong>{formatValue(status?.serialSwitches ?? null)}</strong>
                  </span>
                </div>
              </div>

              <div className={styles.commandTelemetry}>
                <div>
                  <span>{t('plugin_resource.scheduler_mode')}</span>
                  <strong className={styles.monoValue}>{modeText}</strong>
                </div>
                <div>
                  <span>{t('plugin_resource.scheduler_snapshot_coverage')}</span>
                  <strong>{snapshotCoverage}</strong>
                </div>
                <div>
                  <span>{t('plugin_resource.scheduler_switch_threshold')}</span>
                  <strong>
                    {status?.serialSwitchPercent === null ||
                    status?.serialSwitchPercent === undefined
                      ? t('plugin_resource.unknown')
                      : `${status.serialSwitchPercent}%`}
                  </strong>
                </div>
                <div>
                  <span>{t('plugin_resource.runtime_generation')}</span>
                  <strong>{generationText}</strong>
                </div>
                <div className={styles.telemetryRefresh}>
                  <span>{t('plugin_resource.last_refresh')}</span>
                  <time dateTime={status?.lastRefresh || undefined} title={status?.lastRefresh}>
                    {formatTimestamp(status?.lastRefresh ?? '')}
                  </time>
                </div>
              </div>
            </section>

            <div className={styles.schedulerOperationsGrid}>
              <section
                className={`${styles.operationPanel} ${
                  warmupAttention ? styles.operationWarning : ''
                }`}
              >
                <header className={styles.operationHeader}>
                  <div>
                    <span className={styles.operationIcon} aria-hidden={true}>
                      <IconSatellite size={18} />
                    </span>
                    <div>
                      <h3>{t('plugin_resource.scheduler_warmup_title')}</h3>
                      <p>
                        {warmupQueueClear
                          ? t('plugin_resource.scheduler_warmup_clear')
                          : t('plugin_resource.scheduler_warmup_waiting', {
                              count: formatValue(status?.warmupCandidates ?? null),
                            })}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`${styles.modeBadge} ${
                      status?.warmupEnabled ? styles.modeBadgeGood : ''
                    }`}
                  >
                    {formatBoolean(status?.warmupEnabled ?? null)}
                  </span>
                </header>

                <div className={styles.warmupDashboard}>
                  <div className={styles.warmupHeadline}>
                    <div>
                      <span>{t('plugin_resource.warmup_candidates')}</span>
                      <strong
                        className={
                          (status?.warmupCandidates ?? 0) > 0
                            ? styles.valueWarning
                            : styles.valueGood
                        }
                      >
                        {formatValue(status?.warmupCandidates ?? null)}
                      </strong>
                      <small>
                        {t('plugin_resource.scheduler_warmup_executed', {
                          count: formatValue(status?.warmups ?? null),
                        })}
                      </small>
                    </div>
                    <div className={styles.warmupMode}>
                      <span>{t('plugin_resource.warmup_execution')}</span>
                      <strong className={styles.monoValue}>
                        {formatValue(status?.warmupExecutionMode ?? null)}
                      </strong>
                    </div>
                  </div>

                  <div className={styles.warmupPipeline}>
                    <div className={styles.pipelineGood}>
                      <strong>{formatValue(warmupSummary?.confirmed ?? null)}</strong>
                      <span>{t('plugin_resource.warmup_confirmed')}</span>
                    </div>
                    <div className={styles.pipelinePending}>
                      <strong>{formatValue(warmupSummary?.pending ?? null)}</strong>
                      <span>{t('plugin_resource.warmup_pending')}</span>
                    </div>
                    <div className={styles.pipelineBad}>
                      <strong>{formatValue(warmupSummary?.failed ?? null)}</strong>
                      <span>{t('plugin_resource.warmup_failed')}</span>
                    </div>
                    <div className={styles.pipelineBlocked}>
                      <strong>{formatValue(warmupSummary?.blocked ?? null)}</strong>
                      <span>{t('plugin_resource.warmup_blocked')}</span>
                    </div>
                  </div>

                  <div className={styles.warmupLatest}>
                    <span>{t('plugin_resource.scheduler_warmup_latest')}</span>
                    {warmupSummary?.latestAt ? (
                      <strong>
                        {formatWarmupState(warmupSummary.latestState)}
                        {warmupSummary.latestWindow ? ` · ${warmupSummary.latestWindow}` : ''}
                        <time dateTime={warmupSummary.latestAt} title={warmupSummary.latestAt}>
                          {formatTimestamp(warmupSummary.latestAt)}
                        </time>
                      </strong>
                    ) : (
                      <strong>{t('plugin_resource.scheduler_no_warmup_history')}</strong>
                    )}
                  </div>
                </div>
              </section>

              <section
                className={`${styles.operationPanel} ${
                  protectionActive ? styles.operationWarning : styles.operationHealthy
                }`}
              >
                <header className={styles.operationHeader}>
                  <div>
                    <span className={styles.operationIcon} aria-hidden={true}>
                      <IconShield size={18} />
                    </span>
                    <div>
                      <h3>{t('plugin_resource.scheduler_protection_title')}</h3>
                      <p>
                        {protectionActive
                          ? t('plugin_resource.scheduler_protection_active')
                          : t('plugin_resource.scheduler_protection_healthy')}
                      </p>
                    </div>
                  </div>
                </header>

                <div className={styles.protectionMetrics}>
                  <div
                    className={(status?.activeBans ?? 0) > 0 ? styles.protectionAlert : undefined}
                  >
                    <strong>{formatValue(status?.activeBans ?? null)}</strong>
                    <span>{t('plugin_resource.scheduler_isolated_accounts')}</span>
                  </div>
                  <div
                    className={(status?.total429s ?? 0) > 0 ? styles.protectionAlert : undefined}
                  >
                    <strong>{formatValue(status?.total429s ?? null)}</strong>
                    <span>{t('plugin_resource.total_429s')}</span>
                  </div>
                </div>

                <div className={styles.switchActivity}>
                  <div>
                    <span>{t('plugin_resource.scheduler_switch_reason')}</span>
                    <strong className={styles.monoValue} title={status?.serialSwitchReason}>
                      {formatValue(status?.serialSwitchReason || null)}
                    </strong>
                  </div>
                  <div>
                    <span>{t('plugin_resource.scheduler_last_switch')}</span>
                    <time
                      dateTime={status?.serialLastSwitchAt || undefined}
                      title={status?.serialLastSwitchAt}
                    >
                      {formatTimestamp(status?.serialLastSwitchAt ?? '')}
                    </time>
                  </div>
                </div>
              </section>
            </div>

            {status?.lastError ? (
              <section className={styles.schedulerErrorStrip}>
                <IconAlertTriangle size={17} />
                <div>
                  <span>{t('plugin_resource.scheduler_last_error')}</span>
                  <strong>{status.lastError}</strong>
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
