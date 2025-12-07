/**
 * 日志相关 API
 */

import { apiClient } from './client';

export interface LogsQuery {
  after?: string | number;
  limit?: number;
}

export const logsApi = {
  fetchLogs: (params: LogsQuery = {}) => apiClient.get('/logs', { params }),

  clearLogs: () => apiClient.delete('/logs'),

  fetchErrorLogs: () => apiClient.get('/request-error-logs'),

  downloadErrorLog: (filename: string) =>
    apiClient.getRaw(`/request-error-logs/${encodeURIComponent(filename)}`, {
      responseType: 'blob'
    })
};
