import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import {
  buildClaudeMessagesEndpoint,
  buildOpenAIChatCompletionsEndpoint,
} from '@/components/providers/utils';
import { buildHeaderObject, hasHeader } from '@/utils/headers';
import type {
  ApiKeyEntryInput,
  ModelEntryInput,
  ProviderBrand,
} from '../../types';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

export type ConnectivityState = 'idle' | 'loading' | 'success' | 'error';

export interface ConnectivityStatus {
  state: ConnectivityState;
  message: string;
}

const IDLE: ConnectivityStatus = { state: 'idle', message: '' };

const errorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

const pickModel = (
  testModel: string | undefined,
  models: ModelEntryInput[]
): string => {
  const trimmed = (testModel ?? '').trim();
  if (trimmed) return trimmed;
  for (const m of models) {
    const name = (m.name ?? '').trim();
    if (name) return name;
  }
  return '';
};

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

const resolveBearerToken = (headers: Record<string, string>): string => {
  const auth = Object.entries(headers).find(
    ([k]) => k.toLowerCase() === 'authorization'
  )?.[1];
  if (!auth) return '';
  const match = String(auth).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
};

export interface UseConnectivityTestArgs {
  brand: ProviderBrand;
  baseUrl: string;
  testModel?: string;
  models: ModelEntryInput[];
  formHeaders: Array<{ key: string; value: string }>;
  apiKeyEntries?: ApiKeyEntryInput[];
  apiKey?: string;
  fallbackApiKey?: string;
  authIndex?: string;
}

export interface ConnectivityErrorMessages {
  baseUrlRequired: string;
  endpointInvalid: string;
  apiKeyRequired: string;
  modelRequired: string;
  timeout: (seconds: number) => string;
  requestFailed: string;
}

export interface UseConnectivityTestResult {
  openaiStatuses: ConnectivityStatus[];
  claudeStatus: ConnectivityStatus;
  isTestingAny: boolean;
  runOpenAIKey: (idx: number) => Promise<boolean>;
  runOpenAIAllKeys: () => Promise<void>;
  runClaude: () => Promise<void>;
}

