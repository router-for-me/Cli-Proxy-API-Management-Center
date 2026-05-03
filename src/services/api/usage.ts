import { apiClient } from './client';
import type { UsageResponse } from '@/types/usage';

const USAGE_TIMEOUT_MS = 60 * 1000;

export const usageApi = {
  getUsage: () => apiClient.get<UsageResponse>('/usage', { timeout: USAGE_TIMEOUT_MS }),
};
