import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconRefreshCw } from '@/components/ui/icons';
import type {
  ManagementQuotaCredentialDetails,
  ManagementQuotaCredentialSnapshot,
  ManagementQuotaWindow,
} from '@/types';
import styles from './AuthFileManagementQuota.module.scss';

type AuthFileManagementQuotaProps = {
  snapshot?: ManagementQuotaCredentialSnapshot;
  details?: ManagementQuotaCredentialDetails;
  compact?: boolean;
  loading?: boolean;
  collecting?: boolean;
  disabled?: boolean;
  onRefresh?: () => void;
};

const ratioFor = (window: ManagementQuotaWindow): number | null => {
  if (window.remainingRatio != null && Number.isFinite(window.remainingRatio)) {
    return Math.max(0, Math.min(1, window.remainingRatio));
  }
  if (window.usedRatio != null && Number.isFinite(window.usedRatio)) {
    return Math.max(0, Math.min(1, 1 - window.usedRatio));
  }
  if (window.remaining != null && window.limit != null && window.limit > 0) {
    return Math.max(0, Math.min(1, window.remaining / window.limit));
  }
  return null;
};

const formatAmount = (value: number | null, unit: string, unlimited: boolean): string => {
  if (unlimited) return '∞';
  if (value == null) return '-';
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '');
  return unit && unit !== 'percentage' ? `${formatted} ${unit}` : formatted;
};

const formatTime = (value: string | null): string => {
  if (!value) return '-';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
};

const statusClass = (status: string, stylesMap: typeof styles): string => {
  if (status === 'healthy') return stylesMap.statusHealthy;
  if (status === 'low') return stylesMap.statusLow;
  if (status === 'exhausted') return stylesMap.statusExhausted;
  if (status === 'error') return stylesMap.statusError;
  return stylesMap.statusUnknown;
};

const windowLabel = (window: ManagementQuotaWindow, index: number): string =>
  window.label || window.id || `Window ${index + 1}`;

export function AuthFileManagementQuota({
  snapshot,
  details,
  compact = false,
  loading = false,
  collecting = false,
  disabled = false,
  onRefresh,
}: AuthFileManagementQuotaProps) {
  const { t } = useTranslation();
  if (loading && !snapshot) {
    return (
      <div className={compact ? styles.compactLoading : styles.loading}>
        <LoadingSpinner size={14} />
        <span>{t('auth_files.quota_home_loading')}</span>
      </div>
    );
  }
  if (!snapshot) {
    return <span className={styles.unavailable}>{t('auth_files.quota_home_unavailable')}</span>;
  }

  const windows = details?.windows.length ? details.windows : snapshot.primaryWindows;
  const displayWindows = compact ? snapshot.primaryWindows.slice(0, 2) : windows;
  const statusKey = `auth_files.quota_status_${snapshot.quotaStatus}`;
  const freshnessKey = `auth_files.quota_freshness_${snapshot.freshness}`;
  const statusLabel = t(statusKey, { defaultValue: snapshot.quotaStatus });
  const freshnessLabel = t(freshnessKey, { defaultValue: snapshot.freshness });

  return (
    <section className={compact ? styles.compact : styles.section}>
      <div className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.title}>{t('auth_files.quota_home_title')}</span>
          {snapshot.plan?.name && <span className={styles.plan}>{snapshot.plan.name}</span>}
        </div>
        <span className={`${styles.status} ${statusClass(snapshot.quotaStatus, styles)}`}>
          <span className={styles.statusDot} aria-hidden="true" />
          {statusLabel}
        </span>
      </div>

      {displayWindows.length > 0 ? (
        <div className={styles.windows}>
          {displayWindows.map((window, index) => {
            const ratio = ratioFor(window);
            return (
              <div className={styles.window} key={window.id || `${window.label}-${index}`}>
                <div className={styles.windowHead}>
                  <span title={windowLabel(window, index)}>{windowLabel(window, index)}</span>
                  <strong>{ratio == null ? '-' : `${Math.round(ratio * 100)}%`}</strong>
                </div>
                <div className={styles.track} aria-hidden="true">
                  <span
                    className={`${styles.fill} ${statusClass(window.status, styles)}`}
                    style={{ width: ratio == null ? '0%' : `${Math.round(ratio * 100)}%` }}
                  />
                </div>
                {!compact && (
                  <div className={styles.windowMeta}>
                    <span>
                      {formatAmount(window.remaining, window.unit, window.isUnlimited)}{' '}
                      {t('auth_files.quota_remaining')}
                    </span>
                    <span>
                      {t('auth_files.quota_reset_at')}: {formatTime(window.resetAt)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className={styles.empty}>{t('auth_files.quota_home_no_windows')}</p>
      )}

      {compact ? (
        <div className={styles.compactMeta}>
          <span>{freshnessLabel}</span>
          <span>{snapshot.earliestResetAt ? formatTime(snapshot.earliestResetAt) : '-'}</span>
        </div>
      ) : (
        <>
          <dl className={styles.metadata}>
            <div>
              <dt>{t('auth_files.quota_collection_status')}</dt>
              <dd>
                {t(`auth_files.quota_collection_${snapshot.collectionStatus}`, {
                  defaultValue: snapshot.collectionStatus,
                })}
              </dd>
            </div>
            <div>
              <dt>{t('auth_files.quota_observed_at')}</dt>
              <dd>{formatTime(snapshot.observedAt)}</dd>
            </div>
            <div>
              <dt>{t('auth_files.quota_source')}</dt>
              <dd>{snapshot.source || '-'}</dd>
            </div>
            <div>
              <dt>{t('auth_files.quota_windows_count')}</dt>
              <dd>{snapshot.windowCount}</dd>
            </div>
            {details?.resetCredits?.availableCount != null && (
              <div>
                <dt>{t('auth_files.quota_reset_credits')}</dt>
                <dd>{details.resetCredits.availableCount}</dd>
              </div>
            )}
          </dl>
          {snapshot.error?.message && <p className={styles.error}>{snapshot.error.message}</p>}
          {onRefresh && (
            <Button
              size="sm"
              variant="secondary"
              className={styles.refresh}
              onClick={onRefresh}
              disabled={disabled || collecting}
            >
              {collecting ? <LoadingSpinner size={13} /> : <IconRefreshCw size={14} />}
              {collecting ? t('auth_files.quota_collecting') : t('auth_files.quota_refresh')}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
