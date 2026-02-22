import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconBot, IconCheck, IconCode, IconDownload, IconInfo, IconTrash2 } from '@/components/ui/icons';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import type { AuthFileItem } from '@/types';
import { resolveAuthProvider } from '@/utils/quota';
import { calculateStatusBarData, normalizeAuthIndex, type KeyStats } from '@/utils/usage';
import { formatFileSize } from '@/utils/format';
import {
  AUTH_FILE_REFRESH_WARNING_MS,
  QUOTA_PROVIDER_TYPES,
  formatModified,
  getTypeColor,
  getTypeLabel,
  isRuntimeOnlyAuthFile,
  resolveAuthFileStats,
  type QuotaProviderType,
  type ResolvedTheme
} from '@/features/authFiles/constants';
import type { AuthFileStatusBarData } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import { AuthFileQuotaSection } from '@/features/authFiles/components/AuthFileQuotaSection';
import styles from '@/pages/AuthFilesPage.module.scss';

type AuthFileHealthStatus = 'healthy' | 'warning' | 'disabled' | 'unknown';

const HEALTHY_STATUS_MESSAGES = new Set(['ok', 'healthy', 'ready', 'success', 'available']);
const GOOD_STATUS_VALUES = new Set(['', 'ok', 'ready', 'healthy', 'available']);

const parseDateFromUnknown = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === '') return null;
  const asNumber = Number(value);
  const date =
    Number.isFinite(asNumber) && !Number.isNaN(asNumber)
      ? new Date(Math.abs(asNumber) < 1e12 ? asNumber * 1000 : asNumber)
      : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

export type AuthFileCardProps = {
  file: AuthFileItem;
  selected: boolean;
  resolvedTheme: ResolvedTheme;
  disableControls: boolean;
  deleting: string | null;
  statusUpdating: Record<string, boolean>;
  quotaFilterType: QuotaProviderType | null;
  keyStats: KeyStats;
  statusBarCache: Map<string, AuthFileStatusBarData>;
  nowMs: number;
  onShowModels: (file: AuthFileItem) => void;
  onShowDetails: (file: AuthFileItem) => void;
  onDownload: (name: string) => void;
  onOpenPrefixProxyEditor: (name: string) => void;
  onDelete: (name: string) => void;
  onToggleStatus: (file: AuthFileItem, enabled: boolean) => void;
  onToggleSelect: (name: string) => void;
};

const resolveQuotaType = (file: AuthFileItem): QuotaProviderType | null => {
  const provider = resolveAuthProvider(file);
  if (!QUOTA_PROVIDER_TYPES.has(provider as QuotaProviderType)) return null;
  return provider as QuotaProviderType;
};

