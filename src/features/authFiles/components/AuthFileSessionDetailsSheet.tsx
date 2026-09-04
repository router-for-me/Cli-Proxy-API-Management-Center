import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import {
  IconDollarSign,
  IconInfo,
  IconModelCluster,
  IconSatellite,
  IconSettings,
} from '@/components/ui/icons';
import { Sheet } from '@/components/ui/Sheet';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { AuthFileModelsPanel } from '@/features/authFiles/components/AuthFileModelsPanel';
import { AuthFileSessionUsage } from '@/features/authFiles/components/AuthFileSessionUsage';
import { AuthFileManagementQuota } from '@/features/authFiles/components/AuthFileManagementQuota';
import { deriveAuthFileIdentity } from '@/features/authFiles/identity';
import {
  getTypeLabel,
  getAuthFileStatusMessage,
  hasAuthFileStatusWarning,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  type AuthFileModelItem,
} from '@/features/authFiles/constants';
import type {
  AuthFileItem,
  CredentialSessionUsage,
  ManagementQuotaCredentialDetails,
  ManagementQuotaCredentialSnapshot,
} from '@/types';
import styles from './AuthFileSessionDetailsSheet.module.scss';

export type AuthFileSessionDetailsSheetProps = {
  file: AuthFileItem | null;
  usage?: CredentialSessionUsage;
  supported: boolean | null;
  disableControls: boolean;
  onClose: () => void;
  onPolicySaved: () => void;
  onOpenConfig: (file: AuthFileItem) => void;
  quotaSnapshot?: ManagementQuotaCredentialSnapshot;
  quotaDetails?: ManagementQuotaCredentialDetails;
  quotaLoading?: boolean;
  quotaCollecting?: boolean;
  onRefreshQuota?: () => void;
  modelsOpen: boolean;
  modelsLoading: boolean;
  modelsError: 'unsupported' | null;
  models: AuthFileModelItem[];
  modelsFileName: string;
  modelsFileType: string;
  excludedModels: Record<string, string[]>;
  onShowModels: (file: AuthFileItem) => void;
  onCopyText: (text: string) => void;
};

type AuthFileDrawerTab = 'overview' | 'session' | 'quota' | 'config' | 'models';

const DRAWER_TABS: Array<{
  id: AuthFileDrawerTab;
  labelKey: string;
  fallback: string;
  Icon: typeof IconInfo;
}> = [
  { id: 'overview', labelKey: 'auth_files.drawer_tab_overview', fallback: '概览', Icon: IconInfo },
  {
    id: 'session',
    labelKey: 'auth_files.drawer_tab_session',
    fallback: 'Seat / Session',
    Icon: IconSatellite,
  },
  { id: 'quota', labelKey: 'auth_files.drawer_tab_quota', fallback: '额度', Icon: IconDollarSign },
  { id: 'config', labelKey: 'auth_files.drawer_tab_config', fallback: '配置', Icon: IconSettings },
  {
    id: 'models',
    labelKey: 'auth_files.drawer_tab_models',
    fallback: '模型',
    Icon: IconModelCluster,
  },
];

const formatCount = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '-';

