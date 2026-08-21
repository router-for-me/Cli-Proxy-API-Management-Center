import { apiClient } from './client';

export interface OpenCodeGoQuotaWindow {
  id: 'rolling' | 'weekly' | 'monthly';
  label: string;
  limit_usd: number;
  status: string;
  used_percent: number;
  remaining_percent: number;
  resets_at: string;
}

export interface OpenCodeGoQuotaResponse {
  provider: 'opencode-go';
  fetched_at: string;
  windows: OpenCodeGoQuotaWindow[];
}

export const openCodeGoQuotaApi = {
  get: () =>
    apiClient.get<OpenCodeGoQuotaResponse>('/plugins/quota-calendar/opencode-go'),
};
