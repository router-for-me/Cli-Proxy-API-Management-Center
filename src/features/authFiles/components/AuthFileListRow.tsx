import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconRefreshCw, IconSettings, IconTrash2 } from '@/components/ui/icons';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import type { AuthFileItem, CredentialSessionUsage } from '@/types';
import type { ManagementQuotaCredentialSnapshot } from '@/types';
import { AuthFileManagementQuota } from '@/features/authFiles/components/AuthFileManagementQuota';
import { AuthFileSeatGlyphs } from '@/features/authFiles/components/AuthFileSeatGlyphs';
import { statusBarDataFromRecentRequests } from '@/utils/recentRequests';
import { formatFileSize } from '@/utils/format';
import {
  formatModified,
  getAuthFileIcon,
  getAuthFileStatusMessage,
  getThemeSurfaceIconBackground,
  getTypeColor,
  getTypeLabel,
  hasAuthFileStatusWarning,
  isRuntimeOnlyAuthFile,
  isThemeSurfaceIconProvider,
  normalizeProviderKey,
  supportsAuthFileManualRefresh,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { deriveAuthFileIdentity } from '@/features/authFiles/identity';
import type { AuthFileStatusBarData } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import cardStyles from './AuthFileCard.module.scss';
import styles from './AuthFileListRow.module.scss';

export type AuthFileListRowProps = {
  file: AuthFileItem;
  selected: boolean;
  resolvedTheme: ResolvedTheme;
  disableControls: boolean;
  deleting: string | null;
  statusUpdating: Record<string, boolean>;
  manualRefreshing: Record<string, boolean>;
  statusBarCache: Map<string, AuthFileStatusBarData>;
  sessionUsage?: CredentialSessionUsage;
  quotaSnapshot?: ManagementQuotaCredentialSnapshot;
  quotaSupported?: boolean;
  onManualRefresh: (file: AuthFileItem) => void;
  onDelete: (name: string) => void;
  onToggleStatus: (file: AuthFileItem, enabled: boolean) => void;
  onToggleSelect: (name: string) => void;
  onOpenSessionDetails: (file: AuthFileItem) => void;
};

export function AuthFileListRow({
  file,
  selected,
  resolvedTheme,
  disableControls,
  deleting,
  statusUpdating,
  manualRefreshing,
  statusBarCache,
  sessionUsage,
  quotaSnapshot,
  quotaSupported = false,
  onManualRefresh,
  onDelete,
  onToggleStatus,
  onToggleSelect,
  onOpenSessionDetails,
}: AuthFileListRowProps) {
  const { t } = useTranslation();
  const isRuntimeOnly = isRuntimeOnlyAuthFile(file);
  const providerKey = normalizeProviderKey(String(file.type ?? file.provider ?? 'unknown'));
  const typeLabel = getTypeLabel(t, providerKey);
  const typeColor = getTypeColor(providerKey, resolvedTheme);
  const providerIcon = getAuthFileIcon(providerKey, resolvedTheme);
  const identity = deriveAuthFileIdentity(file);
  const rawStatusMessage = getAuthFileStatusMessage(file);
  const hasStatusWarning = hasAuthFileStatusWarning(file);
  const isManualRefreshing = manualRefreshing[file.name] === true;
  const showManualRefreshButton = !isRuntimeOnly && supportsAuthFileManualRefresh(providerKey);
  const authIndexKey = typeof file.authIndex === 'string' ? file.authIndex : null;
  const statusData =
    (authIndexKey && statusBarCache.get(authIndexKey)) ||
    statusBarDataFromRecentRequests(file.recentRequests ?? []);
  const successCount = file.successCount ?? 0;
  const failureCount = file.failureCount ?? 0;
  const stateLabel = isRuntimeOnly
    ? t('auth_files.type_virtual')
    : file.disabled
      ? t('auth_files.health_status_disabled')
      : hasStatusWarning
        ? t('auth_files.health_status_warning')
        : rawStatusMessage
          ? t('auth_files.health_status_healthy')
          : t('auth_files.status_toggle_label');
  const stateClass = isRuntimeOnly
    ? styles.stateVirtual
    : file.disabled
      ? styles.stateDisabled
      : hasStatusWarning
        ? styles.stateWarning
        : styles.stateActive;
  const rowClassName = [
    styles.row,
    selected ? styles.rowSelected : '',
    file.disabled ? styles.rowDisabled : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article className={rowClassName} aria-label={identity.primary}>
      <div className={styles.identityCell}>
        {!isRuntimeOnly && (
          <SelectionCheckbox
            checked={selected}
            onChange={() => onToggleSelect(file.name)}
            className={styles.selection}
            ariaLabel={selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')}
            title={selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')}
          />
        )}
        <div
          className={styles.avatar}
          style={
            isThemeSurfaceIconProvider(providerKey)
              ? {
                  backgroundColor: getThemeSurfaceIconBackground(resolvedTheme),
                  color: typeColor.text,
                }
              : {
                  backgroundColor: typeColor.bg,
                  color: typeColor.text,
                  ...(typeColor.border ? { border: typeColor.border } : {}),
                }
          }
        >
          {providerIcon ? (
            <img src={providerIcon} alt="" className={styles.avatarImage} />
          ) : (
            <span className={styles.avatarFallback}>{typeLabel.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div className={styles.identityCopy}>
          <div className={styles.identityTopline}>
            <strong className={styles.account} title={identity.primary}>
              {identity.primary}
            </strong>
            <span
              className={styles.typeBadge}
              style={{
                backgroundColor: typeColor.bg,
                color: typeColor.text,
                ...(typeColor.border ? { border: typeColor.border } : {}),
              }}
            >
              {typeLabel}
            </span>
          </div>
          <div className={styles.identityMeta}>
            <span className={`${styles.stateBadge} ${stateClass}`}>
              <span className={styles.stateDot} aria-hidden="true" />
              {stateLabel}
            </span>
            <span className={styles.fileName} title={identity.fullName}>
              {identity.secondary ?? identity.fullName}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.healthCell}>
        <div className={styles.healthSummary}>
          <span className={styles.healthLabel}>{t('auth_files.health_status_label')}</span>
          <span className={styles.healthCounts}>
            <span className={successCount > 0 ? styles.countLiveOk : ''}>
              {t('stats.success')} {successCount}
            </span>
            <span className={failureCount > 0 ? styles.countLiveFail : ''}>
              {t('stats.failure')} {failureCount}
            </span>
          </span>
        </div>
        <ProviderStatusBar statusData={statusData} styles={cardStyles} />
      </div>

      <div className={styles.sessionCell}>
        {sessionUsage ? (
          <>
            <div className={styles.metricLine}>
              <AuthFileSeatGlyphs seats={sessionUsage.seats} />
            </div>
            {!sessionUsage.coverageComplete && (
              <span
                className={styles.coverageWarning}
                title={t('auth_files.session_usage_incomplete_detail', {
                  admitted: sessionUsage.admittedSessions,
                  observed: sessionUsage.observedSessions,
                })}
                aria-label={t('auth_files.session_usage_incomplete_detail', {
                  admitted: sessionUsage.admittedSessions,
                  observed: sessionUsage.observedSessions,
                })}
              >
                !
              </span>
            )}
          </>
        ) : (
          <span className={styles.unavailable}>-</span>
        )}
      </div>

      <div className={styles.quotaCell}>
        {quotaSupported ? (
          <AuthFileManagementQuota snapshot={quotaSnapshot} compact />
        ) : (
          <span className={styles.unavailable}>-</span>
        )}
      </div>

      <div className={styles.metaCell}>
        <time dateTime={String(file.modified ?? file.modtime ?? '')}>{formatModified(file)}</time>
        <span>{file.size ? formatFileSize(file.size) : '-'}</span>
      </div>

      <div className={styles.actionsCell}>
        {!isRuntimeOnly && (
          <ToggleSwitch
            ariaLabel={t('auth_files.status_toggle_label')}
            checked={!file.disabled}
            disabled={disableControls || statusUpdating[file.name] === true || isManualRefreshing}
            onChange={(value) => onToggleStatus(file, value)}
          />
        )}
        {showManualRefreshButton && (
          <Button
            variant="secondary"
            size="sm"
            className={styles.iconButton}
            onClick={() => onManualRefresh(file)}
            title={t('auth_files.manual_refresh_button')}
            aria-label={t('auth_files.manual_refresh_button')}
            disabled={disableControls || file.disabled || isManualRefreshing}
          >
            {isManualRefreshing ? <LoadingSpinner size={14} /> : <IconRefreshCw size={15} />}
          </Button>
        )}
        {!isRuntimeOnly && (
          <>
            <Button
              variant="secondary"
              size="sm"
              className={styles.iconButton}
              onClick={() => onOpenSessionDetails(file)}
              title={t('auth_files.account_details')}
              aria-label={t('auth_files.account_details')}
              disabled={disableControls || isManualRefreshing}
            >
              <IconSettings size={15} />
            </Button>
            <Button
              variant="danger"
              size="sm"
              className={styles.iconButton}
              onClick={() => onDelete(file.name)}
              title={t('auth_files.delete_button')}
              aria-label={t('auth_files.delete_button')}
              disabled={disableControls || deleting === file.name || isManualRefreshing}
            >
              {deleting === file.name ? <LoadingSpinner size={14} /> : <IconTrash2 size={15} />}
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
