import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
  useQuotaStore,
} from '@/stores';
import type { AuthFileItem } from '@/types';
import { apiClient } from '@/services/api/client';
import { getCodexResetView } from '@/features/quota/providers/codex/reset';
import { useCodexResetView } from '@/features/quota/hooks/useCodexResetView';
import {
  canRunCodexResetAction,
  codexResetSuccessKey,
  commitIfCodexResetCurrent,
  getCodexResetPresentation,
  getDefaultResetPresentation,
  isCodexResetActionCurrent,
  performCodexResetAction,
} from '@/features/quota/providers/codex/resetUi';
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
};

export function AuthFileQuotaSection(props: AuthFileQuotaSectionProps) {
  const { file, quotaType, disableControls } = props;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [resettingQuota, setResettingQuota] = useState(false);
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
  const resetView = useCodexResetView(file, adapter.type === 'codex');
  const canStartReset = quota?.status === 'success' && Boolean(adapter.canResetQuota?.(quota));
  const resetUi = resetView
    ? getCodexResetPresentation(resetView, canStartReset)
    : getDefaultResetPresentation(canStartReset);
  const codexBusy = resetView?.busy ?? false;
  const resetButtonKey = resetUi.buttonKey;

  const updateQuotaState = useQuotaStore(
    (state) => state[adapter.storeSetter] as unknown as QuotaMapUpdater
  );

  const refreshQuotaForFile = useCallback(async () => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (quota?.status === 'loading') return;
    if (quotaType === 'codex' && getCodexResetView(file).busy) return;

    const cacheGeneration = captureQuotaCacheGeneration(file.name);

    updateQuotaState((prev) => ({
      ...prev,
      [cacheKey]: adapter.buildLoadingState(),
    }));

    try {
      const data = await adapter.fetchQuota(file, t);
      commitIfQuotaCacheCurrent(cacheGeneration, () => {
        updateQuotaState((prev) => ({
          ...prev,
          [cacheKey]: adapter.buildSuccessState(data),
        }));
        showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      commitIfQuotaCacheCurrent(cacheGeneration, () => {
        updateQuotaState((prev) => ({
          ...prev,
          [cacheKey]: adapter.buildErrorState(message, status),
        }));
        showNotification(
          t('auth_files.quota_refresh_failed', { name: file.name, message }),
          'error'
        );
      });
    }
  }, [
    adapter,
    cacheKey,
    disableControls,
    file,
    quota?.status,
    quotaType,
    showNotification,
    t,
    updateQuotaState,
  ]);

  const resetQuotaForFile = useCallback(() => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (quota?.status === 'loading') return;
    if (resettingQuota) return;

    const resetQuota = adapter.resetQuota;
    if (!resetQuota) return;

    const cacheGeneration = captureQuotaCacheGeneration(file.name);
    const connectionRevision = apiClient.getConnectionRevision();
    const currentResetView = adapter.type === 'codex' ? getCodexResetView(file) : undefined;
    if (currentResetView ? !canRunCodexResetAction(file, currentResetView) : file.disabled) return;
    const canStart = quota?.status === 'success' && Boolean(adapter.canResetQuota?.(quota));
    const currentResetUi = currentResetView
      ? getCodexResetPresentation(currentResetView, canStart)
      : getDefaultResetPresentation(canStart);
    if (currentResetUi.disabled || !currentResetUi.show) return;
    showConfirmation({
      title: t(currentResetUi.titleKey),
      message: t(currentResetUi.confirmationKey, { name: file.name }),
      confirmText: t(currentResetUi.confirmButtonKey),
      variant: 'primary',
      onConfirm: async () => {
        if (
          connectionRevision !== apiClient.getConnectionRevision() ||
          !commitIfQuotaCacheCurrent(cacheGeneration, () => {}) ||
          (currentResetView && !isCodexResetActionCurrent(file, currentResetView))
        )
          return;
        setResettingQuota(true);
        try {
          const result = currentResetView
            ? await performCodexResetAction(currentResetView, file, t, () => resetQuota(file, t))
            : { kind: 'quota' as const, data: await resetQuota(file, t) };
          if (!result) return;
          commitIfCodexResetCurrent(connectionRevision, cacheGeneration, () => {
            if (result.kind === 'quota') {
              updateQuotaState((prev) => ({
                ...prev,
                [cacheKey]: adapter.buildSuccessState(result.data),
              }));
            }
            showNotification(
              t(codexResetSuccessKey[result.kind], {
                name: file.name,
              }),
              'success'
            );
          });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('common.unknown_error');
          commitIfCodexResetCurrent(connectionRevision, cacheGeneration, () => {
            showNotification(t('codex_quota.reset_failed', { name: file.name, message }), 'error');
          });
        } finally {
          setResettingQuota(false);
        }
      },
    });
  }, [
    adapter,
    cacheKey,
    disableControls,
    file,
    quota,
    resettingQuota,
    showConfirmation,
    showNotification,
    t,
    updateQuotaState,
  ]);

  const quotaStatus = quota?.status ?? 'idle';
  const canRefreshQuota = !disableControls && !file.disabled && !resettingQuota && !codexBusy;
  const canUseResetQuota =
    !disableControls &&
    !resettingQuota &&
    !codexBusy &&
    quotaStatus !== 'loading' &&
    (resetView ? canRunCodexResetAction(file, resetView) : !file.disabled);
  const showResetQuotaAction =
    quotaType === 'codex'
      ? resetUi.show
      : quota !== undefined && Boolean(adapter.canResetQuota?.(quota));
  const resetQuotaAction =
    adapter.resetQuota && showResetQuotaAction ? (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={styles.quotaResetCreditButton}
        onClick={() => resetQuotaForFile()}
        disabled={!canUseResetQuota || resetUi.disabled}
        loading={resettingQuota || codexBusy}
        title={t(resetButtonKey)}
        aria-label={t(resetButtonKey)}
      >
        {!resettingQuota && !codexBusy && <IconRefreshCw size={14} />}
        {t(resetButtonKey)}
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
        <adapter.Body quota={quota} classes={compactQuotaClasses} />
      ) : (
        <div className={styles.quotaMessage}>{t(`${adapter.i18nPrefix}.idle`)}</div>
      )}
      {quotaType === 'codex' && resetUi.show && (resetUi.descriptionKey || resetUi.reasonKey) && (
        <div className={styles.quotaMessage} role="status">
          {resetUi.descriptionKey && <div>{t(resetUi.descriptionKey)}</div>}
          {resetUi.reasonKey && <div>{t(resetUi.reasonKey, resetUi.reasonParams)}</div>}
        </div>
      )}
      {(resetQuotaAction || (quotaStatus !== 'idle' && quotaType === 'devin')) && (
        <div className={styles.quotaCardActions}>
          {resetQuotaAction}
          {quotaType === 'devin' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className={styles.quotaResetCreditButton}
              onClick={() => void refreshQuotaForFile()}
              disabled={!canRefreshQuota || quotaStatus === 'loading'}
              loading={quotaStatus === 'loading'}
              title={t('auth_files.quota_refresh_hint')}
            >
              {quotaStatus !== 'loading' && <IconRefreshCw size={14} />}
              {t('auth_files.quota_refresh_single')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
