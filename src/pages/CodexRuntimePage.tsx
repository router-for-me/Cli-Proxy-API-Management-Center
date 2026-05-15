import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconRefreshCw } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { codexStateApi } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import type { CodexRuntimeQuotaWindow, CodexStateEntry } from '@/types';
import { formatDateTime, formatNumber, formatUnixTimestamp } from '@/utils/format';
import styles from './CodexRuntimePage.module.scss';

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

const formatTimestamp = (value: string | number | null | undefined, locale?: string): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    return formatUnixTimestamp(value, locale) || '—';
  }
  return formatDateTime(value, locale);
};

const formatQuotaValue = (value: number | null | undefined, locale?: string): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return formatNumber(value, locale);
};

const formatScore = (value: number | null | undefined, locale?: string): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return value.toLocaleString(locale, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
};

const formatPercent = (value: number | null | undefined, locale?: string): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${value.toLocaleString(locale)}%`;
};

const buildIdentityLabel = (item: CodexStateEntry): string => {
  if (item.email?.trim()) return item.email.trim();
  if (item.account?.trim()) return item.account.trim();
  if (item.name?.trim()) return item.name.trim();
  return item.id;
};

const formatDraftValue = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
};

const isQuotaExhausted = (item: CodexStateEntry): boolean => {
  const fiveHourRemaining = item.codex_quota?.five_hour?.remaining;
  const weeklyRemaining = item.codex_quota?.weekly?.remaining;
  return fiveHourRemaining === 0 || weeklyRemaining === 0;
};

const buildStatusTone = (item: CodexStateEntry): 'ok' | 'warn' | 'danger' => {
  if (isQuotaExhausted(item) || item.disabled) return 'danger';
  const status = (item.status || '').toLowerCase();
  if (!status) return 'warn';
  if (status === 'active') return 'ok';
  if (
    status.includes('ok') ||
    status.includes('ready') ||
    status.includes('valid') ||
    status.includes('available')
  ) {
    return 'ok';
  }
  if (status.includes('error') || status.includes('invalid')) return 'danger';
  return 'warn';
};

const buildStatusLabel = (item: CodexStateEntry, t: (key: string) => string): string => {
  if (isQuotaExhausted(item)) return t('codex_runtime.exhausted');
  const status = (item.status || '').trim();
  if (!status) return t('codex_runtime.unknown_status');
  if (status.toLowerCase() === 'active') return t('codex_runtime.active');
  return status;
};

function QuotaWindowCard({
  label,
  window,
  locale,
}: {
  label: string;
  window: CodexRuntimeQuotaWindow | null | undefined;
  locale: string;
}) {
  const { t } = useTranslation();
  const remainingPercent =
    typeof window?.remaining === 'number' &&
    Number.isFinite(window.remaining) &&
    typeof window?.limit === 'number' &&
    Number.isFinite(window.limit) &&
    window.limit > 0
      ? Math.max(0, Math.min(100, (window.remaining / window.limit) * 100))
      : null;
  const remainingToneClass =
    remainingPercent === null
      ? ''
      : remainingPercent <= 20
        ? styles.progressDanger
        : remainingPercent <= 50
          ? styles.progressWarn
          : styles.progressOk;

  return (
    <div className={styles.quotaWindow}>
      <div className={styles.quotaWindowTitle}>{label}</div>
      <div className={styles.kvList}>
        <div className={`${styles.kvRow} ${styles.kvRowProgress} ${remainingToneClass}`}>
          {remainingPercent !== null ? (
            <div
              className={styles.kvRowProgressFill}
              style={{ width: `${remainingPercent}%` }}
              aria-hidden="true"
            />
          ) : null}
          <span>{t('codex_runtime.remaining')}</span>
          <strong>{formatQuotaValue(window?.remaining, locale)}</strong>
        </div>
        {window?.limit !== 100 ? (
          <div className={styles.kvRow}>
            <span>{t('codex_runtime.limit')}</span>
            <strong>{formatQuotaValue(window?.limit, locale)}</strong>
          </div>
        ) : null}
        <div className={styles.kvRow}>
          <span>{t('codex_runtime.reset_at')}</span>
          <strong>{formatTimestamp(window?.reset_at, locale)}</strong>
        </div>
      </div>
    </div>
  );
}

export function CodexRuntimePage() {
  const { t, i18n } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [items, setItems] = useState<CodexStateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | 'ALL' | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [scoreDrafts, setScoreDrafts] = useState<Record<string, string>>({});

  const disableControls = connectionStatus !== 'connected';
  const [autoRefreshTick, setAutoRefreshTick] = useState(0);

  const syncDrafts = useCallback((entries: CodexStateEntry[]) => {
    const next: Record<string, string> = {};
    entries.forEach((entry) => {
      const manual = entry.codex_manual_score_adjustment;
      next[entry.id] = typeof manual === 'number' && Number.isFinite(manual) ? String(manual) : '0';
    });
    setScoreDrafts(next);
  }, []);

  const loadState = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await codexStateApi.list();
      setItems(data);
      syncDrafts(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err) || t('notification.refresh_failed'));
    } finally {
      setLoading(false);
    }
  }, [syncDrafts, t]);

  useHeaderRefresh(loadState);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    if (loading) return;
    const onDevice = items.find((item) => item.on_device);
    if (!onDevice) return;
    const timer = window.setInterval(() => {
      setAutoRefreshTick((tick) => tick + 1);
    }, 4000);
    return () => {
      window.clearInterval(timer);
    };
  }, [items, loading]);

  useEffect(() => {
    if (autoRefreshTick === 0) return;
    const onDevice = items.find((item) => item.on_device);
    if (!onDevice) return;

    let cancelled = false;
    void (async () => {
      try {
        const data = await codexStateApi.list();
        if (cancelled) return;
        setItems((prev) => {
          const nextById = new Map(data.map((entry) => [entry.id, entry]));
          return prev.map((entry) => (entry.id === onDevice.id ? nextById.get(entry.id) ?? entry : entry));
        });
      } catch {
        // silent background poll failure
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [autoRefreshTick, items]);

  const sortedItems = useMemo(() => {
    return [...items].sort((left, right) => {
      const leftExhausted = isQuotaExhausted(left);
      const rightExhausted = isQuotaExhausted(right);
      if (leftExhausted !== rightExhausted) {
        return leftExhausted ? 1 : -1;
      }

      const leftScore = left.codex_score_explanation?.computed_score_live;
      const rightScore = right.codex_score_explanation?.computed_score_live;
      const leftHasScore = typeof leftScore === 'number' && Number.isFinite(leftScore);
      const rightHasScore = typeof rightScore === 'number' && Number.isFinite(rightScore);
      if (leftHasScore !== rightHasScore) {
        return leftHasScore ? -1 : 1;
      }
      if (leftHasScore && rightHasScore && leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return buildIdentityLabel(left).localeCompare(buildIdentityLabel(right), undefined, {
        sensitivity: 'base',
      });
    });
  }, [items]);

  const summary = useMemo(() => {
    const eligible = items.filter((item) => !item.disabled && !item.unavailable);
    const currentAccount = items.find((item) => item.on_device);
    const recommendedAccount = eligible
      .filter((item) => typeof item.codex_score_explanation?.computed_score_live === 'number')
      .sort(
        (left, right) =>
          (right.codex_score_explanation?.computed_score_live ?? -Infinity) -
          (left.codex_score_explanation?.computed_score_live ?? -Infinity)
      )[0];

    let fiveHourRemaining = 0;
    let fiveHourLimit = 0;
    let nextFiveHourReset: string | number | null = null;
    let weeklyRemaining = 0;
    let weeklyLimit = 0;
    let nextWeeklyReset: string | number | null = null;

    const validResetMin = (current: string | number | null, next: string | number | null) => {
      if (next === null || next === undefined || next === '') return current;
      const currentMs =
        current === null || current === undefined || current === ''
          ? null
          : typeof current === 'number'
            ? current
            : Date.parse(String(current));
      const nextMs = typeof next === 'number' ? next : Date.parse(String(next));
      if (!Number.isFinite(nextMs)) return current;
      if (currentMs === null || !Number.isFinite(currentMs)) return next;
      return nextMs < currentMs ? next : current;
    };

    for (const item of items) {
      const fiveHour = item.codex_quota?.five_hour;
      if (
        typeof fiveHour?.remaining === 'number' &&
        Number.isFinite(fiveHour.remaining) &&
        typeof fiveHour?.limit === 'number' &&
        Number.isFinite(fiveHour.limit) &&
        fiveHour.limit > 0
      ) {
        if (!item.disabled && !item.unavailable) {
          fiveHourRemaining += fiveHour.remaining;
          fiveHourLimit += fiveHour.limit;
        }
        nextFiveHourReset = validResetMin(nextFiveHourReset, fiveHour.reset_at ?? null);
      }

      const weekly = item.codex_quota?.weekly;
      if (
        typeof weekly?.remaining === 'number' &&
        Number.isFinite(weekly.remaining) &&
        typeof weekly?.limit === 'number' &&
        Number.isFinite(weekly.limit) &&
        weekly.limit > 0
      ) {
        if (!item.disabled && !item.unavailable) {
          weeklyRemaining += weekly.remaining;
        }
        weeklyLimit += weekly.limit;
        nextWeeklyReset = validResetMin(nextWeeklyReset, weekly.reset_at ?? null);
      }
    }

    return {
      accounts: items.length,
      currentAccount:
        currentAccount?.email?.trim() ||
        currentAccount?.account?.trim() ||
        currentAccount?.name?.trim() ||
        '—',
      recommendedAccount:
        recommendedAccount?.email?.trim() ||
        recommendedAccount?.account?.trim() ||
        recommendedAccount?.name?.trim() ||
        '—',
      usableFiveHourRemainingPercent:
        fiveHourLimit > 0 ? Math.round((fiveHourRemaining / fiveHourLimit) * 100) : null,
      fleetUsableWeeklyRemainingPercent:
        weeklyLimit > 0 ? Math.round((weeklyRemaining / weeklyLimit) * 100) : null,
      nextFiveHourReset,
      nextWeeklyReset,
    };
  }, [items]);

  const handleBumpManualScore = (id: string, delta: number) => {
    setScoreDrafts((prev) => {
      const current = Number(prev[id] ?? '0');
      const nextValue = Number.isFinite(current) ? current + delta : delta;
      return { ...prev, [id]: formatDraftValue(nextValue) };
    });
  };

  const handleSaveManualScore = async (item: CodexStateEntry) => {
    const draft = (scoreDrafts[item.id] ?? '').trim();
    const parsed = Number(draft);

    if (!draft || !Number.isFinite(parsed)) {
      showNotification(t('codex_runtime.invalid_manual_score'), 'error');
      return;
    }

    setSavingId(item.id);
    try {
      await codexStateApi.updateManualScore({
        id: item.id,
        name: item.name,
        auth_index: item.auth_index,
        value: parsed,
      });
      await loadState();
      showNotification(t('codex_runtime.manual_score_saved'), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(
        `${t('codex_runtime.manual_score_save_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setSavingId(null);
    }
  };

  const handleRefreshOne = async (item: CodexStateEntry) => {
    setRefreshingId(item.id);
    try {
      await codexStateApi.refreshOne({
        id: item.id,
        name: item.name,
        auth_index: item.auth_index,
      });
      await loadState();
      showNotification(t('codex_runtime.refresh_one_success'), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(
        `${t('codex_runtime.refresh_one_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setRefreshingId(null);
    }
  };

  const handleRefreshAll = async () => {
    setRefreshingId('ALL');
    try {
      await codexStateApi.refreshAll();
      await loadState();
      showNotification(t('codex_runtime.refresh_all_success'), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(
        `${t('codex_runtime.refresh_all_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setRefreshingId(null);
    }
  };

  const handleRecalcScore = async () => {
    setRecalculating(true);
    try {
      const result = await codexStateApi.recalc();
      await loadState();
      const account = result?.on_device?.email || result?.on_device?.account || result?.on_device?.name || '';
      showNotification(
        account
          ? `${t('codex_runtime.recalc_success')}: ${account}`
          : t('codex_runtime.recalc_success'),
        'success'
      );
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(
        `${t('codex_runtime.recalc_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setRecalculating(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{t('codex_runtime.title')}</h1>
          <p className={styles.description}>{t('codex_runtime.description')}</p>
        </div>

        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadState()}
            disabled={disableControls || loading || refreshingId === 'ALL'}
          >
            {t('codex_runtime.refresh_page')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleRecalcScore()}
            loading={recalculating}
            disabled={disableControls || loading || refreshingId === 'ALL'}
          >
            {t('codex_runtime.recalc_score')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={styles.refreshAllButton}
            onClick={() => void handleRefreshAll()}
            loading={refreshingId === 'ALL'}
            disabled={disableControls || loading || sortedItems.length === 0}
          >
            <IconRefreshCw size={16} />
            {t('codex_runtime.refresh_all')}
          </Button>
        </div>
      </div>

      <div className={styles.summaryGrid}>
        <div className={styles.summaryBubble}><span>{t('codex_runtime.summary_accounts')}</span><strong>{summary.accounts}</strong></div>
        <div className={`${styles.summaryBubble} ${styles.accountSummaryBubble}`}><span>{t('codex_runtime.summary_current_account')}</span><strong>{summary.currentAccount}</strong></div>
        <div className={`${styles.summaryBubble} ${styles.accountSummaryBubble}`}><span>{t('codex_runtime.summary_recommended_account')}</span><strong>{summary.recommendedAccount}</strong></div>
        <div className={styles.summaryBubble}><span>{t('codex_runtime.summary_usable_5h_remaining')}</span><strong>{formatPercent(summary.usableFiveHourRemainingPercent, i18n.language)}</strong></div>
        <div className={styles.summaryBubble}><span>{t('codex_runtime.summary_fleet_weekly_remaining')}</span><strong>{formatPercent(summary.fleetUsableWeeklyRemainingPercent, i18n.language)}</strong></div>
        <div className={styles.summaryBubble}><span>{t('codex_runtime.summary_next_5h_reset')}</span><strong>{formatTimestamp(summary.nextFiveHourReset, i18n.language)}</strong></div>
        <div className={styles.summaryBubble}><span>{t('codex_runtime.summary_next_weekly_reset')}</span><strong>{formatTimestamp(summary.nextWeeklyReset, i18n.language)}</strong></div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {!loading && sortedItems.length === 0 ? (
        <EmptyState
          title={t('codex_runtime.empty_title')}
          description={t('codex_runtime.empty_description')}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadState()}
              disabled={disableControls}
            >
              {t('codex_runtime.reload')}
            </Button>
          }
        />
      ) : (
        <div className={styles.grid}>
          {sortedItems.map((item) => {
            const identityLabel = buildIdentityLabel(item);
            const manualValue = scoreDrafts[item.id] ?? '0';
            const liveComputedScore = item.codex_score_explanation?.computed_score_live;

            return (
              <Card
                key={item.id}
                className={`${styles.card} ${isQuotaExhausted(item) ? styles.cardExhausted : ''}`}
                title={<div className={styles.cardTitle}>{identityLabel}</div>}
                extra={
                  <div className={styles.cardActions}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleRefreshOne(item)}
                      loading={refreshingId === item.id}
                      disabled={disableControls || loading || refreshingId === 'ALL'}
                    >
                      <IconRefreshCw size={16} />
                      {t('codex_runtime.refresh')}
                    </Button>
                  </div>
                }
              >
                <div className={styles.cardTopMeta}>
                  <span className={`${styles.statusBadge} ${styles[buildStatusTone(item)]}`}>
                    {buildStatusLabel(item, t)}
                  </span>
                  {item.on_device ? (
                    <span className={`${styles.flagBadge} ${styles.info}`}>
                      {t('codex_runtime.on_device')}
                    </span>
                  ) : null}
                  {item.disabled ? (
                    <span className={`${styles.flagBadge} ${styles.danger}`}>
                      {t('codex_runtime.disabled')}
                    </span>
                  ) : null}
                </div>

                <div className={styles.section}>
                  <div className={styles.sectionTitle}>{t('codex_runtime.quota_state')}</div>
                  <div className={styles.quotaGrid}>
                    <QuotaWindowCard
                      label={t('codex_runtime.five_hour_window')}
                      window={item.codex_quota?.five_hour}
                      locale={i18n.language}
                    />
                    <QuotaWindowCard
                      label={t('codex_runtime.weekly_window')}
                      window={item.codex_quota?.weekly}
                      locale={i18n.language}
                    />
                  </div>
                  <div className={styles.kvList}>
                    <div className={styles.kvRow}>
                      <span>{t('codex_runtime.refresh_status')}</span>
                      <strong>{item.codex_quota?.refresh_status || '—'}</strong>
                    </div>
                    <div className={styles.kvRow}>
                      <span>{t('codex_runtime.last_refresh_at')}</span>
                      <strong>
                        {formatTimestamp(item.codex_quota?.last_refresh_at, i18n.language)}
                      </strong>
                    </div>
                  </div>
                  {item.codex_quota?.refresh_error ? (
                    <div className={styles.inlineError}>{item.codex_quota.refresh_error}</div>
                  ) : null}
                </div>

                <div className={styles.section}>
                  <div className={styles.sectionTitle}>{t('codex_runtime.scoring')}</div>
                  <div className={styles.scoreGrid}>
                    <div className={styles.scoreTile}>
                      <span>{t('codex_runtime.manual_score_adjustment')}</span>
                      <strong>{formatScore(Number(manualValue), i18n.language)}</strong>
                      <div className={styles.scoreAdjuster}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleBumpManualScore(item.id, -0.1)}
                          disabled={disableControls || loading || savingId === item.id || refreshingId === item.id}
                        >
                          −
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleBumpManualScore(item.id, 0.1)}
                          disabled={disableControls || loading || savingId === item.id || refreshingId === item.id}
                        >
                          +
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void handleSaveManualScore(item)}
                          loading={savingId === item.id}
                          disabled={
                            disableControls ||
                            loading ||
                            savingId === item.id ||
                            refreshingId === item.id ||
                            !manualValue.trim()
                          }
                        >
                          {t('codex_runtime.save_manual_score')}
                        </Button>
                      </div>
                    </div>
                    <div className={styles.scoreTile}>
                      <span>{t('codex_runtime.live_computed_score')}</span>
                      <strong>{formatScore(liveComputedScore, i18n.language)}</strong>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