export function AuthFileSessionDetailsSheet({
  file,
  usage,
  supported,
  disableControls,
  onClose,
  onPolicySaved,
  onOpenConfig,
  quotaSnapshot,
  quotaDetails,
  quotaLoading,
  quotaCollecting,
  onRefreshQuota,
  modelsOpen,
  modelsLoading,
  modelsError,
  models,
  modelsFileName,
  modelsFileType,
  excludedModels,
  onShowModels,
  onCopyText,
}: AuthFileSessionDetailsSheetProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<AuthFileDrawerTab>('session');
  const tabRefs = useRef<Partial<Record<AuthFileDrawerTab, HTMLButtonElement | null>>>({});
  const identity = file ? deriveAuthFileIdentity(file) : null;
  const provider = file ? normalizeProviderKey(String(file.type ?? file.provider ?? '')) : '';
  const showModelsButton = file ? !isRuntimeOnlyAuthFile(file) || provider === 'aistudio' : false;
  const isCurrentModelsFile = modelsOpen && modelsFileName === file?.name;

  useEffect(() => {
    setActiveTab('session');
  }, [file?.name]);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const enabledTabs = DRAWER_TABS.filter((tab) => tab.id !== 'models' || showModelsButton);
    const currentIndex = enabledTabs.findIndex((tab) => tab.id === activeTab);
    let nextIndex = -1;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % enabledTabs.length;
    if (event.key === 'ArrowLeft')
      nextIndex = (currentIndex - 1 + enabledTabs.length) % enabledTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = enabledTabs.length - 1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextTab = enabledTabs[nextIndex].id;
    setActiveTab(nextTab);
    if (nextTab === 'models' && file && showModelsButton) void onShowModels(file);
    tabRefs.current[nextTab]?.focus();
  };

  const statusMessage = file ? getAuthFileStatusMessage(file) : '';
  const statusWarning = file ? hasAuthFileStatusWarning(file) : false;
  const statusLabel = file
    ? file.disabled
      ? t('auth_files.health_status_disabled')
      : statusWarning
        ? t('auth_files.health_status_warning')
        : t('auth_files.health_status_healthy')
    : '';
  const sessionSeatCount = usage?.seatCount ?? usage?.seats.length ?? 0;
  const activeRequests = usage?.activeRequestCount ?? 0;

  return (
    <Sheet
      open={Boolean(file)}
      onClose={onClose}
      size="lg"
      eyebrow={provider ? getTypeLabel(t, provider) : t('auth_files.session_usage_title')}
      title={identity?.primary ?? ''}
      description={identity?.fullName}
    >
      {file && (
        <>
          <div className={styles.tabs} role="tablist" aria-label={t('auth_files.account_details')}>
            {DRAWER_TABS.map(({ id, labelKey, fallback, Icon }) => {
              const isActive = activeTab === id;
              const disabled = id === 'models' && !showModelsButton;
              return (
                <button
                  key={id}
                  ref={(node) => {
                    tabRefs.current[id] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`auth-file-drawer-tab-${id}`}
                  aria-selected={isActive}
                  aria-controls={`auth-file-drawer-panel-${id}`}
                  tabIndex={isActive ? 0 : -1}
                  disabled={disabled}
                  className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
                  onClick={() => {
                    setActiveTab(id);
                    if (id === 'models' && file && showModelsButton) void onShowModels(file);
                  }}
                  onKeyDown={handleTabKeyDown}
                >
                  <Icon size={15} className={styles.tabIcon} />
                  <span>{t(labelKey, { defaultValue: fallback })}</span>
                  {id === 'models' && isCurrentModelsFile && models.length > 0 && (
                    <span className={styles.tabCount}>{models.length}</span>
                  )}
                </button>
              );
            })}
          </div>

          {activeTab === 'overview' && (
            <section
              id="auth-file-drawer-panel-overview"
              className={styles.tabPanel}
              role="tabpanel"
              aria-labelledby="auth-file-drawer-tab-overview"
            >
              <div className={styles.overviewIdentity}>
                <span className={styles.overviewProvider}>{getTypeLabel(t, provider)}</span>
                <strong>{identity?.primary}</strong>
                {identity?.secondary && <code title={identity.fullName}>{identity.secondary}</code>}
              </div>
              <div className={styles.overviewMetrics}>
                <div className={styles.metric}>
                  <span>{t('auth_files.drawer_metric_health', { defaultValue: '健康状态' })}</span>
                  <strong className={statusWarning ? styles.metricWarning : ''}>
                    {statusLabel}
                  </strong>
                </div>
                <div className={styles.metric}>
                  <span>
                    {t('auth_files.drawer_metric_seats', { defaultValue: 'Session Seat' })}
                  </span>
                  <strong>{formatCount(sessionSeatCount)}</strong>
                </div>
                <div className={styles.metric}>
                  <span>
                    {t('auth_files.drawer_metric_requests', { defaultValue: '活跃 Request' })}
                  </span>
                  <strong>{formatCount(activeRequests)}</strong>
                </div>
              </div>
              <dl className={styles.metadata}>
                <div>
                  <dt>{t('auth_files.list_account')}</dt>
                  <dd>{identity?.primary || '-'}</dd>
                </div>
                <div>
                  <dt>{t('auth_files.file_name_label', { defaultValue: '认证文件' })}</dt>
                  <dd title={file.name}>{file.name}</dd>
                </div>
                <div>
                  <dt>{t('auth_files.auth_index_label', { defaultValue: '凭证索引' })}</dt>
                  <dd>{file.authIndex == null ? '-' : String(file.authIndex)}</dd>
                </div>
                {statusMessage && (
                  <div>
                    <dt>{t('auth_files.health_status_label')}</dt>
                    <dd>{statusMessage}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          {activeTab === 'session' && (
            <section
              id="auth-file-drawer-panel-session"
              className={styles.tabPanel}
              role="tabpanel"
              aria-labelledby="auth-file-drawer-tab-session"
            >
              {supported === null ? (
                <div className={styles.loading}>
                  <LoadingSpinner size={16} />
                  <span>{t('common.loading')}</span>
                </div>
              ) : supported === false || !usage ? (
                <p className={styles.empty}>{t('auth_files.session_usage_unavailable')}</p>
              ) : (
                <AuthFileSessionUsage
                  usage={usage}
                  disabled={disableControls}
                  onPolicySaved={onPolicySaved}
                />
              )}
            </section>
          )}

          {activeTab === 'quota' && (
            <section
              id="auth-file-drawer-panel-quota"
              className={styles.tabPanel}
              role="tabpanel"
              aria-labelledby="auth-file-drawer-tab-quota"
            >
              <AuthFileManagementQuota
                snapshot={quotaSnapshot}
                details={quotaDetails}
                loading={quotaLoading}
                collecting={quotaCollecting}
                disabled={disableControls}
                onRefresh={onRefreshQuota}
              />
            </section>
          )}

          {activeTab === 'config' && (
            <section
              id="auth-file-drawer-panel-config"
              className={styles.tabPanel}
              role="tabpanel"
              aria-labelledby="auth-file-drawer-tab-config"
            >
              <div className={styles.sectionHeader}>
                <div className={styles.sectionHeading}>
                  <span className={styles.sectionTitle}>
                    {t('auth_files.account_config_title', { defaultValue: '配置' })}
                  </span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenConfig(file)}
                  disabled={disableControls}
                >
                  <IconSettings size={14} />
                  {t('auth_files.account_config_button', { defaultValue: '配置' })}
                </Button>
              </div>
              <dl className={styles.metadata}>
                <div>
                  <dt>{t('auth_files.priority_label', { defaultValue: '优先级' })}</dt>
                  <dd>{file.priority == null ? '-' : String(file.priority)}</dd>
                </div>
                <div>
                  <dt>{t('auth_files.weight_label', { defaultValue: '权重' })}</dt>
                  <dd>{file.weight == null ? '-' : String(file.weight)}</dd>
                </div>
                <div>
                  <dt>{t('auth_files.note_label', { defaultValue: '备注' })}</dt>
                  <dd>{typeof file.note === 'string' && file.note.trim() ? file.note : '-'}</dd>
                </div>
              </dl>
            </section>
          )}

          {activeTab === 'models' && (
            <section
              id="auth-file-drawer-panel-models"
              className={styles.tabPanel}
              role="tabpanel"
              aria-labelledby="auth-file-drawer-tab-models"
            >
              {isCurrentModelsFile ? (
                <AuthFileModelsPanel
                  loading={modelsLoading}
                  error={modelsError}
                  models={models}
                  fileType={modelsFileType}
                  excluded={excludedModels}
                  onCopyText={onCopyText}
                />
              ) : (
                <div className={styles.loading}>
                  <LoadingSpinner size={16} />
                  <span>
                    {t('auth_files.models_loading', { defaultValue: '正在加载模型列表...' })}
                  </span>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </Sheet>
  );
}