export function AuthFileCard(props: AuthFileCardProps) {
  const { t, i18n } = useTranslation();
  const {
    file,
    selected,
    resolvedTheme,
    disableControls,
    deleting,
    statusUpdating,
    quotaFilterType,
    keyStats,
    statusBarCache,
    nowMs,
    onShowModels,
    onShowDetails,
    onDownload,
    onOpenPrefixProxyEditor,
    onDelete,
    onToggleStatus,
    onToggleSelect
  } = props;

  const fileStats = resolveAuthFileStats(file, keyStats);
  const isRuntimeOnly = isRuntimeOnlyAuthFile(file);
  const isAistudio = (file.type || '').toLowerCase() === 'aistudio';
  const showModelsButton = !isRuntimeOnly || isAistudio;
  const typeColor = getTypeColor(file.type || 'unknown', resolvedTheme);

  const quotaType =
    quotaFilterType && resolveQuotaType(file) === quotaFilterType ? quotaFilterType : null;

  const showQuotaLayout = Boolean(quotaType) && !isRuntimeOnly;

  const providerCardClass =
    quotaType === 'antigravity'
      ? styles.antigravityCard
      : quotaType === 'codex'
        ? styles.codexCard
        : quotaType === 'gemini-cli'
          ? styles.geminiCliCard
          : '';

  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndexKey = normalizeAuthIndex(rawAuthIndex);
  const statusData =
    (authIndexKey && statusBarCache.get(authIndexKey)) || calculateStatusBarData([]);
  const rawStatus = String(file.status ?? file['status'] ?? '')
    .trim()
    .toLowerCase();
  const rawStatusMessage = String(file['status_message'] ?? file.statusMessage ?? '').trim();
  const normalizedStatusMessage = rawStatusMessage.toLowerCase();
  const isFileDisabled = file.disabled === true || rawStatus === 'disabled';
  const isUnavailable = file.unavailable === true || rawStatus === 'unavailable';
  const lastRefreshDate = parseDateFromUnknown(file['last_refresh'] ?? file.lastRefresh);
  const isRefreshStale = lastRefreshDate
    ? nowMs - lastRefreshDate.getTime() > AUTH_FILE_REFRESH_WARNING_MS
    : false;
  const hasStatusWarning =
    Boolean(rawStatusMessage) && !HEALTHY_STATUS_MESSAGES.has(normalizedStatusMessage);
  const hasStatusFailure = rawStatus === 'error' || rawStatus === 'failed' || rawStatus === 'warning';
  const healthStatus: AuthFileHealthStatus = isFileDisabled
    ? 'disabled'
    : hasStatusWarning || hasStatusFailure || isUnavailable || isRefreshStale
      ? 'warning'
      : lastRefreshDate && !isRefreshStale && GOOD_STATUS_VALUES.has(rawStatus)
        ? 'healthy'
        : 'unknown';
  const healthStatusClass =
    healthStatus === 'healthy'
      ? styles.healthStatusHealthy
      : healthStatus === 'warning'
        ? styles.healthStatusWarning
        : healthStatus === 'disabled'
          ? styles.healthStatusDisabled
          : styles.healthStatusUnknown;
  const healthStatusLabel = t(`auth_files.health_status_${healthStatus}`);
  const lastRefreshText = (() => {
    if (!lastRefreshDate) return t('auth_files.refresh_not_available');

    const diffMs = lastRefreshDate.getTime() - nowMs;
    const absMs = Math.abs(diffMs);
    if (absMs < 30 * 1000) {
      return t('auth_files.refresh_just_now');
    }

    const units: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
      { unit: 'day', ms: 24 * 60 * 60 * 1000 },
      { unit: 'hour', ms: 60 * 60 * 1000 },
      { unit: 'minute', ms: 60 * 1000 },
      { unit: 'second', ms: 1000 }
    ];
    const matched = units.find(({ ms }) => absMs >= ms) || units[units.length - 1];
    const value = Math.round(diffMs / matched.ms);
    if (typeof Intl === 'undefined' || typeof Intl.RelativeTimeFormat !== 'function') {
      return lastRefreshDate.toLocaleString(i18n.language);
    }
    const formatter = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
    return formatter.format(value, matched.unit);
  })();
  const lastRefreshTitle = lastRefreshDate
    ? lastRefreshDate.toLocaleString(i18n.language)
    : t('auth_files.refresh_not_available');
  const healthStatusTitle = rawStatusMessage || t('auth_files.health_status_no_message');

  return (
    <div
      className={`${styles.fileCard} ${providerCardClass} ${selected ? styles.fileCardSelected : ''} ${file.disabled ? styles.fileCardDisabled : ''}`}
    >
      <div className={styles.fileCardLayout}>
        <div className={styles.fileCardMain}>
          <div className={styles.cardHeader}>
            {!isRuntimeOnly && (
              <button
                type="button"
                className={`${styles.selectionToggle} ${selected ? styles.selectionToggleActive : ''}`}
                onClick={() => onToggleSelect(file.name)}
                aria-label={selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')}
                aria-pressed={selected}
                title={selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')}
              >
                {selected && <IconCheck size={12} />}
              </button>
            )}
            <span
              className={styles.typeBadge}
              style={{
                backgroundColor: typeColor.bg,
                color: typeColor.text,
                ...(typeColor.border ? { border: typeColor.border } : {})
              }}
            >
              {getTypeLabel(t, file.type || 'unknown')}
            </span>
            <span className={styles.fileName}>{file.name}</span>
          </div>

          <div className={styles.cardMeta}>
            <span>
              {t('auth_files.file_size')}: {file.size ? formatFileSize(file.size) : '-'}
            </span>
            <span>
              {t('auth_files.file_modified')}: {formatModified(file)}
            </span>
          </div>

          <div className={styles.cardHealthRow}>
            <span className={`${styles.healthStatusBadge} ${healthStatusClass}`} title={healthStatusTitle}>
              {t('auth_files.health_status_label')}: {healthStatusLabel}
            </span>
            <span
              className={`${styles.lastRefreshText} ${isRefreshStale ? styles.lastRefreshStale : ''}`}
              title={lastRefreshTitle}
            >
              {t('auth_files.last_refresh_label')}: {lastRefreshText}
            </span>
          </div>
          {rawStatusMessage && hasStatusWarning && (
            <div className={styles.healthStatusMessage} title={rawStatusMessage}>
              {rawStatusMessage}
            </div>
          )}

          <div className={styles.cardStats}>
            <span className={`${styles.statPill} ${styles.statSuccess}`}>
              {t('stats.success')}: {fileStats.success}
            </span>
            <span className={`${styles.statPill} ${styles.statFailure}`}>
              {t('stats.failure')}: {fileStats.failure}
            </span>
          </div>

          <ProviderStatusBar statusData={statusData} styles={styles} />

          {showQuotaLayout && quotaType && (
            <AuthFileQuotaSection file={file} quotaType={quotaType} disableControls={disableControls} />
          )}

          <div className={styles.cardActions}>
            {showModelsButton && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onShowModels(file)}
                className={styles.iconButton}
                title={t('auth_files.models_button', { defaultValue: '模型' })}
                disabled={disableControls}
              >
                <IconBot className={styles.actionIcon} size={16} />
              </Button>
            )}
            {!isRuntimeOnly && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onShowDetails(file)}
                  className={styles.iconButton}
                  title={t('common.info', { defaultValue: '关于' })}
                  disabled={disableControls}
                >
                  <IconInfo className={styles.actionIcon} size={16} />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onDownload(file.name)}
                  className={styles.iconButton}
                  title={t('auth_files.download_button')}
                  disabled={disableControls}
                >
                  <IconDownload className={styles.actionIcon} size={16} />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenPrefixProxyEditor(file.name)}
                  className={styles.iconButton}
                  title={t('auth_files.prefix_proxy_button')}
                  disabled={disableControls}
                >
                  <IconCode className={styles.actionIcon} size={16} />
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => onDelete(file.name)}
                  className={styles.iconButton}
                  title={t('auth_files.delete_button')}
                  disabled={disableControls || deleting === file.name}
                >
                  {deleting === file.name ? (
                    <LoadingSpinner size={14} />
                  ) : (
                    <IconTrash2 className={styles.actionIcon} size={16} />
                  )}
                </Button>
              </>
            )}
            {!isRuntimeOnly && (
              <div className={styles.statusToggle}>
                <ToggleSwitch
                  ariaLabel={t('auth_files.status_toggle_label')}
                  checked={!file.disabled}
                  disabled={disableControls || statusUpdating[file.name] === true}
                  onChange={(value) => onToggleStatus(file, value)}
                />
              </div>
            )}
            {isRuntimeOnly && (
              <div className={styles.virtualBadge}>{t('auth_files.type_virtual') || '虚拟认证文件'}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
