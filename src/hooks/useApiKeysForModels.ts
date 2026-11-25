import { useCallback } from 'react';
import { apiKeysApi } from '@/services/api/apiKeys';
import { useConfigStore } from '@/stores';

/** Resolve the first public access key; the config store already caches keys per session. */
export function useApiKeyForModels() {
  const configured = useConfigStore((state) => state.config?.apiKeys);
  return useCallback(async () => {
    const keys = configured ?? (await apiKeysApi.list());
    return keys.find((key) => key.trim())?.trim();
  }, [configured]);
}
