import type { ProviderBrand } from './types';
import { APIKEY_FUN_AFFILIATE_URL } from './sponsor';
import { FENNO_AI_AFFILIATE_URL } from './fennoAI';
import { QINIU_CLOUD_AFFILIATE_URL } from './qiniuCloud';
import { KIMI_INTERNATIONAL_AFFILIATE_URL } from './kimi';

export interface ProviderDescriptor {
  id: ProviderBrand;
  supportsName: boolean;
  supportsApiKey: boolean;
  supportsDisabled: boolean;
  supportsBaseUrl: boolean;
  baseUrlRequired: boolean;
  supportsProxyUrl: boolean;
  supportsPrefix: boolean;
  supportsModels: boolean;
  supportsHeaders: boolean;
  supportsExcludedModels: boolean;
  supportsPriority: boolean;
  supportsRequestScopedErrors: boolean;
  supportsTestModel: boolean;
  supportsWebsockets: boolean;
  supportsCloak: boolean;
  supportsApiKeyEntries: boolean;
  /** Sheet 默认宽度 */
  sheetSize: 'md' | 'lg' | 'xl';
}

export const PROVIDER_DESCRIPTORS: Record<ProviderBrand, ProviderDescriptor> = {
  gemini: {
    id: 'gemini',
    supportsRequestScopedErrors: true,
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: true,
    baseUrlRequired: false,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: true,
    supportsHeaders: true,
    supportsExcludedModels: true,
    supportsPriority: true,
    supportsTestModel: true,
    supportsWebsockets: false,
    supportsCloak: false,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
  interactions: {
    id: 'interactions',
    supportsRequestScopedErrors: true,
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: true,
    baseUrlRequired: false,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: true,
    supportsHeaders: true,
    supportsExcludedModels: true,
    supportsPriority: true,
    supportsTestModel: true,
    supportsWebsockets: false,
    supportsCloak: false,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
  codex: {
    id: 'codex',
    supportsRequestScopedErrors: true,
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: true,
    baseUrlRequired: true,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: true,
    supportsHeaders: true,
    supportsExcludedModels: true,
    supportsPriority: true,
    supportsTestModel: true,
    supportsWebsockets: true,
    supportsCloak: false,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
  meta: {
    id: 'meta',
    supportsRequestScopedErrors: true,
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: true,
    baseUrlRequired: false,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: true,
    supportsHeaders: true,
    supportsExcludedModels: true,
    supportsPriority: true,
    supportsTestModel: true,
    supportsWebsockets: false,
    supportsCloak: false,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
  xai: {
    id: 'xai',
    supportsRequestScopedErrors: true,
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: true,
    baseUrlRequired: true,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: true,
    supportsHeaders: true,
    supportsExcludedModels: true,
    supportsPriority: true,
    supportsTestModel: true,
    supportsWebsockets: true,
    supportsCloak: false,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
  claude: {
    id: 'claude',
    supportsRequestScopedErrors: true,
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: true,
    baseUrlRequired: false,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: true,
    supportsHeaders: true,
    supportsExcludedModels: true,
    supportsPriority: true,
    supportsTestModel: true,
    supportsWebsockets: false,
    supportsCloak: true,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
  vertex: {
    id: 'vertex',
    supportsRequestScopedErrors: false,
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: true,
    baseUrlRequired: false,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: true,
    supportsHeaders: true,
    supportsExcludedModels: true,
    supportsPriority: true,
    supportsTestModel: false,
    supportsWebsockets: false,
    supportsCloak: false,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
  openaiCompatibility: {
    id: 'openaiCompatibility',
    supportsRequestScopedErrors: true,
    supportsName: true,
    supportsApiKey: false,
    supportsDisabled: true,
    supportsBaseUrl: true,
    baseUrlRequired: true,
    supportsProxyUrl: false,
    supportsPrefix: true,
    supportsModels: true,
    supportsHeaders: true,
    supportsExcludedModels: false,
    supportsPriority: true,
    supportsTestModel: true,
    supportsWebsockets: false,
    supportsCloak: false,
    supportsApiKeyEntries: true,
    sheetSize: 'lg',
  },
  apikeyFun: {
    id: 'apikeyFun',
    supportsRequestScopedErrors: true,
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: false,
    baseUrlRequired: false,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: false,
    supportsHeaders: false,
    supportsExcludedModels: false,
    supportsPriority: true,
    supportsTestModel: false,
    supportsWebsockets: false,
    supportsCloak: false,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
  fennoAI: {
    id: 'fennoAI',
    supportsRequestScopedErrors: true,
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: false,
    baseUrlRequired: false,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: false,
    supportsHeaders: false,
    supportsExcludedModels: false,
    supportsPriority: true,
    supportsTestModel: false,
    supportsWebsockets: false,
    supportsCloak: false,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
  qiniuCloud: {
    id: 'qiniuCloud',
    supportsRequestScopedErrors: true,
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: false,
    baseUrlRequired: false,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: false,
    supportsHeaders: false,
    supportsExcludedModels: false,
    supportsPriority: true,
    supportsTestModel: false,
    supportsWebsockets: false,
    supportsCloak: false,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
  kimi: {
    id: 'kimi',
    supportsRequestScopedErrors: true,
    supportsName: false,
    supportsApiKey: true,
    supportsDisabled: true,
    supportsBaseUrl: false,
    baseUrlRequired: false,
    supportsProxyUrl: true,
    supportsPrefix: true,
    supportsModels: false,
    supportsHeaders: false,
    supportsExcludedModels: false,
    supportsPriority: true,
    supportsTestModel: false,
    supportsWebsockets: false,
    supportsCloak: false,
    supportsApiKeyEntries: false,
    sheetSize: 'md',
  },
};

export const getProviderBehaviorCapabilities = (brand: ProviderBrand) => ({
  alphaSearch: brand === 'codex',
  disableCodexCloaking: brand === 'codex',
  rebuildMidSystemMessage: brand === 'claude',
  supportPromptCacheKey: brand === 'openaiCompatibility',
});

export interface ProviderModelCapabilities {
  maxContextLength: boolean;
  isCompat: boolean;
  configurationUpdate: boolean;
  modalities: boolean;
}

/** API-key model capabilities; aliases of CodexModel do not imply runtime support. */
export const getProviderModelCapabilities = (brand: ProviderBrand): ProviderModelCapabilities => ({
  maxContextLength: brand !== 'vertex',
  isCompat: brand !== 'vertex',
  configurationUpdate: brand === 'codex',
  modalities: brand === 'openaiCompatibility',
});

export const PROVIDER_BRAND_ORDER: ProviderBrand[] = [
  'kimi',
  'gemini',
  'interactions',
  'codex',
  'meta',
  'xai',
  'claude',
  'vertex',
  'openaiCompatibility',
  'apikeyFun',
  'fennoAI',
  'qiniuCloud',
];

// Where to send a user who needs credentials for this provider. Absent entry =
// no sensible signup target (openaiCompatibility is user-supplied infrastructure).
export const PROVIDER_SIGNUP_URLS: Partial<Record<ProviderBrand, string>> = {
  // Provider marketing/home sites — NOT console/oauth walls (user: "jump to the
  // provider site, not to an oauth page").
  gemini: 'https://ai.google.dev/',
  interactions: 'https://ai.google.dev/',
  codex: 'https://openai.com/',
  meta: 'https://llama-api.com/',
  xai: 'https://x.ai/',
  claude: 'https://www.anthropic.com/',
  vertex: 'https://cloud.google.com/vertex-ai',
  apikeyFun: APIKEY_FUN_AFFILIATE_URL,
  fennoAI: FENNO_AI_AFFILIATE_URL,
  qiniuCloud: QINIU_CLOUD_AFFILIATE_URL,
  kimi: KIMI_INTERNATIONAL_AFFILIATE_URL,
};

// Site URL per openai-compatibility provider NAME (the config entry name from
// bin/sync_providers.js). Values cross-checked against the Meccano framework
// catalog (D:/Source-Meccano/Meccano.Meta/.meccano/config/providers/
// inference_providers.yaml, READ-ONLY) where it has an url: field
// (z-ai, moonshot, nvidia, openrouter, orcarouter, groq, anthropic, hive,
// tokenrouter); the rest are the providers' official home pages.
// Unknown names get no link — a wrong guess is worse than none.
export const OPENAI_COMPAT_PROVIDER_SITES: Record<string, string> = {
  zai: 'https://z.ai',
  moonshot: 'https://moonshot.ai',
  openai: 'https://openai.com',
  gemini: 'https://ai.google.dev',
  deepseek: 'https://deepseek.com',
  groq: 'https://groq.com',
  mistral: 'https://mistral.ai',
  xai: 'https://x.ai',
  nvidia: 'https://build.nvidia.com',
  siliconflow: 'https://siliconflow.cn',
  dashscope: 'https://www.aliyun.com/product/bailian',
  'dashscope-intl': 'https://www.alibabacloud.com/en/product/modelstudio',
  ark: 'https://www.volcengine.com/product/doubao',
  bigmodel: 'https://open.bigmodel.cn',
  minimax: 'https://www.minimax.io',
  minimaxi: 'https://www.minimax.cn',
  ollama: 'https://ollama.com',
  blackbox: 'https://www.blackbox.ai',
  airforce: 'https://api.airforce',
  logfare: 'https://logfare.ai',
  orcarouter: 'https://www.orcarouter.ai',
  tokenrouter: 'https://tokenrouter.com',
  thehive: 'https://thehive.ai',
  openrouter: 'https://openrouter.ai',
};
