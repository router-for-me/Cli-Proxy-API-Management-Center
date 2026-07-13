/**
 * 配置相关 API
 */

import { apiClient } from './client';
import type {
  CodexInstructionsConfig,
  Config,
  RawCodexInstructionsConfig,
  RawXAIConfig,
  XAIConfig,
} from '@/types';
import { normalizeConfigResponse } from './transformers';

const DEFAULT_CODEX_INSTRUCTIONS: CodexInstructionsConfig = {
  enabled: false,
  mode: 'prepend',
  content: '',
  file: '',
  models: ['gpt-5.5', 'gpt-5*'],
  oauthOnly: true,
  requireAuthAllow: true,
  reserveMarkedAuths: false,
  usePrefixSuffix: true,
  requestMarkers: {
    prefixes: ['private/'],
    suffixes: ['-private'],
  },
};

const DEFAULT_XAI_CONFIG: XAIConfig = {
  saveCooldownStatus: true,
  autoDisablePermissionDenied: true,
  otherForbiddenCooldownHours: 6,
  freeUsageExhaustedCooldownHours: 24,
  freeUsageExhaustedDisableAfter: 3,
  otherForbiddenDisableAfter: 3,
};

function normalizeStringList(values: unknown, fallback: string[]): string[] {
  if (!Array.isArray(values)) return fallback;
  const list = values
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => String(value).trim());
  return list.length > 0 ? list : fallback;
}

function normalizeCodexInstructionsResponse(
  raw: RawCodexInstructionsConfig
): CodexInstructionsConfig {
  const mode = raw.mode === 'append' || raw.mode === 'replace' ? raw.mode : 'prepend';
  const models = Array.isArray(raw.models)
    ? raw.models
        .filter((model) => typeof model === 'string' && model.trim())
        .map((model) => model.trim())
    : DEFAULT_CODEX_INSTRUCTIONS.models;
  const markers = raw['request-markers'] ?? raw.requestMarkers ?? {};

  return {
    enabled: Boolean(raw.enabled),
    mode,
    content: typeof raw.content === 'string' ? raw.content : '',
    file: typeof raw.file === 'string' ? raw.file : '',
    models: models.length > 0 ? models : DEFAULT_CODEX_INSTRUCTIONS.models,
    oauthOnly: typeof raw['oauth-only'] === 'boolean' ? raw['oauth-only'] : raw.oauthOnly !== false,
    requireAuthAllow:
      typeof raw['require-auth-allow'] === 'boolean'
        ? raw['require-auth-allow']
        : raw.requireAuthAllow !== false,
    reserveMarkedAuths: Boolean(
      typeof raw['reserve-marked-auths'] === 'boolean'
        ? raw['reserve-marked-auths']
        : raw.reserveMarkedAuths
    ),
    usePrefixSuffix:
      typeof raw['use-prefix-suffix'] === 'boolean'
        ? raw['use-prefix-suffix']
        : raw.usePrefixSuffix !== false,
    requestMarkers: {
      prefixes: normalizeStringList(
        markers.prefixes,
        DEFAULT_CODEX_INSTRUCTIONS.requestMarkers.prefixes
      ),
      suffixes: normalizeStringList(
        markers.suffixes,
        DEFAULT_CODEX_INSTRUCTIONS.requestMarkers.suffixes
      ),
    },
  };
}

