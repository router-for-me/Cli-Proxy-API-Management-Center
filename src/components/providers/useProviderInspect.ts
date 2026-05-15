import { useState, useCallback } from 'react';
import { modelsApi } from '@/services/api';
import { getErrorMessage } from '@/utils/error';

type InspectStatus = 'idle' | 'checking' | 'success' | 'error';

interface InspectableConfig {
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
}

export function useProviderInspect() {
  const [inspectMap, setInspectMap] = useState<Map<string, { status: InspectStatus; error?: string }>>(new Map());

  const handleInspect = useCallback(async (item: InspectableConfig) => {
    const key = item.apiKey || item.baseUrl || '';
    setInspectMap(prev => {
      const next = new Map(prev);
      next.set(key, { status: 'checking' });
      return next;
    });

    try {
      await modelsApi.fetchV1ModelsViaApiCall(
        item.baseUrl || '',
        item.apiKey || undefined,
        item.headers || {}
      );
      setInspectMap(prev => {
        const next = new Map(prev);
        next.set(key, { status: 'success' });
        return next;
      });
    } catch (err: unknown) {
      const message = getErrorMessage(err) || String(err);
      setInspectMap(prev => {
        const next = new Map(prev);
        next.set(key, { status: 'error', error: message });
        return next;
      });
    }
  }, []);

  return { inspectMap, handleInspect };
}
