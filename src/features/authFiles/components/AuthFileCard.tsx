import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconBot,
  IconCheck,
  IconCode,
  IconDownload,
  IconInfo,
  IconTrash2,
} from '@/components/ui/icons';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import type { AuthFileItem } from '@/types';
import { resolveAuthProvider } from '@/utils/quota';
import { calculateStatusBarData, normalizeAuthIndex, type KeyStats } from '@/utils/usage';
import { formatFileSize } from '@/utils/format';
import {
  QUOTA_PROVIDER_TYPES,
  formatModified,
  getTypeColor,
  getTypeLabel,
  isRuntimeOnlyAuthFile,
  resolveAuthFileStats,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import type { AuthFileStatusBarData } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import { AuthFileQuotaSection } from '@/features/authFiles/components/AuthFileQuotaSection';
import styles from '@/pages/AuthFilesPage.module.scss';

const HEALTHY_STATUS_MESSAGES = new Set(['ok', 'healthy', 'ready', 'success', 'available']);

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
  onShowModels: (file: AuthFileItem) => void;
  onShowDetails: (file: AuthFileItem) => void;
  onDownload: (name: string) => void;
  onOpenPrefixProxyEditor: (file: AuthFileItem) => void;
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
  const { t } = useTranslation();
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
    onShowModels,
    onShowDetails,
    onDownload,
    onOpenPrefixProxyEditor,
    onDelete,
    onToggleStatus,
    onToggleSelect,
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
  const rawStatusMessage = String(file['status_message'] ?? file.statusMessage ?? '').trim();
  const hasStatusWarning =
    Boolean(rawStatusMessage) && !HEALTHY_STATUS_MESSAGES.has(rawStatusMessage.toLowerCase());

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
                aria-label={
                  selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')
                }
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
                ...(typeColor.border ? { border: typeColor.border } : {}),
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
            <AuthFileQuotaSection
              file={file}
              quotaType={quotaType}
              disableControls={disableControls}
            />
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
                  onClick={() => onOpenPrefixProxyEditor(file)}
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
              <div className={styles.virtualBadge}>
                {t('auth_files.type_virtual') || '虚拟认证文件'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
