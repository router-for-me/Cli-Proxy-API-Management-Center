import { apiClient } from './client';

/** One known coding agent as reported by the cli-agents companion binary. */
export interface CodingAgentStatus {
  name: string;
  label: string;
  file: string;
  exists: boolean;
  status: 'configured' | 'other-config' | 'not-installed';
}

export interface CodingAgentsStatusResponse {
  agents: CodingAgentStatus[];
}

export interface CodingAgentBackupEntry {
  agent: string;
  file: string;
  backup: string;
  existed: boolean;
}

export interface CodingAgentBackupStamp {
  stamp: string;
  url: string;
  entries: CodingAgentBackupEntry[];
}

export interface CodingAgentsBackupsResponse {
  stamps: CodingAgentBackupStamp[];
}

export interface CodingAgentOperationResult {
  ok: boolean;
  stamp?: string | null;
  lines?: string[];
  error?: string;
}

/** Read-only preview of what applying an agent would write. */
export interface CodingAgentPlan {
  ok: boolean;
  name: string;
  label: string;
  file: string;
  exists: boolean;
  creates: boolean;
  changes: string[];
  /** Future auto-setup capabilities (hooks, …); rendered only when non-empty. */
  hooks: string[];
  error?: string;
}

const TIMEOUT_MS = 90 * 1000;

/** Thin passthrough to the proxy endpoints that drive bin/cli-agents. */
export const codingAgentsApi = {
  getStatus: () =>
    apiClient.get<CodingAgentsStatusResponse>('/coding-agents/status', { timeout: TIMEOUT_MS }),
  getBackups: () =>
    apiClient.get<CodingAgentsBackupsResponse>('/coding-agents/backups', { timeout: TIMEOUT_MS }),
  getPlan: (name: string) =>
    apiClient.get<CodingAgentPlan>('/coding-agents/plan', { params: { name }, timeout: TIMEOUT_MS }),
  apply: (name: string) =>
    apiClient.post<CodingAgentOperationResult>('/coding-agents/apply', { name }, { timeout: TIMEOUT_MS }),
  revert: (stamp?: string) =>
    apiClient.post<CodingAgentOperationResult>('/coding-agents/revert', stamp ? { stamp } : {}, { timeout: TIMEOUT_MS }),
};
