/**
 * 配置相关类型定义
 * 与基线 /config 返回结构保持一致（内部使用驼峰形式）
 */

import type { GeminiKeyConfig, ProviderKeyConfig, OpenAIProviderConfig } from './provider';

export interface QuotaExceededConfig {
  switchProject?: boolean;
  switchPreviewModel?: boolean;
  antigravityCredits?: boolean;
}

export interface Config {
  debug?: boolean;
  proxyUrl?: string;
  requestRetry?: number;
  quotaExceeded?: QuotaExceededConfig;
  requestLog?: boolean;
  loggingToFile?: boolean;
  logsMaxTotalSizeMb?: number;
  wsAuth?: boolean;
  forceModelPrefix?: boolean;
  routingStrategy?: string;
  apiKeys?: string[];
  geminiApiKeys?: GeminiKeyConfig[];
  codexApiKeys?: ProviderKeyConfig[];
  claudeApiKeys?: ProviderKeyConfig[];
  vertexApiKeys?: ProviderKeyConfig[];
  openaiCompatibility?: OpenAIProviderConfig[];
  oauthExcludedModels?: Record<string, string[]>;
  raw?: Record<string, unknown>;
}

export type CodexInstructionsMode = 'prepend' | 'append' | 'replace';

export interface CodexInstructionMarkersConfig {
  prefixes: string[];
  suffixes: string[];
}

export interface CodexInstructionsConfig {
  enabled: boolean;
  mode: CodexInstructionsMode;
  content: string;
  file: string;
  models: string[];
  oauthOnly: boolean;
  requireAuthAllow: boolean;
  reserveMarkedAuths: boolean;
  requestMarkers: CodexInstructionMarkersConfig;
}

export interface RawCodexInstructionsConfig {
  enabled?: boolean;
  mode?: string;
  content?: string;
  file?: string;
  models?: string[];
  'oauth-only'?: boolean;
  oauthOnly?: boolean;
  'require-auth-allow'?: boolean;
  requireAuthAllow?: boolean;
  'reserve-marked-auths'?: boolean;
  reserveMarkedAuths?: boolean;
  'request-markers'?: {
    prefixes?: string[];
    suffixes?: string[];
  };
  requestMarkers?: {
    prefixes?: string[];
    suffixes?: string[];
  };
}

export interface XAIConfig {
  autoDisablePermissionDenied: boolean;
  otherForbiddenCooldownHours: number;
  freeUsageExhaustedCooldownHours: number;
}

export interface RawXAIConfig {
  'auto-disable-permission-denied'?: boolean;
  autoDisablePermissionDenied?: boolean;
  'other-403-cooldown-hours'?: number;
  otherForbiddenCooldownHours?: number;
  'free-usage-exhausted-cooldown-hours'?: number;
  freeUsageExhaustedCooldownHours?: number;
}

export type RawConfigSection =
  | 'debug'
  | 'proxy-url'
  | 'request-retry'
  | 'quota-exceeded'
  | 'request-log'
  | 'logging-to-file'
  | 'logs-max-total-size-mb'
  | 'ws-auth'
  | 'force-model-prefix'
  | 'routing/strategy'
  | 'api-keys'
  | 'gemini-api-key'
  | 'codex-api-key'
  | 'claude-api-key'
  | 'vertex-api-key'
  | 'openai-compatibility'
  | 'oauth-excluded-models';
