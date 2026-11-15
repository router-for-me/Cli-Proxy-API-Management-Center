import { useEffect, useState } from 'react';
import { apiKeyPolicyUsageApi, type ApiKeyPolicyUsage } from '@/services/api/apiKeyPolicyUsage';

/** Loads per-key usage counters; older backends without the endpoint yield an empty map. */
export function useApiKeyPolicyUsage(enabled: boolean) {
  const [usage, setUsage] = useState<Map<string, ApiKeyPolicyUsage>>(() => new Map());
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiKeyPolicyUsageApi
      .list()
      .then((entries) => {
        if (!cancelled) setUsage(new Map(entries.map((entry) => [entry.key, entry])));
      })
      .catch(() => {
        if (!cancelled) setUsage(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return usage;
}
