import { AuthFileObservation } from '@/features/quota/authFileObservation';
import { withQuotaObservation } from '@/features/quota/observationFormat';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
  useQuotaStore,
} from '@/stores';
import type { AuthFileItem } from '@/types';
import { getStatusFromError, resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { isRuntimeOnlyAuthFile, type QuotaProviderType } from '@/features/authFiles/constants';
import { Button } from '@/components/ui/Button';
import { IconRefreshCw } from '@/components/ui/icons';
import { bindQuotaClasses } from '@/features/quota/types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '@/features/quota/providers';
import styles from './AuthFileQuota.module.scss';

/** 认证文件卡片外衣：紧凑额度样式绑定成类型化契约（缺键在模块初始化即抛）。 */
const compactQuotaClasses = bindQuotaClasses(styles, 'AuthFileQuota.module.scss');

const assertNever = (value: never): never => {
  throw new Error(`Unsupported quota type: ${value}`);
};

type QuotaMapUpdater = (
  updater: (prev: Record<string, QuotaCardState>) => Record<string, QuotaCardState>
) => void;

export type AuthFileQuotaSectionProps = {
  file: AuthFileItem;
  quotaType: QuotaProviderType;
  disableControls: boolean;
  onRefreshingChange?: (refreshing: boolean) => void;
};

export function AuthFileQuotaSection(props: AuthFileQuotaSectionProps) {
  const { file, quotaType, disableControls, onRefreshingChange } = props;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [resettingQuota, setResettingQuota] = useState(false);
  const [refreshingQuota, setRefreshingQuota] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const pendingRefresh = useRef(false);
  const adapter = QUOTA_ADAPTERS[quotaType];
  const cacheKey = getQuotaCacheKey(file);

  const storedQuota = useQuotaStore((state) => {
    if (quotaType === 'antigravity')
      return state.antigravityQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'claude') return state.claudeQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'codex') return state.codexQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'devin') return state.devinQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'kimi') return state.kimiQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'meta') return state.metaQuota[cacheKey] as QuotaCardState | undefined;
    if (quotaType === 'xai') return state.xaiQuota[cacheKey] as QuotaCardState | undefined;
    return assertNever(quotaType);
  });
  const quota = storedQuota;

  const updateQuotaState = useQuotaStore(
    (state) => state[adapter.storeSetter] as unknown as QuotaMapUpdater
  );

  const refreshQuotaForFile = useCallback(async () => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (resettingQuota || pendingRefresh.current) return;
    if (quota?.status === 'loading') return;

    const cacheGeneration = captureQuotaCacheGeneration(file.name);
    pendingRefresh.current = true;
    setRefreshingQuota(true);
    onRefreshingChange?.(true);
    setRefreshError('');

    if (quota?.status !== 'success')
      updateQuotaState((prev) => ({
        ...prev,
        [cacheKey]: adapter.buildLoadingState(),
      }));

    try {
      const data = await adapter.fetchQuota(file, t);
      commitIfQuotaCacheCurrent(cacheGeneration, () => {
        updateQuotaState((prev) => ({
          ...prev,
          [cacheKey]: withQuotaObservation(
            adapter.buildSuccessState(data),
            new Date().toISOString()
          ),
        }));
        showNotification(t('auth_files.account_refresh_success', { name: file.name }), 'success');
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      commitIfQuotaCacheCurrent(cacheGeneration, () => {
        setRefreshError(message);
        if (quota?.status !== 'success') {
          updateQuotaState((prev) => ({
            ...prev,
            [cacheKey]: adapter.buildErrorState(message, status),
          }));
        }
        showNotification(
          t('auth_files.account_refresh_failed', { name: file.name, message }),
          'error'
        );
      });
    } finally {
      pendingRefresh.current = false;
      setRefreshingQuota(false);
      onRefreshingChange?.(false);
    }
  }, [
    adapter,
    cacheKey,
    disableControls,
    file,
    quota?.status,
    resettingQuota,
    onRefreshingChange,
    showNotification,
    t,
    updateQuotaState,
  ]);

  const resetQuotaForFile = useCallback(() => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (quota?.status === 'loading') return;
    if (resettingQuota) return;
    if (pendingRefresh.current) return;

    const resetQuota = adapter.resetQuota;
    if (!resetQuota) return;

    showConfirmation({
      title: t('codex_quota.reset_confirm_title'),
      message: t('codex_quota.reset_confirm_message', { name: file.name }),
      confirmText: t('codex_quota.reset_confirm_button'),
      variant: 'primary',
      onConfirm: async () => {
        if (pendingRefresh.current) return;
        pendingRefresh.current = true;
        const cacheGeneration = captureQuotaCacheGeneration(file.name);
        setResettingQuota(true);
        onRefreshingChange?.(true);
        try {
          const data = await resetQuota(file, t);
          commitIfQuotaCacheCurrent(cacheGeneration, () => {
            updateQuotaState((prev) => ({
              ...prev,
              [cacheKey]: withQuotaObservation(
                adapter.buildSuccessState(data),
                new Date().toISOString()
              ),
            }));
            showNotification(t('codex_quota.reset_success', { name: file.name }), 'success');
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('common.unknown_error');
          commitIfQuotaCacheCurrent(cacheGeneration, () => {
            showNotification(t('codex_quota.reset_failed', { name: file.name, message }), 'error');
          });
        } finally {
          pendingRefresh.current = false;
          setResettingQuota(false);
          onRefreshingChange?.(false);
        }
      },
    });
  }, [
    adapter,
    cacheKey,
    disableControls,
    file,
    quota?.status,
    resettingQuota,
    onRefreshingChange,
    showConfirmation,
    showNotification,
    t,
    updateQuotaState,
  ]);

  const quotaStatus = quota?.status ?? 'idle';
  const canRefreshQuota = !disableControls && !file.disabled && !resettingQuota && !refreshingQuota;
  const canUseResetQuota = canRefreshQuota && quotaStatus !== 'loading';
  const showResetQuotaAction = quota !== undefined && Boolean(adapter.canResetQuota?.(quota));
  const resetQuotaAction =
    adapter.resetQuota && showResetQuotaAction ? (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={styles.quotaResetCreditButton}
        onClick={() => resetQuotaForFile()}
        disabled={!canUseResetQuota}
        loading={resettingQuota}
        title={t('codex_quota.reset_button')}
        aria-label={t('codex_quota.reset_button')}
      >
        {!resettingQuota && <IconRefreshCw size={14} />}
        {t('codex_quota.reset_button')}
      </Button>
    ) : undefined;
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );

  return (
    <div className={styles.quotaSection}>
      {quotaStatus === 'loading' ? (
        <div className={styles.quotaMessage}>{t(`${adapter.i18nPrefix}.loading`)}</div>
      ) : quotaStatus === 'idle' ? (
        <button
          type="button"
          className={`${styles.quotaMessage} ${styles.quotaMessageAction}`}
          onClick={() => void refreshQuotaForFile()}
          disabled={!canRefreshQuota}
        >
          {t(`${adapter.i18nPrefix}.idle`)}
        </button>
      ) : quotaStatus === 'error' ? (
        <div className={styles.quotaError}>
          {t(`${adapter.i18nPrefix}.load_failed`, {
            message: quotaErrorMessage,
          })}
        </div>
      ) : quota ? (
        <AuthFileObservation.Provider value={quota}>
          <div className={styles.nativeQuotaBody}>
            <adapter.Body quota={quota} classes={compactQuotaClasses} />
          </div>
        </AuthFileObservation.Provider>
      ) : (
        <div className={styles.quotaMessage}>{t(`${adapter.i18nPrefix}.idle`)}</div>
      )}
      {
        <div className={styles.quotaCardActions}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={styles.quotaResetCreditButton}
            onClick={() => void refreshQuotaForFile()}
            disabled={!canRefreshQuota || quotaStatus === 'loading' || isRuntimeOnlyAuthFile(file)}
            loading={refreshingQuota || quotaStatus === 'loading'}
            title={t('auth_files.account_refresh_hint')}
          >
            {!refreshingQuota && quotaStatus !== 'loading' && <IconRefreshCw size={14} />}
            {t('auth_files.account_refresh_button')}
          </Button>
          {resetQuotaAction}
        </div>
      }
      {refreshError && quotaStatus === 'success' && (
        <div className={styles.quotaError} role="alert">
          {t('auth_files.account_refresh_failed', { message: refreshError })}
        </div>
      )}
    </div>
  );
}
