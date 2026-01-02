/**
 * Hook for Codex quota data fetching and management.
 */

import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { useQuotaStore } from '@/stores';
import type { AuthFileItem, CodexQuotaWindow, CodexUsagePayload } from '@/types';
import {
  CODEX_USAGE_URL,
  CODEX_REQUEST_HEADERS,
  normalizeAuthIndexValue,
  normalizeNumberValue,
  normalizePlanType,
  parseCodexUsagePayload,
  resolveCodexChatgptAccountId,
  resolveCodexPlanType,
  formatCodexResetLabel,
  createStatusError,
  getStatusFromError
} from '@/utils/quota';

interface UseCodexQuotaReturn {
  quota: Record<string, import('@/types').CodexQuotaState>;
  loadQuota: (
    targets: AuthFileItem[],
    scope: 'page' | 'all',
    setLoading: (loading: boolean, scope?: 'page' | 'all' | null) => void
  ) => Promise<void>;
}

export function useCodexQuota(): UseCodexQuotaReturn {
  const { t } = useTranslation();
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const setCodexQuota = useQuotaStore((state) => state.setCodexQuota);

  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);

  const buildQuotaWindows = useCallback(
    (payload: CodexUsagePayload): CodexQuotaWindow[] => {
      const rateLimit = payload.rate_limit ?? payload.rateLimit ?? undefined;
      const codeReviewLimit =
        payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? undefined;
      const windows: CodexQuotaWindow[] = [];

      const addWindow = (
        id: string,
        labelKey: string,
        window?: import('@/types').CodexUsageWindow | null,
        limitReached?: boolean,
        allowed?: boolean
      ) => {
        if (!window) return;
        const resetLabel = formatCodexResetLabel(window);
        const usedPercentRaw = normalizeNumberValue(window.used_percent ?? window.usedPercent);
        const isLimitReached = Boolean(limitReached) || allowed === false;
        const usedPercent =
          usedPercentRaw ?? (isLimitReached && resetLabel !== '-' ? 100 : null);
        windows.push({
          id,
          label: t(labelKey),
          labelKey,
          usedPercent,
          resetLabel
        });
      };

      addWindow(
        'primary',
        'codex_quota.primary_window',
        rateLimit?.primary_window ?? rateLimit?.primaryWindow,
        rateLimit?.limit_reached ?? rateLimit?.limitReached,
        rateLimit?.allowed
      );
      addWindow(
        'secondary',
        'codex_quota.secondary_window',
        rateLimit?.secondary_window ?? rateLimit?.secondaryWindow,
        rateLimit?.limit_reached ?? rateLimit?.limitReached,
        rateLimit?.allowed
      );
      addWindow(
        'code-review',
        'codex_quota.code_review_window',
        codeReviewLimit?.primary_window ?? codeReviewLimit?.primaryWindow,
        codeReviewLimit?.limit_reached ?? codeReviewLimit?.limitReached,
        codeReviewLimit?.allowed
      );

      return windows;
    },
    [t]
  );

  const fetchQuota = useCallback(
    async (file: AuthFileItem): Promise<{ planType: string | null; windows: CodexQuotaWindow[] }> => {
      const rawAuthIndex = file['auth_index'] ?? file.authIndex;
      const authIndex = normalizeAuthIndexValue(rawAuthIndex);
      if (!authIndex) {
        throw new Error(t('codex_quota.missing_auth_index'));
      }

      const planTypeFromFile = resolveCodexPlanType(file);
      const accountId = resolveCodexChatgptAccountId(file);
      if (!accountId) {
        throw new Error(t('codex_quota.missing_account_id'));
      }

      const requestHeader: Record<string, string> = {
        ...CODEX_REQUEST_HEADERS,
        'Chatgpt-Account-Id': accountId
      };

      const result = await apiCallApi.request({
        authIndex,
        method: 'GET',
        url: CODEX_USAGE_URL,
        header: requestHeader
      });

      if (result.statusCode < 200 || result.statusCode >= 300) {
        throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
      }

      const payload = parseCodexUsagePayload(result.body ?? result.bodyText);
      if (!payload) {
        throw new Error(t('codex_quota.empty_windows'));
      }

      const planTypeFromUsage = normalizePlanType(payload.plan_type ?? payload.planType);
      const windows = buildQuotaWindows(payload);
      return { planType: planTypeFromUsage ?? planTypeFromFile, windows };
    },
    [buildQuotaWindows, t]
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

        setCodexQuota((prev) => {
          const nextState = { ...prev };
          targets.forEach((file) => {
            nextState[file.name] = { status: 'loading', windows: [] };
          });
          return nextState;
        });

        const results = await Promise.all(
          targets.map(async (file) => {
            try {
              const { planType, windows } = await fetchQuota(file);
              return { name: file.name, status: 'success' as const, planType, windows };
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : t('common.unknown_error');
              const errorStatus = getStatusFromError(err);
              return { name: file.name, status: 'error' as const, error: message, errorStatus };
            }
          })
        );

        if (requestId !== requestIdRef.current) return;

        setCodexQuota((prev) => {
          const nextState = { ...prev };
          results.forEach((result) => {
            if (result.status === 'success') {
              nextState[result.name] = {
                status: 'success',
                windows: result.windows,
                planType: result.planType
              };
            } else {
              nextState[result.name] = {
                status: 'error',
                windows: [],
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
    [fetchQuota, setCodexQuota, t]
  );

  return { quota: codexQuota, loadQuota };
}
