/**
 * 日志相关 API
 */

import { apiClient } from './client';

export interface LogsQuery {
  after?: number;
}

export interface LogsResponse {
  lines: string[];
  'line-count': number;
  'latest-timestamp': number;
}

export const logsApi = {
  fetchLogs: (params: LogsQuery = {}): Promise<LogsResponse> =>
    apiClient.get('/logs', { params }),

  clearLogs: () => apiClient.delete('/logs'),

  fetchErrorLogs: () => apiClient.get('/request-error-logs'),

  downloadErrorLog: (filename: string) =>
    apiClient.getRaw(`/request-error-logs/${encodeURIComponent(filename)}`, {
      responseType: 'blob'
    })
};
