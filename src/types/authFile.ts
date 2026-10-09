/**
 * Auth-file types, based on the original src/modules/auth-files.js.
 */

import type { RecentRequestBucket } from '@/utils/recentRequests';
import type { ClaudeUsageSnapshot } from './quota';

export type AuthFileType =
  | 'qwen'
  | 'kimi'
  | 'gemini'
  | 'aistudio'
  | 'claude'
  | 'codex'
  | 'devin'
  | 'meta'
  | 'antigravity'
  | 'xai'
  | 'iflow'
  | 'vertex'
  | 'empty'
  | 'unknown';

export interface AuthFileCooldown {
  scope: 'model' | 'credential';
  modelKey?: string;
  reason: string;
  retryAt: string;
  remainingSeconds: number;
  backoffLevel?: number;
  httpStatus?: number;
}

export interface AuthFileCooldownSnapshot {
  /** Server observation time, not the start of the cooldown. */
  observedAt?: string;
  /** Local receipt time anchors relative timers without relying on synchronized clocks. */
  receivedAtMs: number;
  /** null = runtime state unknown; [] = known, with no active timers. */
  records: AuthFileCooldown[] | null;
}

export interface AuthFileItem {
  name: string;
  type?: AuthFileType | string;
  provider?: string;
  /**
   * Credential email from disk JSON or registered metadata/attributes.
   * Never use account/account_type for display or search: API-key credentials
   * expose the secret itself through AccountInfo().
   */
  email?: string;
  /** GCP / Vertex project ID, used as identity when the email is missing. */
  projectId?: string;
  size?: number;
  authIndex?: string | number | null;
  /** Generic plugin quota capability advertised by CPA's auth-files API. */
  supportsQuota?: boolean;
  quotaProvider?: string;
  runtimeOnly?: boolean | string;
  disabled?: boolean;
  unavailable?: boolean;
  status?: string;
  statusMessage?: string;
  lastRefresh?: string | number;
  modified?: number;
  priority?: number;
  weight?: number;
  note?: string;
  success?: unknown;
  failed?: unknown;
  /** Cumulative counts normalized from success/failed at the API boundary. */
  successCount?: number;
  failureCount?: number;
  recent_requests?: RecentRequestBucket[];
  recentRequests?: RecentRequestBucket[];
  /** Absent on older servers. Never interpreted as credential health. */
  cooldownSnapshot?: AuthFileCooldownSnapshot;
  /** Read-only upstream usage observation; never used to determine credential health. */
  claudeUsage?: ClaudeUsageSnapshot | null;
  claudeUsageStale?: boolean;
  [key: string]: unknown;
}

export interface AuthFilesResponse {
  files: AuthFileItem[];
  total?: number;
  observed_at?: unknown;
  observedAt?: string;
}
