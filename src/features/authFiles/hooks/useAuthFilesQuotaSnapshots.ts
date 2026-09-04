import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInterval } from '@/hooks/useInterval';
import { quotaManagementApi } from '@/services/api';
import type {
  ApiError,
  AuthFileItem,
  ManagementQuotaCollectionState,
  ManagementQuotaCredentialDetails,
  ManagementQuotaCredentialSnapshot,
} from '@/types';

export type UseAuthFilesQuotaSnapshotsResult = {
  snapshotsByCredential: Map<string, ManagementQuotaCredentialSnapshot>;
  detailsByCredential: Map<string, ManagementQuotaCredentialDetails>;
  supported: boolean | null;
  loading: boolean;
  detailsLoading: boolean;
  collecting: boolean;
  generatedAt: string | null;
  error: string | null;
  refresh: () => Promise<void>;
  loadDetails: (credentialId: string) => Promise<ManagementQuotaCredentialDetails | null>;
  collect: (credentialIds?: string[]) => Promise<ManagementQuotaCollectionState | null>;
};

const credentialIdForFile = (file: AuthFileItem): string => {
  const value = file.authIndex ?? file.id;
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
};

export function useAuthFilesQuotaSnapshots(
  files: AuthFileItem[],
  isCurrentLayer: boolean
): UseAuthFilesQuotaSnapshotsResult {
  const [snapshotsByCredential, setSnapshotsByCredential] = useState<
    Map<string, ManagementQuotaCredentialSnapshot>
  >(() => new Map());
  const [detailsByCredential, setDetailsByCredential] = useState<
    Map<string, ManagementQuotaCredentialDetails>
  >(() => new Map());
  const [supported, setSupported] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const credentialIds = useMemo(() => files.map(credentialIdForFile).filter(Boolean), [files]);

  const refresh = useCallback(async () => {
    if (!isCurrentLayer || supported === false || credentialIds.length === 0) return;
    setLoading(true);
    try {
      const response = await quotaManagementApi.list(credentialIds);
      const next = new Map<string, ManagementQuotaCredentialSnapshot>();
      response.items.forEach((item) => {
        next.set(item.credentialId, item);
        if (item.authIndex) next.set(item.authIndex, item);
      });
      setSnapshotsByCredential(next);
      setGeneratedAt(response.generatedAt);
      setSupported(true);
      setError(null);
    } catch (rawError) {
      const apiError = rawError as ApiError;
      if (apiError.status === 404 || apiError.status === 405) {
        setSupported(false);
        setSnapshotsByCredential(new Map());
        setDetailsByCredential(new Map());
        setError(null);
      } else {
        setSupported((current) => (current === null ? true : current));
        setError(apiError.message || 'Unable to load Home quota snapshots');
      }
    } finally {
      setLoading(false);
    }
  }, [credentialIds, isCurrentLayer, supported]);

  const loadDetails = useCallback(
    async (credentialId: string): Promise<ManagementQuotaCredentialDetails | null> => {
      if (!isCurrentLayer || supported === false || !credentialId) return null;
      setDetailsLoading(true);
      try {
        const details = await quotaManagementApi.get(credentialId);
        setDetailsByCredential((current) => {
          const next = new Map(current);
          next.set(details.credentialId || credentialId, details);
          if (details.authIndex) next.set(details.authIndex, details);
          return next;
        });
        setSupported(true);
        return details;
      } catch (rawError) {
        const apiError = rawError as ApiError;
        if (apiError.status === 404 || apiError.status === 405) {
          if (supported !== true) setSupported(false);
        } else {
          setError(apiError.message || 'Unable to load Home quota details');
        }
        return null;
      } finally {
        setDetailsLoading(false);
      }
    },
    [isCurrentLayer, supported]
  );

  const collect = useCallback(
    async (selectedIds: string[] = []): Promise<ManagementQuotaCollectionState | null> => {
      if (!isCurrentLayer || supported === false) return null;
      setCollecting(true);
      try {
        const result = await quotaManagementApi.collect(selectedIds);
        setSupported(true);
        return result;
      } catch (rawError) {
        const apiError = rawError as ApiError;
        if (apiError.status === 404 || apiError.status === 405) {
          if (supported !== true) setSupported(false);
        } else {
          setError(apiError.message || 'Unable to recollect Home quota');
        }
        return null;
      } finally {
        setCollecting(false);
      }
    },
    [isCurrentLayer, supported]
  );

  useEffect(() => {
    if (!isCurrentLayer || credentialIds.length === 0) return;
    void refresh();
  }, [credentialIds, isCurrentLayer, refresh]);

  useInterval(
    () => {
      void refresh();
    },
    isCurrentLayer && supported !== false && credentialIds.length > 0 ? 30_000 : null
  );

  return {
    snapshotsByCredential,
    detailsByCredential,
    supported,
    loading,
    detailsLoading,
    collecting,
    generatedAt,
    error,
    refresh,
    loadDetails,
    collect,
  };
}

export const getQuotaSnapshotForFile = (
  file: AuthFileItem,
  snapshotsByCredential: Map<string, ManagementQuotaCredentialSnapshot>
): ManagementQuotaCredentialSnapshot | undefined => {
  const credentialId = credentialIdForFile(file);
  return (
    (credentialId && snapshotsByCredential.get(credentialId)) ||
    snapshotsByCredential.get(file.name)
  );
};

export const getQuotaDetailsForFile = (
  file: AuthFileItem,
  detailsByCredential: Map<string, ManagementQuotaCredentialDetails>
): ManagementQuotaCredentialDetails | undefined => {
  const credentialId = credentialIdForFile(file);
  return (
    (credentialId && detailsByCredential.get(credentialId)) || detailsByCredential.get(file.name)
  );
};
