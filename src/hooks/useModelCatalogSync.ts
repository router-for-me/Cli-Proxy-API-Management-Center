import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient, modelsApi } from '@/services/api';
import { useAuthStore, useNotificationStore } from '@/stores';
import { useModelsStore } from '@/stores/useModelsStore';
import { getErrorMessage, isRecord } from '@/utils/helpers';

/** Share the global operation while each active view refreshes its own model-derived data. */
export function useModelCatalogSync(onSynced: () => void | Promise<void>) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [syncingModelCatalog, setSyncingModelCatalog] = useState(false);
  const operationRef = useRef<AbortController | null>(null);
  const onSyncedRef = useRef(onSynced);
  useEffect(() => {
    onSyncedRef.current = onSynced;
  }, [onSynced]);

  useEffect(() => {
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if (
        next.apiBase !== previous.apiBase ||
        next.managementKey !== previous.managementKey ||
        next.connectionStatus !== previous.connectionStatus
      ) {
        operationRef.current?.abort();
        operationRef.current = null;
        setSyncingModelCatalog(false);
      }
    });
    return () => {
      unsubscribe();
      operationRef.current?.abort();
      operationRef.current = null;
    };
  }, []);

  const syncModelCatalog = useCallback(async () => {
    if (operationRef.current || useAuthStore.getState().connectionStatus !== 'connected') return;
    const controller = new AbortController();
    operationRef.current = controller;
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () =>
      operationRef.current === controller &&
      revision === apiClient.getConnectionRevision() &&
      useAuthStore.getState().connectionStatus === 'connected';
    setSyncingModelCatalog(true);
    try {
      const refreshed = await modelsApi.refreshCatalog({ signal: controller.signal, isCurrent });
      if (!isCurrent()) return;
      if (refreshed.catalogs.some((catalog) => catalog.state === 'refreshed')) {
        useModelsStore.getState().invalidateCache();
        await onSyncedRef.current();
      }
      if (!isCurrent()) return;
      const providers = refreshed.changedProviders.length
        ? ` ${t('model_catalog.changed_providers', { providers: refreshed.changedProviders.join(', ') })}`
        : '';
      const failure =
        refreshed.outcome === 'partial' || refreshed.outcome === 'error'
          ? refreshed.error || refreshed.catalogs.find((catalog) => catalog.error)?.error
          : undefined;
      showNotification(
        `${t(`model_catalog.${refreshed.outcome}`)}${providers}${failure ? ` ${failure}` : ''}`,
        refreshed.outcome === 'partial'
          ? 'warning'
          : refreshed.outcome === 'skipped'
            ? 'info'
            : refreshed.outcome === 'error'
              ? 'error'
              : 'success'
      );
    } catch (err: unknown) {
      if (!isCurrent()) return;
      const unsupported = isRecord(err) && (err.status === 404 || err.status === 405);
      const message = t(unsupported ? 'model_catalog.unsupported' : 'model_catalog.error');
      const detail = unsupported ? '' : getErrorMessage(err);
      showNotification(`${message}${detail ? `: ${detail}` : ''}`, 'error');
    } finally {
      if (operationRef.current === controller) {
        operationRef.current = null;
        setSyncingModelCatalog(false);
      }
    }
  }, [showNotification, t]);

  return { syncingModelCatalog, syncModelCatalog };
}
