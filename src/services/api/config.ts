/**
 * 配置相关 API
 */

import { apiClient } from './client';
import type { CodexInstructionsConfig, Config, RawCodexInstructionsConfig } from '@/types';
import { normalizeConfigResponse } from './transformers';

const DEFAULT_CODEX_INSTRUCTIONS: CodexInstructionsConfig = {
  enabled: false,
  mode: 'prepend',
  content: '',
  file: '',
  models: ['gpt-5.5', 'gpt-5*'],
  oauthOnly: true,
};

function normalizeCodexInstructionsResponse(raw: RawCodexInstructionsConfig): CodexInstructionsConfig {
  const mode = raw.mode === 'append' || raw.mode === 'replace' ? raw.mode : 'prepend';
  const models = Array.isArray(raw.models)
    ? raw.models.filter((model) => typeof model === 'string' && model.trim()).map((model) => model.trim())
    : DEFAULT_CODEX_INSTRUCTIONS.models;

  return {
    enabled: Boolean(raw.enabled),
    mode,
    content: typeof raw.content === 'string' ? raw.content : '',
    file: typeof raw.file === 'string' ? raw.file : '',
    models: models.length > 0 ? models : DEFAULT_CODEX_INSTRUCTIONS.models,
    oauthOnly: typeof raw['oauth-only'] === 'boolean' ? raw['oauth-only'] : raw.oauthOnly !== false,
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
   * 获取原始配置（不做转换）
   */
  getRawConfig: () => apiClient.get('/config'),

  /**
   * 更新 Debug 模式
   */
  updateDebug: (enabled: boolean) => apiClient.put('/debug', { value: enabled }),

  /**
   * 更新代理 URL
   */
  updateProxyUrl: (proxyUrl: string) => apiClient.put('/proxy-url', { value: proxyUrl }),

  /**
   * 清除代理 URL
   */
  clearProxyUrl: () => apiClient.delete('/proxy-url'),

  /**
   * 更新重试次数
   */
  updateRequestRetry: (retryCount: number) =>
    apiClient.put('/request-retry', { value: retryCount }),

  /**
   * 配额回退：切换项目
   */
  updateSwitchProject: (enabled: boolean) =>
    apiClient.put('/quota-exceeded/switch-project', { value: enabled }),

  /**
   * 配额回退：切换预览模型
   */
  updateSwitchPreviewModel: (enabled: boolean) =>
    apiClient.put('/quota-exceeded/switch-preview-model', { value: enabled }),

  /**
   * 请求日志开关
   */
  updateRequestLog: (enabled: boolean) => apiClient.put('/request-log', { value: enabled }),

  /**
   * 写日志到文件开关
   */
  updateLoggingToFile: (enabled: boolean) => apiClient.put('/logging-to-file', { value: enabled }),

  /**
   * 获取日志总大小上限（MB）
   */
  async getLogsMaxTotalSizeMb(): Promise<number> {
    const data = await apiClient.get<Record<string, unknown>>('/logs-max-total-size-mb');
    const value = data?.['logs-max-total-size-mb'] ?? 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  },

  /**
   * 更新日志总大小上限（MB）
   */
  updateLogsMaxTotalSizeMb: (value: number) => apiClient.put('/logs-max-total-size-mb', { value }),

  /**
   * WebSocket 鉴权开关
   */
  updateWsAuth: (enabled: boolean) => apiClient.put('/ws-auth', { value: enabled }),

  /**
   * 获取强制模型前缀开关
   */
  async getForceModelPrefix(): Promise<boolean> {
    const data = await apiClient.get<Record<string, unknown>>('/force-model-prefix');
    return Boolean(data?.['force-model-prefix'] ?? false);
  },

  /**
   * 更新强制模型前缀开关
   */
  updateForceModelPrefix: (enabled: boolean) =>
    apiClient.put('/force-model-prefix', { value: enabled }),

  /**
   * 获取路由策略
   */
  async getRoutingStrategy(): Promise<string> {
    const data = await apiClient.get<Record<string, unknown>>('/routing/strategy');
    const strategy = data?.strategy;
    return typeof strategy === 'string' ? strategy : 'round-robin';
  },

  /**
   * 更新路由策略
   */
  updateRoutingStrategy: (strategy: string) =>
    apiClient.put('/routing/strategy', { value: strategy }),

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
};