function serializeCodexInstructions(config: CodexInstructionsConfig): RawCodexInstructionsConfig {
  return {
    enabled: config.enabled,
    mode: config.mode,
    content: config.content,
    file: config.file,
    models: config.models.map((model) => model.trim()).filter(Boolean),
    'oauth-only': config.oauthOnly,
    'require-auth-allow': config.requireAuthAllow,
    'reserve-marked-auths': config.reserveMarkedAuths,
    'use-prefix-suffix': config.usePrefixSuffix,
    'request-markers': {
      prefixes: config.requestMarkers.prefixes.map((value) => value.trim()).filter(Boolean),
      suffixes: config.requestMarkers.suffixes.map((value) => value.trim()).filter(Boolean),
    },
  };
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

export function normalizeXAIConfigResponse(raw: RawXAIConfig): XAIConfig {
  return {
    saveCooldownStatus:
      typeof raw['save-cooldown-status'] === 'boolean'
        ? raw['save-cooldown-status']
        : raw.saveCooldownStatus !== false,
    autoDisablePermissionDenied:
      typeof raw['auto-disable-permission-denied'] === 'boolean'
        ? raw['auto-disable-permission-denied']
        : raw.autoDisablePermissionDenied !== false,
    otherForbiddenCooldownHours: normalizeNonNegativeInteger(
      raw['other-403-cooldown-hours'] ?? raw.otherForbiddenCooldownHours,
      DEFAULT_XAI_CONFIG.otherForbiddenCooldownHours
    ),
    freeUsageExhaustedCooldownHours: normalizeNonNegativeInteger(
      raw['free-usage-exhausted-cooldown-hours'] ?? raw.freeUsageExhaustedCooldownHours,
      DEFAULT_XAI_CONFIG.freeUsageExhaustedCooldownHours
    ),
    freeUsageExhaustedDisableAfter: normalizeNonNegativeInteger(
      raw['free-usage-exhausted-disable-after'] ?? raw.freeUsageExhaustedDisableAfter,
      DEFAULT_XAI_CONFIG.freeUsageExhaustedDisableAfter
    ),
    otherForbiddenDisableAfter: normalizeNonNegativeInteger(
      raw['other-403-disable-after'] ?? raw.otherForbiddenDisableAfter,
      DEFAULT_XAI_CONFIG.otherForbiddenDisableAfter
    ),
  };
}

function serializeXAIConfig(config: XAIConfig): RawXAIConfig {
  return {
    'save-cooldown-status': config.saveCooldownStatus,
    'auto-disable-permission-denied': config.autoDisablePermissionDenied,
    'other-403-cooldown-hours': Math.max(0, Math.floor(config.otherForbiddenCooldownHours)),
    'free-usage-exhausted-cooldown-hours': Math.max(
      0,
      Math.floor(config.freeUsageExhaustedCooldownHours)
    ),
    'free-usage-exhausted-disable-after': Math.max(
      0,
      Math.floor(config.freeUsageExhaustedDisableAfter)
    ),
    'other-403-disable-after': Math.max(0, Math.floor(config.otherForbiddenDisableAfter)),
  };
}

export const configApi = {
  /**
   * 获取配置（会进行字段规范化）
   */
  async getConfig(): Promise<Config> {
    const raw = await apiClient.get('/config');
    return normalizeConfigResponse(raw);
  },

  /**
   * 请求日志开关
   */
  updateRequestLog: (enabled: boolean) => apiClient.put('/request-log', { value: enabled }),

  /**
   * 获取 Codex/ChatGPT OAuth 私人指令配置
   */
  async getCodexInstructions(): Promise<CodexInstructionsConfig> {
    const raw = await apiClient.get<RawCodexInstructionsConfig>('/codex-instructions');
    return normalizeCodexInstructionsResponse(raw ?? {});
  },

  /**
   * 保存 Codex/ChatGPT OAuth 私人指令配置
   */
  async updateCodexInstructions(config: CodexInstructionsConfig): Promise<CodexInstructionsConfig> {
    await apiClient.put('/codex-instructions', serializeCodexInstructions(config));
    return config;
  },

  async getXAIConfig(): Promise<XAIConfig> {
    const raw = await apiClient.get<RawXAIConfig>('/xai-config');
    return normalizeXAIConfigResponse(raw ?? {});
  },

  async updateXAIConfig(config: XAIConfig): Promise<XAIConfig> {
    await apiClient.put('/xai-config', serializeXAIConfig(config));
    return config;
  },
};
