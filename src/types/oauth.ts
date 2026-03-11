/**
 * OAuth 相关类型
 * 基于原项目 src/modules/oauth.js
 */

// OAuth 提供商类型
export type OAuthProvider =
  | 'codex'
  | 'anthropic'
  | 'antigravity'
  | 'gemini-cli'
  | 'gitlab'
  | 'kimi'
  | 'qwen';

export interface OAuthStartOptions {
  projectId?: string;
  baseUrl?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface OAuthStartResponse {
  url: string;
  state?: string;
}

export interface OAuthStatusResponse {
  status: 'ok' | 'wait' | 'error';
  error?: string;
}

export interface OAuthCallbackResponse {
  status: 'ok';
}

// OAuth 流程状态
export interface OAuthFlow {
  provider: OAuthProvider;
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: Date;
  interval: number;
  status: 'pending' | 'authorized' | 'expired' | 'error';
}

// OAuth 配置
export interface OAuthConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

export interface IFlowCookieAuthResponse {
  status: 'ok' | 'error';
  error?: string;
  saved_path?: string;
  email?: string;
  expired?: string;
  type?: string;
}

export interface GitLabPatAuthResponse {
  status: 'ok' | 'error';
  error?: string;
  saved_path?: string;
  username?: string;
  email?: string;
  token_label?: string;
  model_provider?: string;
  model_name?: string;
}

// OAuth 排除模型列表
export interface OAuthExcludedModels {
  models: string[];
}

// OAuth 模型别名
export interface OAuthModelAliasEntry {
  name: string;
  alias: string;
  fork?: boolean;
}

export type OAuthModelAlias = Record<string, OAuthModelAliasEntry[]>;
