/**
 * Hook for Gemini CLI quota data fetching and management.
 */

import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { useQuotaStore } from '@/stores';
import type {
  AuthFileItem,
  GeminiCliQuotaBucketState,
  GeminiCliParsedBucket
} from '@/types';
import {
  GEMINI_CLI_QUOTA_URL,
  GEMINI_CLI_REQUEST_HEADERS,
  normalizeAuthIndexValue,
  normalizeStringValue,
  normalizeQuotaFraction,
  normalizeNumberValue,
  parseGeminiCliQuotaPayload,
  resolveGeminiCliProjectId,
  buildGeminiCliQuotaBuckets,
  createStatusError,
  getStatusFromError
} from '@/utils/quota';

interface UseGeminiCliQuotaReturn {
  quota: Record<string, import('@/types').GeminiCliQuotaState>;
  loadQuota: (
    targets: AuthFileItem[],
    scope: 'page' | 'all',
    setLoading: (loading: boolean, scope?: 'page' | 'all' | null) => void
  ) => Promise<void>;
}

export function useGeminiCliQuota(): UseGeminiCliQuotaReturn {
  const { t } = useTranslation();
  const geminiCliQuota = useQuotaStore((state) => state.geminiCliQuota);
  const setGeminiCliQuota = useQuotaStore((state) => state.setGeminiCliQuota);

  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);

  const fetchQuota = useCallback(
    async (file: AuthFileItem): Promise<GeminiCliQuotaBucketState[]> => {
      const rawAuthIndex = file['auth_index'] ?? file.authIndex;
      const authIndex = normalizeAuthIndexValue(rawAuthIndex);
      if (!authIndex) {
        throw new Error(t('gemini_cli_quota.missing_auth_index'));
      }

      const projectId = resolveGeminiCliProjectId(file);
      if (!projectId) {
        throw new Error(t('gemini_cli_quota.missing_project_id'));
      }

      const result = await apiCallApi.request({
        authIndex,
        method: 'POST',
        url: GEMINI_CLI_QUOTA_URL,
        header: { ...GEMINI_CLI_REQUEST_HEADERS },
        data: JSON.stringify({ project: projectId })
      });

      if (result.statusCode < 200 || result.statusCode >= 300) {
        throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
      }

      const payload = parseGeminiCliQuotaPayload(result.body ?? result.bodyText);
      const buckets = Array.isArray(payload?.buckets) ? payload?.buckets : [];
      if (buckets.length === 0) return [];

      const parsedBuckets = buckets
        .map((bucket) => {
          const modelId = normalizeStringValue(bucket.modelId ?? bucket.model_id);
          if (!modelId) return null;
          const tokenType = normalizeStringValue(bucket.tokenType ?? bucket.token_type);
          const remainingFractionRaw = normalizeQuotaFraction(
            bucket.remainingFraction ?? bucket.remaining_fraction
          );
          const remainingAmount = normalizeNumberValue(
            bucket.remainingAmount ?? bucket.remaining_amount
          );
          const resetTime =
            normalizeStringValue(bucket.resetTime ?? bucket.reset_time) ?? undefined;
          let fallbackFraction: number | null = null;
          if (remainingAmount !== null) {
            fallbackFraction = remainingAmount <= 0 ? 0 : null;
          } else if (resetTime) {
            fallbackFraction = 0;
          }
          const remainingFraction = remainingFractionRaw ?? fallbackFraction;
          return {
            modelId,
            tokenType,
            remainingFraction,
            remainingAmount,
            resetTime
          };
        })
        .filter((bucket): bucket is GeminiCliParsedBucket => bucket !== null);

      return buildGeminiCliQuotaBuckets(parsedBuckets);
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

        setGeminiCliQuota((prev) => {
          const nextState = { ...prev };
          targets.forEach((file) => {
            nextState[file.name] = { status: 'loading', buckets: [] };
          });
          return nextState;
        });

        const results = await Promise.all(
          targets.map(async (file) => {
            try {
              const buckets = await fetchQuota(file);
              return { name: file.name, status: 'success' as const, buckets };
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : t('common.unknown_error');
              const errorStatus = getStatusFromError(err);
              return { name: file.name, status: 'error' as const, error: message, errorStatus };
            }
          })
        );

        if (requestId !== requestIdRef.current) return;

        setGeminiCliQuota((prev) => {
          const nextState = { ...prev };
          results.forEach((result) => {
            if (result.status === 'success') {
              nextState[result.name] = {
                status: 'success',
                buckets: result.buckets
              };
            } else {
              nextState[result.name] = {
                status: 'error',
                buckets: [],
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
    [fetchQuota, setGeminiCliQuota, t]
  );

  return { quota: geminiCliQuota, loadQuota };
}
