/**
 * 单卡额度操作：刷新 + Codex 重置积分。
 * 流程 1:1 移植旧 QuotaSection（confirm modal、resetting 再入守卫、
 * generation-guarded commit、成功/失败通知），仅把 config 换成 adapter。
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
} from '@/stores';
import type { AuthFileItem } from '@/types';
import { apiClient } from '@/services/api/client';
import { getCodexResetView } from '../providers/codex/reset';
import {
  canRunCodexResetAction,
  codexResetSuccessKey,
  commitIfCodexResetCurrent,
  getCodexResetPresentation,
  getDefaultResetPresentation,
  isCodexResetActionCurrent,
  performCodexResetAction,
} from '../providers/codex/resetUi';
import { getStatusFromError } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { enrichQuotaInBackground } from '../quotaEnrichment';
import { getQuotaMap, getQuotaSetter, type QuotaAdapter, type QuotaCardState } from '../providers';

const getQuotaState = (adapter: QuotaAdapter, file: AuthFileItem): QuotaCardState | undefined =>
  getQuotaMap(adapter)[getQuotaCacheKey(file)];

export function useQuotaActions(disableControls: boolean) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [resettingQuotaName, setResettingQuotaName] = useState<string | null>(null);

  const refreshQuota = useCallback(
    async (file: AuthFileItem, adapter: QuotaAdapter) => {
      if (disableControls || file.disabled) return;
      const cacheKey = getQuotaCacheKey(file);
      if (resettingQuotaName === cacheKey) return;
      if (adapter.type === 'codex' && getCodexResetView(file).busy) return;
      if (getQuotaState(adapter, file)?.status === 'loading') return;
      const cacheGeneration = captureQuotaCacheGeneration(file.name);
      const setQuota = getQuotaSetter(adapter);

      setQuota((prev) => ({
        ...prev,
        [cacheKey]: adapter.buildLoadingState(),
      }));

      try {
        const data = await adapter.fetchQuota(file, t);
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          const successState = adapter.buildSuccessState(data);
          setQuota((prev) => ({
            ...prev,
            [cacheKey]: successState,
          }));
          void enrichQuotaInBackground(adapter, file, data, successState, t);
          showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          setQuota((prev) => ({
            ...prev,
            [cacheKey]: adapter.buildErrorState(message, status),
          }));
          showNotification(
            t('auth_files.quota_refresh_failed', { name: file.name, message }),
            'error'
          );
        });
      }
    },
    [disableControls, resettingQuotaName, showNotification, t]
  );

  const resetQuota = useCallback(
    (file: AuthFileItem, adapter: QuotaAdapter) => {
      const resetQuotaFn = adapter.resetQuota;
      if (!resetQuotaFn) return;
      if (disableControls) return;
      const cacheKey = getQuotaCacheKey(file);
      if (getQuotaState(adapter, file)?.status === 'loading') return;
      if (resettingQuotaName === cacheKey) return;

      const cacheGeneration = captureQuotaCacheGeneration(file.name);
      const connectionRevision = apiClient.getConnectionRevision();
      const resetView = adapter.type === 'codex' ? getCodexResetView(file) : undefined;
      if (resetView ? !canRunCodexResetAction(file, resetView) : file.disabled) return;
      const quota = getQuotaState(adapter, file);
      const canStart = quota?.status === 'success' && Boolean(adapter.canResetQuota?.(quota));
      const resetUi = resetView
        ? getCodexResetPresentation(resetView, canStart)
        : getDefaultResetPresentation(canStart);
      if (resetUi.disabled || !resetUi.show) return;
      showConfirmation({
        title: t(resetUi.titleKey),
        message: t(resetUi.confirmationKey, { name: file.name }),
        confirmText: t(resetUi.confirmButtonKey),
        variant: 'primary',
        onConfirm: async () => {
          if (
            connectionRevision !== apiClient.getConnectionRevision() ||
            !commitIfQuotaCacheCurrent(cacheGeneration, () => {}) ||
            (resetView && !isCodexResetActionCurrent(file, resetView))
          )
            return;
          const setQuota = getQuotaSetter(adapter);
          setResettingQuotaName(cacheKey);
          try {
            const result = resetView
              ? await performCodexResetAction(resetView, file, t, () => resetQuotaFn(file, t))
              : { kind: 'quota' as const, data: await resetQuotaFn(file, t) };
            if (!result) return;
            commitIfCodexResetCurrent(connectionRevision, cacheGeneration, () => {
              if (result.kind === 'quota') {
                setQuota((prev) => ({
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
              showNotification(
                t('codex_quota.reset_failed', { name: file.name, message }),
                'error'
              );
            });
          } finally {
            setResettingQuotaName((current) => (current === cacheKey ? null : current));
          }
        },
      });
    },
    [disableControls, resettingQuotaName, showConfirmation, showNotification, t]
  );

  return { resettingQuotaName, refreshQuota, resetQuota };
}
