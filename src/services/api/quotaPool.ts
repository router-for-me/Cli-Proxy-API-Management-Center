import type { PoolDashboard, PoolProviderId } from '@/domain/quotaPool/types';
import { apiClient } from './client';

export interface PoolQuery {
  window: PoolDashboard['window'];
  lookback: PoolDashboard['lookbackHours'];
  multiplier: PoolDashboard['multiplier'];
  offsetDays: number;
  reveal: boolean;
}

export type PoolRefresh = Pick<PoolDashboard, 'refreshing' | 'nextRefreshAtMs' | 'lastRefreshAtMs'>;

/** One recorded reset claim (server/quota/types.ts `ResetEvent`), as the pages use it. */
export interface ResetEventView {
  id: number;
  /** The server's stored account id (a pool row's `id`). */
  accountId: string;
  provider: PoolProviderId;
  /** Claude: session, weekly, fable or full. Codex: `codex_rate_limits`. */
  kind: string;
  outcome: string;
  requestedAtMs: number;
  settledAtMs: number | null;
  cooldownCleared: boolean | null;
}
export interface ResetClaimResponse {
  outcome: string;
  replayed: boolean;
  refreshed: boolean;
  event: ResetEventView;
}

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
    /** Spend one reset through the server, which records it (POST /v1/resets/claim). */
    claimReset: (body: { accountId: string; clientRequestId: string; grantId?: string }) =>
      client.post<ResetClaimResponse>('/prox/resets/claim', body),
    resetEvents: (provider: PoolProviderId, signal: AbortSignal) =>
      client.get<{ events: ResetEventView[] }>('/prox/resets/events', {
        params: { provider },
        signal,
      }),
  };
}
