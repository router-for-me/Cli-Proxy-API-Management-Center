import { useCallback, useState } from 'react';
import { modelsApi } from '@/services/api';
import { buildHeaderObject } from '@/utils/headers';
import type { ModelInfo } from '@/utils/models';
import type { ApiKeyEntryInput, ProviderBrand } from '../../types';

export const MODEL_DISCOVERY_BRANDS: ReadonlyArray<ProviderBrand> = [
  'gemini',
  'codex',
  'claude',
  'openaiCompatibility',
];

export const isModelDiscoveryBrand = (brand: ProviderBrand): boolean =>
  MODEL_DISCOVERY_BRANDS.includes(brand);

const parseHeadersText = (text: string): Record<string, string> => {
  const out: Record<string, string> = {};
  String(text ?? '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const sep = line.indexOf(':');
      if (sep <= 0) return;
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 1).trim();
      if (!key) return;
      out[key] = value;
    });
  return out;
};

const toErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

export interface UseModelDiscoveryArgs {
  brand: ProviderBrand;
  baseUrl: string;
  formHeaders: Array<{ key: string; value: string }>;
  apiKeyEntries?: ApiKeyEntryInput[];
  apiKey?: string;
  fallbackApiKey?: string;
}

export interface UseModelDiscoveryResult {
  available: boolean;
  loading: boolean;
  error: string | null;
  models: ModelInfo[];
  hasFetched: boolean;
  fetch: () => Promise<void>;
  reset: () => void;
}

export function useModelDiscovery(
  args: UseModelDiscoveryArgs
): UseModelDiscoveryResult {
  const { brand, baseUrl, formHeaders, apiKeyEntries, apiKey, fallbackApiKey } =
    args;

  const available = isModelDiscoveryBrand(brand);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [hasFetched, setHasFetched] = useState(false);

  const fetch = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    setError(null);
    try {
      const baseHeaders = buildHeaderObject(formHeaders);
      let next: ModelInfo[] = [];
      if (brand === 'gemini') {
        const key = (apiKey ?? '').trim() || (fallbackApiKey ?? '').trim();
        next = await modelsApi.fetchGeminiModelsViaApiCall(
          baseUrl,
          key,
          baseHeaders
        );
      } else if (brand === 'codex') {
        const key = (apiKey ?? '').trim() || (fallbackApiKey ?? '').trim();
        next = await modelsApi.fetchV1ModelsViaApiCall(
          baseUrl,
          key,
          baseHeaders
        );
      } else if (brand === 'claude') {
        const key = (apiKey ?? '').trim() || (fallbackApiKey ?? '').trim();
        next = await modelsApi.fetchClaudeModelsViaApiCall(
          baseUrl,
          key,
          baseHeaders
        );
      } else if (brand === 'openaiCompatibility') {
        const firstEntry = (apiKeyEntries ?? []).find((e) =>
          (e.apiKey ?? '').trim()
        );
        const entryKey = (firstEntry?.apiKey ?? '').trim();
        const entryHeaders = parseHeadersText(firstEntry?.headersText ?? '');
        const headers = { ...baseHeaders, ...entryHeaders };
        try {
          next = await modelsApi.fetchModelsViaApiCall(
            baseUrl,
            entryKey,
            headers
          );
        } catch (firstErr) {
          // Some OpenAI-compatible endpoints expose /models without auth, or
          // reject the configured key for the discovery route. Retry once
          // without any auth/headers before surfacing the original error.
          try {
            next = await modelsApi.fetchModelsViaApiCall(baseUrl);
          } catch {
            throw firstErr;
          }
        }
      }
      setModels(next ?? []);
      setHasFetched(true);
    } catch (err) {
      setModels([]);
      setError(toErrorMessage(err) || 'Failed to fetch models');
      setHasFetched(true);
    } finally {
      setLoading(false);
    }
  }, [available, apiKey, apiKeyEntries, baseUrl, brand, fallbackApiKey, formHeaders]);

  const reset = useCallback(() => {
    setModels([]);
    setError(null);
    setLoading(false);
    setHasFetched(false);
  }, []);

  return { available, loading, error, models, hasFetched, fetch, reset };
}
