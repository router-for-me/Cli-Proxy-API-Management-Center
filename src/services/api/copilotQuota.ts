import { apiClient } from './client';
import type {
  CopilotQuotaResponse,
  CopilotDeviceCodeResponse,
  CopilotPollResponse,
  CopilotAccountListResponse
} from '@/types';

export const copilotQuotaApi = {
  getQuota: (force?: boolean) => {
    const url = force ? '/copilot-quota?force=true' : '/copilot-quota';
    return apiClient.get<CopilotQuotaResponse>(url);
  },

  startAuth: () =>
    apiClient.post<CopilotDeviceCodeResponse>('/copilot-quota/auth'),

  pollAuth: (deviceCode: string, interval: number) =>
    apiClient.post<CopilotPollResponse>('/copilot-quota/auth/poll', {
      device_code: deviceCode,
      interval
    }),

  removeAccount: (email: string) =>
    apiClient.delete<{ message: string; email: string }>(`/copilot-quota/auth/${encodeURIComponent(email)}`),

  listAccounts: () =>
    apiClient.get<CopilotAccountListResponse>('/copilot-quota/accounts')
};
