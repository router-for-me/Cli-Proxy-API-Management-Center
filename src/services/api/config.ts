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
};
