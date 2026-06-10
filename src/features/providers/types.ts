/**
 * AI 提供商 Workbench 视图模型(归一化各 brand 的异构 config)
 */

export type ProviderBrand =
  | 'gemini'
  | 'codex'
  | 'claude'
  | 'vertex'
  | 'openaiCompatibility'
  | 'ampcode';

export const PROVIDER_SORT_BY_VALUES = ['name', 'priority', 'recent-success'] as const;
export type ProviderSortBy = (typeof PROVIDER_SORT_BY_VALUES)[number];

export const SORT_DIR_VALUES = ['asc', 'desc'] as const;
export type SortDir = (typeof SORT_DIR_VALUES)[number];

export type ProviderResourceSelector =
  | { brand: 'gemini'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'codex'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'claude'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'vertex'; apiKey: string; baseUrl?: string; index: number }
  | { brand: 'openaiCompatibility'; name: string; index: number }
  | { brand: 'ampcode' };

export interface ProviderResourceFlags {
  cloakEnabled?: boolean;
  websockets?: boolean;
  forceModelMappings?: boolean;
  isPlaceholder?: boolean;
}

export interface ProviderResource {
  /** 稳定 id,用作 React key 与选中态判断 */
  id: string;
  brand: ProviderBrand;
  /** 在原数组中的下标。Ampcode 永远为 0 */
  originalIndex: number;
  /** 表格 key 列显示名(OpenAI=name,其余=null) */
  name: string | null;
  /** 备用展示文字(API 密钥脱敏或 fallback) */
  identifier: string;
  /** apiKey 脱敏预览,展示用 */
  apiKeyPreview: string | null;
  /** 用于 selector 的真实 apiKey;OpenAI 因为多密钥这里返回 null */
  apiKey: string | null;
  authIndex: string | null;
  baseUrl: string | null;
  proxyUrl: string | null;
  prefix: string | null;
  modelCount: number;
  headerCount: number;
  excludedModelCount: number;
  /** 仅 OpenAI 有意义,其它 brand 该字段不展示但保留 */
  apiKeyEntryCount: number;
  /** 是否被禁用(各 brand 判定规则不同) */
  disabled: boolean;
  /** 额外能力旗标 */
  flags: ProviderResourceFlags;
  /** 删除/更新使用的 selector */
  selector: ProviderResourceSelector;
  /** 原始 raw config,Sheet 表单初始化用 */
  raw: unknown;
}

export interface ProviderGroupIssue {
  status?: string;
  message: string;
}

export interface ProviderGroup {
  id: ProviderBrand;
  resources: ProviderResource[];
  issue: ProviderGroupIssue | null;
  /** 描述路径,例如 /ai-providers/gemini,用于 Sheet description */
  path: string;
}

export interface ProviderSnapshot {
  fetchedAt: string;
  groups: ProviderGroup[];
  issues: Array<{ brand: ProviderBrand; message: string }>;
}

/**
 * 通用 Sheet 表单值。
 * Gemini/Codex/Claude/Vertex/OpenAI 共用基础字段,各自启用 advanced 区。
 */
export interface ModelEntryInput {
  name: string;
  alias?: string;
  priority?: number;
  testModel?: string;
}

export interface ApiKeyEntryInput {
  apiKey: string;
  existingApiKey?: string;
  proxyUrl: string;
  authIndex?: string;
}

export interface CloakInput {
  mode: string;
  strictMode: boolean;
  sensitiveWordsText: string;
}

export interface ProviderEntryFormInput {
  /** OpenAI 创建时只在 apiKeyEntries 中传 */
  apiKey: string;
  /** OpenAI 必填,其余 brand 不展示 */
  name: string;
  baseUrl: string;
  proxyUrl: string;
  prefix: string;
  disabled: boolean;
  priority?: number;

  /** 高级折叠区 */
  models: ModelEntryInput[];
  headers: Array<{ key: string; value: string }>;
  excludedModelsText: string;

  /** Codex 专属 */
  websockets?: boolean;
  /** Claude 专属 */
  cloak?: CloakInput;
  /** OpenAI persists this; Gemini/Claude use it for one-off connectivity tests. */
  testModel?: string;
  apiKeyEntries?: ApiKeyEntryInput[];
}
