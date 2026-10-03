import { apiClient } from './client';

/** One account row of bin/quota.json, as served by /observability/quota/api-keys. */
export interface ApiKeyQuotaAccount {
  provider: string;
  account: string | null;
  key_id: string;
  plan: string | null;
  state: string;
  limit: number | null;
  usage: number | null;
  remaining: number | null;
  free_model_requests?: { limit: number | null; used: number | null; remaining: number | null };
  credits?: { total: number | null; used: number | null; remaining: number | null } | null;
  /** Provider-declared labeled meters (z.ai plan windows etc.); replaces credits/free rendering. */
  meters?: { label: string; percent_left: number | null; text: string | null }[];
  fetched_at: string;
}

export interface ApiKeyQuotaResponse {
  accounts: ApiKeyQuotaAccount[];
  updated_at?: string;
  served_at?: string;
  note?: string;
}

const TIMEOUT_MS = 15 * 1000;

/** Per-API-key quota snapshots (e.g. OpenRouter), polled out-of-band by the sync script. */
export const openaiCompatQuotaApi = {
  get: () => apiClient.get<ApiKeyQuotaResponse>('/observability/quota/api-keys', { timeout: TIMEOUT_MS }),
};
