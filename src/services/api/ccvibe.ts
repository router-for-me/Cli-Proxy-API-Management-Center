import { apiClient } from './client';

export interface CCVibeStatus {
  configured: boolean;
  state: string;
  ready: boolean;
  model: string;
  endpoint: string;
  message?: string;
}

export const ccvibeApi = {
  getStatus: () => apiClient.get<CCVibeStatus>('/ccvibe'),
  start: () => apiClient.post<CCVibeStatus>('/ccvibe/start'),
  stop: () => apiClient.post<CCVibeStatus>('/ccvibe/stop'),
};
