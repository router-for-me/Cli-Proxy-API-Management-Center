import { apiClient } from './client';
import type {
  UsageRecordsResponse,
  UsageTimeseriesResponse,
} from '@/features/usage/types';

export interface UsageRecordsQuery {
  from: string;
  to: string;
  limit?: number;
  offset?: number;
  provider?: string;
  model?: string;
  account?: string;
  failed?: boolean;
}

export const usageStatsApi = {
  timeseries: (params: { from: string; to: string; step: 'hour' | 'day' }) =>
    apiClient.get<UsageTimeseriesResponse>('/usage-timeseries', { params }),
  records: (params: UsageRecordsQuery) =>
    apiClient.get<UsageRecordsResponse>('/usage-records', { params }),
};
