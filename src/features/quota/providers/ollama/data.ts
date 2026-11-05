import type { AuthFileItem } from '@/types';
import {
  ollamaQuotaApi,
  type OllamaQuota,
  type OllamaConnection,
} from '@/services/api/ollamaQuota';
import type { QuotaProviderData } from '../types';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { getQuotaCacheKey } from '@/utils/quota/identity';

export interface OllamaQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  data?: OllamaQuota;
  error?: string;
  errorStatus?: number;
  selectedRange?: OllamaQuota['range'];
}

// Range changes and refresh-all share the same loading guard and cache path.
export const selectOllamaRange = (file: AuthFileItem, range: OllamaQuota['range']) => {
  const key = getQuotaCacheKey(file);
  useQuotaStore.getState().setOllamaQuota((previous) => {
    const current = previous[key];
    if (current?.status === 'loading') return previous;
    return {
      ...previous,
      [key]: { ...current, status: current?.status ?? 'idle', selectedRange: range },
    };
  });
};

/** Quota-only resources; these are never uploaded as OAuth/auth files. */
export const ollamaConnectionEntries = (connections: OllamaConnection[]): AuthFileItem[] =>
  connections.map((connection) => ({
    name: connection.display_name,
    provider: 'ollama-cloud',
    authIndex: connection.connection_id,
    ollamaConnectionId: connection.connection_id,
  }));

export const OLLAMA_CONFIG: QuotaProviderData<OllamaQuotaState, OllamaQuota> = {
  type: 'ollama',
  i18nPrefix: 'ollama_quota',
  filterFn: (file) => file.provider === 'ollama-cloud' && !file.disabled,
  fetchQuota: (file) => {
    const current = useQuotaStore.getState().ollamaQuota[getQuotaCacheKey(file)];
    const range = current?.selectedRange ?? current?.data?.range ?? '7d';
    return ollamaQuotaApi.fetch(String(file.ollamaConnectionId), range);
  },
  storeSelector: (state) => state.ollamaQuota,
  storeSetter: 'setOllamaQuota',
  buildLoadingState: () => ({ status: 'loading' }),
  buildSuccessState: (data) => ({ status: 'success', data }),
  buildErrorState: (error, errorStatus) => ({ status: 'error', error, errorStatus }),
};
