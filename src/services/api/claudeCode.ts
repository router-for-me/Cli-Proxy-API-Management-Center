/**
 * Claude Code quota API
 */

import type { ClaudeCodeQuotaInfo } from '@/types';
import { apiClient } from './client';

export interface ClaudeCodeQuotaResponse {
  auth_id: string;
  email: string;
  label: string;
  quota: ClaudeCodeQuotaInfo;
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