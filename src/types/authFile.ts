/**
 * 认证文件相关类型
 * 基于原项目 src/modules/auth-files.js
 */

import type { RecentRequestBucket } from '@/utils/recentRequests';

export type AuthFileType =
  | 'qwen'
  | 'kimi'
  | 'gemini'
  | 'gemini-cli'
  | 'aistudio'
  | 'claude'
  | 'codex'
  | 'antigravity'
  | 'xai'
  | 'iflow'
  | 'vertex'
  | 'empty'
  | 'unknown';

export interface AuthFileItem {
  name: string;
  type?: AuthFileType | string;
  provider?: string;
  size?: number;
  authIndex?: string | number | null;
  runtimeOnly?: boolean | string;
  disabled?: boolean;
  unavailable?: boolean;
  status?: string;
  statusMessage?: string;
  lastRefresh?: string | number;
  modified?: number;
  success?: unknown;
  failed?: unknown;
  recent_requests?: RecentRequestBucket[];
  recentRequests?: RecentRequestBucket[];
  // openai-compatibility sub-provider routing (e.g. "deepseek", "ollama").
  provider_key?: string;
  compat_name?: string;
  // Upstream connection info — needed to match this auth against
  // GET /api-key-usage response keys ("<baseURL>|<apiKey>").
  base_url?: string;
  api_key?: string;
  // Provider-specific balance snapshot already fetched by the backend.
  balance?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AuthFilesResponse {
  files: AuthFileItem[];
  total?: number;
}