export function useConnectivityTest(
  args: UseConnectivityTestArgs,
  messages: ConnectivityErrorMessages
): UseConnectivityTestResult {
  const {
    brand,
    baseUrl,
    testModel,
    models,
    formHeaders,
    apiKeyEntries,
    apiKey,
    fallbackApiKey,
    authIndex,
  } = args;

  const entriesCount = apiKeyEntries?.length ?? 0;

  const [openaiStatuses, setOpenaiStatuses] = useState<ConnectivityStatus[]>(
    () => Array.from({ length: entriesCount }, () => IDLE)
  );
  const [claudeStatus, setClaudeStatus] = useState<ConnectivityStatus>(IDLE);
  const [inFlight, setInFlight] = useState(0);

  const entrySignatures = useMemo(
    () =>
      (apiKeyEntries ?? []).map(
        (entry) =>
          [
            entry.apiKey ?? '',
            entry.authIndex ?? '',
            entry.proxyUrl ?? '',
            entry.headersText ?? '',
          ].join('||')
      ),
    [apiKeyEntries]
  );

  const lastEntrySignaturesRef = useRef<string[]>(entrySignatures);
  useEffect(() => {
    const prev = lastEntrySignaturesRef.current;
    const curr = entrySignatures;
    lastEntrySignaturesRef.current = curr;

    setOpenaiStatuses((statuses) => {
      const nextLen = curr.length;
      let mutated = statuses.length !== nextLen;
      const next = statuses.slice(0, nextLen);
      while (next.length < nextLen) next.push(IDLE);
      for (let i = 0; i < nextLen; i++) {
        if (prev[i] !== undefined && prev[i] !== curr[i] && next[i].state !== 'idle') {
          next[i] = IDLE;
          mutated = true;
        }
      }
      return mutated ? next : statuses;
    });
  }, [entrySignatures]);

  const signature = useMemo(() => {
    const h = formHeaders.map((it) => `${it.key}:${it.value}`).join('|');
    const m = models.map((it) => `${it.name}:${it.alias ?? ''}`).join('|');
    return `${baseUrl}||${(testModel ?? '').trim()}||${h}||${m}`;
  }, [baseUrl, testModel, formHeaders, models]);

  const lastSignatureRef = useRef(signature);
  useEffect(() => {
    if (lastSignatureRef.current === signature) return;
    lastSignatureRef.current = signature;
    setOpenaiStatuses((prev) => prev.map(() => IDLE));
    setClaudeStatus(IDLE);
  }, [signature]);

  const updateOpenaiStatus = useCallback(
    (idx: number, value: ConnectivityStatus) => {
      setOpenaiStatuses((prev) => {
        const next = [...prev];
        next[idx] = value;
        return next;
      });
    },
    []
  );

  const runOpenAIKey = useCallback(
    async (idx: number): Promise<boolean> => {
      if (brand !== 'openaiCompatibility') return false;

      const trimmedBase = baseUrl.trim();
      if (!trimmedBase) {
        updateOpenaiStatus(idx, {
          state: 'error',
          message: messages.baseUrlRequired,
        });
        return false;
      }
      const endpoint = buildOpenAIChatCompletionsEndpoint(trimmedBase);
      if (!endpoint) {
        updateOpenaiStatus(idx, {
          state: 'error',
          message: messages.endpointInvalid,
        });
        return false;
      }
      const entry = apiKeyEntries?.[idx];
      const entryKey = (entry?.apiKey ?? '').trim();
      const resolvedAuthIndex =
        (entry?.authIndex ?? '').trim() || (authIndex ?? '').trim() || undefined;
      if (!entryKey && !resolvedAuthIndex) {
        updateOpenaiStatus(idx, {
          state: 'error',
          message: messages.apiKeyRequired,
        });
        return false;
      }
      const model = pickModel(testModel, models);
      if (!model) {
        updateOpenaiStatus(idx, {
          state: 'error',
          message: messages.modelRequired,
        });
        return false;
      }

      const headerObj: Record<string, string> = {
        'Content-Type': 'application/json',
        ...buildHeaderObject(formHeaders),
        ...parseHeadersText(entry?.headersText ?? ''),
      };
      if (!hasHeader(headerObj, 'authorization')) {
        if (entryKey) {
          headerObj.Authorization = `Bearer ${entryKey}`;
        } else if (resolvedAuthIndex) {
          headerObj.Authorization = 'Bearer $TOKEN$';
        }
      }

      updateOpenaiStatus(idx, { state: 'loading', message: '' });
      setInFlight((n) => n + 1);
      try {
        const result = await apiCallApi.request(
          {
            authIndex: resolvedAuthIndex,
            method: 'POST',
            url: endpoint,
            header: headerObj,
            data: JSON.stringify({
              model,
              messages: [{ role: 'user', content: 'Hi' }],
              stream: false,
              max_tokens: 5,
            }),
          },
          { timeout: DEFAULT_TIMEOUT_MS }
        );
        if (result.statusCode < 200 || result.statusCode >= 300) {
          throw new Error(getApiCallErrorMessage(result));
        }
        updateOpenaiStatus(idx, { state: 'success', message: '' });
        return true;
      } catch (err) {
        const raw = errorMessage(err);
        const isTimeout =
          (typeof err === 'object' &&
            err !== null &&
            'code' in err &&
            String((err as { code?: string }).code) === 'ECONNABORTED') ||
          raw.toLowerCase().includes('timeout');
        updateOpenaiStatus(idx, {
          state: 'error',
          message: isTimeout
            ? messages.timeout(DEFAULT_TIMEOUT_MS / 1000)
            : raw || messages.requestFailed,
        });
        return false;
      } finally {
        setInFlight((n) => n - 1);
      }
    },
    [
      apiKeyEntries,
      authIndex,
      baseUrl,
      brand,
      formHeaders,
      messages,
      models,
      testModel,
      updateOpenaiStatus,
    ]
  );

  const runOpenAIAllKeys = useCallback(async (): Promise<void> => {
    if (brand !== 'openaiCompatibility') return;
    const entries = apiKeyEntries ?? [];
    if (!entries.length) return;
    await Promise.all(entries.map((_, idx) => runOpenAIKey(idx)));
  }, [apiKeyEntries, brand, runOpenAIKey]);

  const runClaude = useCallback(async (): Promise<void> => {
    if (brand !== 'claude') return;

    const endpoint = buildClaudeMessagesEndpoint(baseUrl ?? '');
    if (!endpoint) {
      setClaudeStatus({ state: 'error', message: messages.endpointInvalid });
      return;
    }
    const model = pickModel(testModel, models);
    if (!model) {
      setClaudeStatus({ state: 'error', message: messages.modelRequired });
      return;
    }

    const customHeaders = buildHeaderObject(formHeaders);
    const explicitKey = (apiKey ?? '').trim();
    const persistedKey = (fallbackApiKey ?? '').trim();
    const headerKey = resolveBearerToken(customHeaders);
    const hasApiKeyHeader = hasHeader(customHeaders, 'x-api-key');
    const resolvedKey = explicitKey || persistedKey || headerKey;
    const resolvedAuthIndex = (authIndex ?? '').trim() || undefined;

    if (!resolvedKey && !hasApiKeyHeader && !resolvedAuthIndex) {
      setClaudeStatus({ state: 'error', message: messages.apiKeyRequired });
      return;
    }

    const headerObj: Record<string, string> = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };
    if (!hasHeader(headerObj, 'anthropic-version')) {
      headerObj['anthropic-version'] = DEFAULT_ANTHROPIC_VERSION;
    }
    if (!hasApiKeyHeader && resolvedKey) {
      headerObj['x-api-key'] = resolvedKey;
    } else if (!hasApiKeyHeader && resolvedAuthIndex) {
      headerObj['x-api-key'] = '$TOKEN$';
    }

    setClaudeStatus({ state: 'loading', message: '' });
    setInFlight((n) => n + 1);
    try {
      const result = await apiCallApi.request(
        {
          authIndex: resolvedAuthIndex,
          method: 'POST',
          url: endpoint,
          header: headerObj,
          data: JSON.stringify({
            model,
            max_tokens: 8,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        },
        { timeout: DEFAULT_TIMEOUT_MS }
      );
      if (result.statusCode < 200 || result.statusCode >= 300) {
        throw new Error(getApiCallErrorMessage(result));
      }
      setClaudeStatus({ state: 'success', message: '' });
    } catch (err) {
      const raw = errorMessage(err);
      const isTimeout =
        (typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          String((err as { code?: string }).code) === 'ECONNABORTED') ||
        raw.toLowerCase().includes('timeout');
      setClaudeStatus({
        state: 'error',
        message: isTimeout
          ? messages.timeout(DEFAULT_TIMEOUT_MS / 1000)
          : raw || messages.requestFailed,
      });
    } finally {
      setInFlight((n) => n - 1);
    }
  }, [
    apiKey,
    authIndex,
    baseUrl,
    brand,
    fallbackApiKey,
    formHeaders,
    messages,
    models,
    testModel,
  ]);

  return {
    openaiStatuses,
    claudeStatus,
    isTestingAny: inFlight > 0,
    runOpenAIKey,
    runOpenAIAllKeys,
    runClaude,
  };
}
