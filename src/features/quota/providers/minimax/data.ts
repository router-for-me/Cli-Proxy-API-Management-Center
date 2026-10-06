import type { TFunction } from 'i18next';
import type { MinimaxQuotaData, MinimaxQuotaState } from '@/types';
import { apiCallApi } from '@/services/api/apiCall';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores/useQuotaStore';
import { isDisabledAuthFile, resolveAuthProvider } from '@/utils/quota';
import type { QuotaProviderData } from '../types';
import { createMinimaxQuotaFetcher, MinimaxQuotaError } from './requests';

const fetchMinimaxQuota = createMinimaxQuotaFetcher({
  request: (payload) => apiCallApi.request(payload),
  captureCurrent: (name) => {
    const generation = captureQuotaCacheGeneration(name);
    return () => commitIfQuotaCacheCurrent(generation, () => {});
  },
});

export const MINIMAX_CONFIG: QuotaProviderData<MinimaxQuotaState, MinimaxQuotaData> = {
  type: 'minimax',
  i18nPrefix: 'minimax_quota',
  filterFn: (file) => resolveAuthProvider(file) === 'minimax' && !isDisabledAuthFile(file),
  fetchQuota: async (file, t: TFunction) => {
    try {
      return await fetchMinimaxQuota(file);
    } catch (error: unknown) {
      if (error instanceof MinimaxQuotaError) {
        error.message = t(`minimax_quota.${error.code}`, { status: error.status });
      }
      throw error;
    }
  },
  storeSelector: (state) => state.minimaxQuota,
  storeSetter: 'setMinimaxQuota',
  buildLoadingState: () => ({ status: 'loading' }),
  buildSuccessState: (data) => ({ status: 'success', data }),
  buildErrorState: (error, errorStatus) => ({
    status: 'error',
    error,
    errorStatus,
  }),
};
