import { apiClient } from './client';
import type {
  UsageBreakdownResponse,
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
  snapshot?: string;
}

export interface UsageTimeseriesQuery {
  from: string;
  to: string;
  step: 'hour' | 'day';
  range_mode?: 'bucket' | 'exact';
  provider?: string;
  model?: string;
  account?: string;
}

export interface UsageBreakdownQuery {
  from: string;
  to: string;
  dimension: 'model' | 'endpoint' | 'provider' | 'account';
  provider?: string;
  model?: string;
  account?: string;
}

export const usageStatsApi = {
  timeseries: (params: UsageTimeseriesQuery) =>
    apiClient.get<UsageTimeseriesResponse>('/usage-timeseries', { params }),
  records: (params: UsageRecordsQuery) =>
    apiClient.get<UsageRecordsResponse>('/usage-records', { params }),
  breakdown: (params: UsageBreakdownQuery) =>
    apiClient.get<UsageBreakdownResponse>('/usage-breakdown', { params }),
};
