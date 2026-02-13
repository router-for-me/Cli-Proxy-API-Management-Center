import { useMemo } from 'react';
import type { AuthFileItem } from '@/types';
import { calculateStatusBarData, type UsageDetail } from '@/utils/usage';
import { normalizeAuthIndexValue } from '@/features/authFiles/constants';

export type AuthFileStatusBarData = ReturnType<typeof calculateStatusBarData>;

export function useAuthFilesStatusBarCache(files: AuthFileItem[], usageDetails: UsageDetail[]) {
  return useMemo(() => {
    const cache = new Map<string, AuthFileStatusBarData>();

    files.forEach((file) => {
      const rawAuthIndex = file['auth_index'] ?? file.authIndex;
      const authIndexKey = normalizeAuthIndexValue(rawAuthIndex);

      if (authIndexKey) {
        const filteredDetails = usageDetails.filter((detail) => {
          const detailAuthIndex = normalizeAuthIndexValue(detail.auth_index);
          return detailAuthIndex !== null && detailAuthIndex === authIndexKey;
        });
        cache.set(authIndexKey, calculateStatusBarData(filteredDetails));
      }
    });

    return cache;
  }, [files, usageDetails]);
}

