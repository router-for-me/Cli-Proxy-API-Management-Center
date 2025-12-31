/**
 * Claude Code quota API
 */

import { apiClient } from './client';

export interface ClaudeCodeQuotaResponse {
  auth_id: string;
  email: string;
  label: string;
  quota: {
    unified_status: string;
    five_hour_status: string;
    five_hour_reset: number;
    five_hour_utilization: number;
    seven_day_status: string;
    seven_day_reset: number;
    seven_day_utilization: number;
    overage_status: string;
    overage_reset: number;
    overage_utilization: number;
    representative_claim: string;
    fallback_percentage: number;
    unified_reset: number;
    last_updated: string;
  };
}

export interface ClaudeCodeQuotasResponse {
  count: number;
  quotas: ClaudeCodeQuotaResponse[];
}

export const claudeCodeApi = {
  /**
   * Get all Claude Code quotas
   */
  getAllQuotas: () => apiClient.get<ClaudeCodeQuotasResponse>('/claude-api-key/quotas'),

  /**
   * Get quota for a specific auth file
   */
  getQuota: (authId: string) =>
    apiClient.get<ClaudeCodeQuotaResponse>(`/claude-api-key/quota/${encodeURIComponent(authId)}`),

  /**
   * Refresh quota for a specific auth file
   */
  refreshQuota: (authId: string) =>
    apiClient.post<ClaudeCodeQuotaResponse>(`/claude-api-key/quota/${encodeURIComponent(authId)}/refresh`)
};