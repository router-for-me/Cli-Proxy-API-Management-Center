import { useCallback, useEffect, useState } from 'react';
import { sessionUsageApi } from '@/services/api';
import type { ApiError, CredentialSessionUsage } from '@/types';
import { useInterval } from '@/hooks/useInterval';

export type UseAuthFilesSessionUsageResult = {
  usageByCredential: Map<string, CredentialSessionUsage>;
  supported: boolean | null;
  loading: boolean;
  observedAt: string | null;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useAuthFilesSessionUsage(isCurrentLayer: boolean): UseAuthFilesSessionUsageResult {
  const [usageByCredential, setUsageByCredential] = useState<Map<string, CredentialSessionUsage>>(
    () => new Map()
  );
  const [supported, setSupported] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [observedAt, setObservedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isCurrentLayer || supported === false) return;
    setLoading(true);
    try {
      const response = await sessionUsageApi.list();
      const next = new Map<string, CredentialSessionUsage>();
      response.items.forEach((item) => next.set(item.credentialId, item));
      setUsageByCredential(next);
      setObservedAt(response.observedAt);
      setSupported(true);
      setError(null);
    } catch (rawError) {
      const apiError = rawError as ApiError;
      if (apiError.status === 404 || apiError.status === 405) {
        setSupported(false);
        setUsageByCredential(new Map());
        setError(null);
      } else {
        setSupported((current) => (current === null ? true : current));
        setError(apiError.message || 'Unable to load session usage');
      }
    } finally {
      setLoading(false);
    }
  }, [isCurrentLayer, supported]);

  useEffect(() => {
    if (!isCurrentLayer) return;
    void refresh();
  }, [isCurrentLayer, refresh]);

  useInterval(
    () => {
      void refresh();
    },
    isCurrentLayer && supported !== false ? 5_000 : null
  );

  return { usageByCredential, supported, loading, observedAt, error, refresh };
}
