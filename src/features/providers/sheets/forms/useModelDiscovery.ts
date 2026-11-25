import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { modelsApi } from '@/services/api';
import { buildHeaderObject } from '@/utils/headers';
import { getErrorMessage } from '@/utils/helpers';
import type { ModelInfo } from '@/utils/models';
import type { ApiKeyEntryInput, ProviderBrand } from '../../types';
import { resolveProbeTransport } from './probeTransport';
import { guardConfigConnection } from '@/services/api/configValue';

export const MODEL_DISCOVERY_BRANDS: ReadonlyArray<ProviderBrand> = [
  'gemini',
  'interactions',
  'codex',
  'meta',
  'xai',
  'claude',
  'openaiCompatibility',
];

export const isModelDiscoveryBrand = (brand: ProviderBrand): boolean =>
  MODEL_DISCOVERY_BRANDS.includes(brand);

export interface UseModelDiscoveryArgs {
  brand: ProviderBrand;
  baseUrl: string;
  proxyUrl?: string;
  savedProxyUrl?: string;
  formHeaders: Array<{ key: string; value: string }>;
  apiKeyEntries?: ApiKeyEntryInput[];
  apiKey?: string;
  fallbackApiKey?: string;
  authIndex?: string;
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

type DiscoveryState = Pick<UseModelDiscoveryResult, 'loading' | 'error' | 'models' | 'hasFetched'>;
const idle: DiscoveryState = { loading: false, error: null, models: [], hasFetched: false };

export async function settleModelDiscovery(
  load: () => Promise<ModelInfo[]>,
  isCurrent: () => boolean,
  publish: (state: DiscoveryState) => void
) {
  try {
    const models = await load();
    if (isCurrent()) publish({ loading: false, error: null, models, hasFetched: true });
  } catch (err) {
    if (isCurrent()) {
      publish({
        ...idle,
        hasFetched: true,
        error: getErrorMessage(err) || 'Failed to fetch models',
      });
    }
  }
}

export function useModelDiscovery(args: UseModelDiscoveryArgs): UseModelDiscoveryResult {
  const {
    brand,
    baseUrl,
    proxyUrl,
    savedProxyUrl,
    formHeaders,
    apiKeyEntries,
    apiKey,
    fallbackApiKey,
    authIndex,
  } = args;

  const available = isModelDiscoveryBrand(brand);
  const [state, setState] = useState(idle);
  const revision = useRef(0);

  const fetch = useCallback(async () => {
    if (!available) return;
    const request = ++revision.current;
    const isCurrent = () => request === revision.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    await settleModelDiscovery(
      async () => {
        const baseHeaders = buildHeaderObject(formHeaders);
        const openai = brand === 'openaiCompatibility';
        const firstEntry = openai
          ? (apiKeyEntries ?? []).find(
              (e) => e.apiKey?.trim() || e.existingApiKey?.trim() || e.authIndex?.trim()
            )
          : undefined;
        const key = openai
          ? firstEntry?.apiKey?.trim() || firstEntry?.existingApiKey?.trim()
          : apiKey?.trim() || fallbackApiKey?.trim();
        const checkConnection = guardConfigConnection();
        const transport = await resolveProbeTransport(
          openai ? firstEntry?.proxyUrl : proxyUrl,
          openai ? firstEntry?.savedProxyUrl : savedProxyUrl,
          firstEntry?.authIndex?.trim() || authIndex,
          !key ||
            key.includes('$TOKEN$') ||
            Object.values(baseHeaders).some((v) => v.includes('$TOKEN$'))
        );
        if (!isCurrent()) return [];
        checkConnection();
        let next: ModelInfo[] = [];
        if (brand === 'gemini' || brand === 'interactions') {
          next = await modelsApi.fetchGeminiModelsViaApiCall(
            baseUrl,
            key,
            baseHeaders,
            transport.authIndex,
            transport.proxyUrl
          );
        } else if (brand === 'codex' || brand === 'meta' || brand === 'xai') {
          next = await modelsApi.fetchV1ModelsViaApiCall(
            baseUrl,
            key,
            baseHeaders,
            transport.authIndex,
            transport.proxyUrl
          );
        } else if (brand === 'claude') {
          next = await modelsApi.fetchClaudeModelsViaApiCall(
            baseUrl,
            key,
            baseHeaders,
            transport.authIndex,
            transport.proxyUrl
          );
        } else if (brand === 'openaiCompatibility') {
          try {
            next = await modelsApi.fetchModelsViaApiCall(
              baseUrl,
              key,
              baseHeaders,
              transport.authIndex,
              transport.proxyUrl
            );
          } catch (firstErr) {
            if (!isCurrent()) throw firstErr;
            // Some OpenAI-compatible endpoints expose /models without auth, or
            // reject the configured key for the discovery route. Retry once
            // without any auth/headers before surfacing the original error.
            try {
              checkConnection();
              next = await modelsApi.fetchModelsViaApiCall(
                baseUrl,
                undefined,
                undefined,
                undefined,
                transport.proxyUrl
              );
            } catch {
              throw firstErr;
            }
          }
        }
        return next ?? [];
      },
      isCurrent,
      setState
    );
  }, [
    available,
    apiKey,
    apiKeyEntries,
    authIndex,
    baseUrl,
    brand,
    fallbackApiKey,
    formHeaders,
    savedProxyUrl,
    proxyUrl,
  ]);

  const reset = useCallback(() => {
    revision.current++;
    setState(idle);
  }, []);

  const inputSignature = useMemo(
    () =>
      JSON.stringify([
        brand,
        baseUrl,
        proxyUrl,
        savedProxyUrl,
        apiKey,
        fallbackApiKey,
        authIndex,
        formHeaders.map(({ key, value }) => [key, value]),
        apiKeyEntries?.map((e) => [
          e.apiKey,
          e.existingApiKey,
          e.authIndex,
          e.proxyUrl,
          e.savedProxyUrl,
        ]),
      ]),
    [
      brand,
      baseUrl,
      proxyUrl,
      savedProxyUrl,
      apiKey,
      fallbackApiKey,
      authIndex,
      formHeaders,
      apiKeyEntries,
    ]
  );

  useLayoutEffect(() => {
    reset();
    return () => {
      revision.current++;
    };
  }, [inputSignature, reset]);

  return { available, ...state, fetch, reset };
}
