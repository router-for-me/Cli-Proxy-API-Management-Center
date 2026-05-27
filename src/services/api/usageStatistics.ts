/**
 * Usage statistics API service.
 */

import { apiClient } from './client';
import type {
  UsageStatisticsSummaryResponse,
  UsageStatisticsQuery,
} from '@/types/usageStatistics';

const USAGE_STATS_TIMEOUT_MS = 15 * 1000;

export const usageStatisticsApi = {
  /**
   * Fetch usage statistics summary.
   * Gracefully handles 404/503 (feature not enabled) and other errors.
   */
  getSummary: (params?: UsageStatisticsQuery) =>
    apiClient.get<UsageStatisticsSummaryResponse>('/usage-statistics/summary', {
      params: {
        ...(params?.from && { from: params.from }),
        ...(params?.to && { to: params.to }),
        ...(params?.group_by && { group_by: params.group_by }),
        ...(params?.recent_limit && { recent_limit: params.recent_limit }),
      },
      timeout: USAGE_STATS_TIMEOUT_MS,
    }),
};
