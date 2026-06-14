import type { ProviderBrand } from './types';

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
};

export const PROVIDER_BRAND_ORDER: ProviderBrand[] = [
  'gemini',
  'codex',
  'claude',
  'vertex',
  'openaiCompatibility',
];
