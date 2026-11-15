import type { PoolDashboard } from '@/domain/quotaPool/types';
import { apiClient } from './client';

export interface PoolQuery {
  window: PoolDashboard['window'];
  lookback: PoolDashboard['lookbackHours'];
  multiplier: PoolDashboard['multiplier'];
  offsetDays: number;
  reveal: boolean;
}

export type PoolRefresh = Pick<PoolDashboard, 'refreshing' | 'nextRefreshAtMs' | 'lastRefreshAtMs'>;

export function createQuotaPoolApi() {
  const client = apiClient.captureConnection();
  return {
    get: (params: PoolQuery, signal: AbortSignal) =>
      client.get<PoolDashboard>('/prox/pools', { params, signal }),
    refreshAccount: (accountId: string, signal: AbortSignal) =>
      client.post<{ refreshed: boolean; retryAtMs?: number | null }>(
        '/prox/refresh',
        { accountId },
        { signal }
      ),
    refresh: (signal: AbortSignal) =>
      client.post<PoolRefresh>('/prox/refresh', undefined, { signal }),
  };
}
