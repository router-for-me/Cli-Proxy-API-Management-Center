/**
 * 单卡额度操作：刷新 + Codex 重置积分。
 * 流程 1:1 移植旧 QuotaSection（confirm modal、resetting 再入守卫、
 * generation-guarded commit、成功/失败通知），仅把 config 换成 adapter。
 */

import { useCallback, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
} from '@/stores';
import type { AuthFileItem } from '@/types';
import { isCredentialDisabled } from '@/features/authFiles/credentialFacts';
import { useQuotaStore, type QuotaStore } from '@/stores/useQuotaStore';
import type { SourceSession } from '@/services/api/sourceSession';
import { isQuotaSourceCurrent } from '../sourceCurrent';
import { resetAccountName } from '../logic';
import { getStatusFromError } from '@/utils/quota';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { enrichQuotaInBackground } from '../quotaEnrichment';
import { beginLoading } from '../quotaLoading';
import { isQuotaFresh } from '../quotaFreshness';
import { providerSources } from '@/stores/useProviderSources';
import { getQuotaMap, getQuotaSetter, type QuotaAdapter, type QuotaCardState } from '../providers';

const getQuotaState = (
  adapter: QuotaAdapter,
  file: AuthFileItem,
  store: QuotaStore
): QuotaCardState | undefined => getQuotaMap(adapter, store)[getQuotaCacheKey(file)];

export function useQuotaActions(
  disableControls: boolean,
  store: QuotaStore = useQuotaStore,
  session?: SourceSession
) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [resettingQuotaName, setResettingQuotaName] = useState<string | null>(null);

  const refreshQuota = useCallback(
    /** force: after a reset claim, whose result the last reading cannot show. */
    async (file: AuthFileItem, adapter: QuotaAdapter, options?: { force?: boolean }) => {
      // A disabled credential is read like any other: reading quota is not using the account.
      if (disableControls || !isQuotaSourceCurrent(session)) return;
      const cacheKey = getQuotaCacheKey(file);
      if (resettingQuotaName === cacheKey) return;
      if (getQuotaState(adapter, file, store)?.status === 'loading') return;
      if (!options?.force && isQuotaFresh(store.getState().fetchedAt[cacheKey], Date.now())) {
        showNotification(t('auth_files.quota_reused', { name: file.name }), 'info');
        return;
      }
      // Several requests per card (Claude: usage and profile): the hub proves the key first.
      providerSources.armAuthProbes();
      const cacheGeneration = captureQuotaCacheGeneration(file.name, store);
      const setQuota = getQuotaSetter(adapter, store);
      const release = beginLoading(adapter, store, [cacheKey]);

      try {
        const data = await adapter.fetchQuota(file, t);
        if (!isQuotaSourceCurrent(session)) return release();
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          const successState = adapter.buildSuccessState(data);
          setQuota((prev) => ({
            ...prev,
            [cacheKey]: successState,
          }));
          void enrichQuotaInBackground(adapter, file, data, successState, t, store);
          showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
        });
      } catch (err: unknown) {
        if (!isQuotaSourceCurrent(session)) return release();
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
    [disableControls, resettingQuotaName, showNotification, t, store, session]
  );

  const resetQuota = useCallback(
    (
      file: AuthFileItem,
      adapter: QuotaAdapter,
      /** Replaces the standard wording, e.g. to warn that usage is still left. */
      prompt?: {
        message: ReactNode;
        confirmText: string;
        variant: 'danger' | 'primary';
        title?: string;
        pill?: boolean;
      }
    ) => {
      const resetQuotaFn = adapter.resetQuota;
      if (!resetQuotaFn) return;
      // Spending a reset is using the account, so a disabled one keeps it.
      if (disableControls || isCredentialDisabled(file) || !isQuotaSourceCurrent(session)) return;
      const cacheKey = getQuotaCacheKey(file);
      if (getQuotaState(adapter, file, store)?.status === 'loading') return;
      if (resettingQuotaName === cacheKey) return;

      const cacheGeneration = captureQuotaCacheGeneration(file.name, store);
      const name = resetAccountName(file);
      showConfirmation({
        title: prompt?.title ?? t('quota_pool.reset_confirm_title'),
        message: prompt?.message ?? t('codex_quota.reset_confirm_message', { name }),
        confirmText: prompt?.confirmText ?? t('quota_pool.use_reset'),
        variant: prompt?.variant ?? 'primary',
        pill: prompt?.pill,
        onConfirm: async () => {
          if (
            !isQuotaSourceCurrent(session) ||
            !commitIfQuotaCacheCurrent(cacheGeneration, () => {})
          )
            return;
          const setQuota = getQuotaSetter(adapter, store);
          setResettingQuotaName(cacheKey);
          try {
            const data = await resetQuotaFn(file, t);
            if (!isQuotaSourceCurrent(session)) return;
            commitIfQuotaCacheCurrent(cacheGeneration, () => {
              setQuota((prev) => ({
                ...prev,
                [cacheKey]: adapter.buildSuccessState(data),
              }));
              showNotification(t('codex_quota.reset_success', { name }), 'success');
            });
          } catch (err: unknown) {
            if (!isQuotaSourceCurrent(session)) return;
            const message = err instanceof Error ? err.message : t('common.unknown_error');
            commitIfQuotaCacheCurrent(cacheGeneration, () => {
              showNotification(t('codex_quota.reset_failed', { name, message }), 'error');
            });
          } finally {
            setResettingQuotaName((current) => (current === cacheKey ? null : current));
          }
        },
      });
    },
    [disableControls, resettingQuotaName, showConfirmation, showNotification, t, store, session]
  );

  return { resettingQuotaName, refreshQuota, resetQuota };
}
