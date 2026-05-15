import { apiClient } from './client';
import type {
  CodexStateListResponse,
  CodexStateManualScorePatchRequest,
  CodexStateManualScorePatchResponse,
  CodexStateRecalcResponse,
  CodexStateRefreshResponse,
} from '@/types';

export const codexStateApi = {
  async list() {
    const data = await apiClient.get<CodexStateListResponse>('/codex-state');
    return Array.isArray(data?.['codex-state']) ? data['codex-state'] : [];
  },

  updateManualScore(payload: CodexStateManualScorePatchRequest) {
    return apiClient.patch<CodexStateManualScorePatchResponse>(
      '/codex-state/manual-score',
      payload
    );
  },

  refreshOne(payload: { id?: string; name?: string; auth_index?: string }) {
    return apiClient.post<CodexStateRefreshResponse>('/codex-state/refresh', payload);
  },

  refreshAll() {
    return apiClient.post<CodexStateRefreshResponse>('/codex-state/refresh', { all: true });
  },

  recalc() {
    return apiClient.post<CodexStateRecalcResponse>('/codex-state/recalc', {});
  },
};
