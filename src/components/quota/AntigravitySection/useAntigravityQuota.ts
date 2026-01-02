/**
 * Hook for Antigravity quota data fetching and management.
 */

import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { useQuotaStore } from '@/stores';
import type { AntigravityQuotaGroup, AntigravityModelsPayload, AuthFileItem } from '@/types';
import {
  ANTIGRAVITY_QUOTA_URLS,
  ANTIGRAVITY_REQUEST_HEADERS,
  normalizeAuthIndexValue,
  parseAntigravityPayload,
  buildAntigravityQuotaGroups,
  createStatusError,
  getStatusFromError
} from '@/utils/quota';

interface UseAntigravityQuotaReturn {
  quota: Record<string, import('@/types').AntigravityQuotaState>;
  loadQuota: (
    targets: AuthFileItem[],
    scope: 'page' | 'all',
    setLoading: (loading: boolean, scope?: 'page' | 'all' | null) => void
  ) => Promise<void>;
}

export function useAntigravityQuota(): UseAntigravityQuotaReturn {
  const { t } = useTranslation();
  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const setAntigravityQuota = useQuotaStore((state) => state.setAntigravityQuota);

  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);

  const fetchQuota = useCallback(
    async (authIndex: string): Promise<AntigravityQuotaGroup[]> => {
      let lastError = '';
      let lastStatus: number | undefined;
      let priorityStatus: number | undefined;
      let hadSuccess = false;

      for (const url of ANTIGRAVITY_QUOTA_URLS) {
        try {
          const result = await apiCallApi.request({
            authIndex,
            method: 'POST',
            url,
            header: { ...ANTIGRAVITY_REQUEST_HEADERS },
            data: '{}'
          });

          if (result.statusCode < 200 || result.statusCode >= 300) {
            lastError = getApiCallErrorMessage(result);
            lastStatus = result.statusCode;
            if (result.statusCode === 403 || result.statusCode === 404) {
              priorityStatus ??= result.statusCode;
            }
            continue;
          }

          hadSuccess = true;
          const payload = parseAntigravityPayload(result.body ?? result.bodyText);
          const models = payload?.models;
          if (!models || typeof models !== 'object' || Array.isArray(models)) {
            lastError = t('antigravity_quota.empty_models');
            continue;
          }

          const groups = buildAntigravityQuotaGroups(models as AntigravityModelsPayload);
          if (groups.length === 0) {
            lastError = t('antigravity_quota.empty_models');
            continue;
          }

          return groups;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err.message : t('common.unknown_error');
          const status = getStatusFromError(err);
          if (status) {
            lastStatus = status;
            if (status === 403 || status === 404) {
              priorityStatus ??= status;
            }
          }
        }
      }

      if (hadSuccess) {
        return [];
      }

      throw createStatusError(lastError || t('common.unknown_error'), priorityStatus ?? lastStatus);
    },
    [t]
  );

  const loadQuota = useCallback(
    async (
      targets: AuthFileItem[],
      scope: 'page' | 'all',
      setLoading: (loading: boolean, scope?: 'page' | 'all' | null) => void
    ) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const requestId = ++requestIdRef.current;
      setLoading(true, scope);

      try {
        if (targets.length === 0) return;

        setAntigravityQuota((prev) => {
          const nextState = { ...prev };
          targets.forEach((file) => {
            nextState[file.name] = { status: 'loading', groups: [] };
          });
          return nextState;
        });

        const results = await Promise.all(
          targets.map(async (file) => {
            const rawAuthIndex = file['auth_index'] ?? file.authIndex;
            const authIndex = normalizeAuthIndexValue(rawAuthIndex);
            if (!authIndex) {
              return {
                name: file.name,
                status: 'error' as const,
                error: t('antigravity_quota.missing_auth_index')
              };
            }

            try {
              const groups = await fetchQuota(authIndex);
              return { name: file.name, status: 'success' as const, groups };
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : t('common.unknown_error');
              const errorStatus = getStatusFromError(err);
              return { name: file.name, status: 'error' as const, error: message, errorStatus };
            }
          })
        );

        if (requestId !== requestIdRef.current) return;

        setAntigravityQuota((prev) => {
          const nextState = { ...prev };
          results.forEach((result) => {
            if (result.status === 'success') {
              nextState[result.name] = {
                status: 'success',
                groups: result.groups
              };
            } else {
              nextState[result.name] = {
                status: 'error',
                groups: [],
                error: result.error,
                errorStatus: result.errorStatus
              };
            }
          });
          return nextState;
        });
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          loadingRef.current = false;
        }
      }
    },
    [fetchQuota, setAntigravityQuota, t]
  );

  return { quota: antigravityQuota, loadQuota };
}
