/**
 * AI provider workbench view models that normalize each brand's heterogeneous config.
 */

import type { OpenAIProviderConfig, ProviderKeyConfig } from '@/types';

export type ProviderBrand =
  | 'gemini'
  | 'codex'
  | 'claude'
  | 'vertex'
  | 'openaiCompatibility'
  | 'apikeyFun';

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
  | {
      brand: 'apikeyFun';
      openaiIndices: number[];
      claudeIndices: number[];
      codexIndices: number[];
    };

export interface ProviderResourceFlags {
  cloakEnabled?: boolean;
  websockets?: boolean;
  isPlaceholder?: boolean;
  protocols?: string[];
}

export interface ProviderResource {
  /** Stable id used for React keys and selected-state checks. */
  id: string;
  brand: ProviderBrand;
  /** Index in the original array. */
  originalIndex: number;
  /** Display name in the key column. OpenAI uses name; other brands use null. */
  name: string | null;
  /** Fallback display text, usually a masked API key or fallback label. */
  identifier: string;
  /** Masked apiKey preview for display. */
  apiKeyPreview: string | null;
  /** Real apiKey used by selectors. OpenAI returns null here because it has multiple keys. */
  apiKey: string | null;
  authIndex: string | null;
  baseUrl: string | null;
  proxyUrl: string | null;
  prefix: string | null;
  modelCount: number;
  /** Deduplicated model names used for filtering and search. */
  models: string[];
  /** Priority used for sorting. Defaults to 0 when unset. */
  priority: number;
  /** weighted-round-robin selection weight. Backend defaults to 1 when unset. */
  selectionWeight?: number;
  headerCount: number;
  excludedModelCount: number;
  /** Meaningful for OpenAI only. Other brands keep it but do not display it. */
  apiKeyEntryCount: number;
  /** Whether the resource is disabled. Each brand has its own rule. */
  disabled: boolean;
  /** Extra capability flags. */
  flags: ProviderResourceFlags;
  /** Selector used for delete and update operations. */
  selector: ProviderResourceSelector;
  /** Original raw config used to initialize sheet forms. */
  raw: unknown;
}

export interface ProviderGroup {
  id: ProviderBrand;
  resources: ProviderResource[];
}

export interface ProviderSnapshot {
  fetchedAt: string;
  groups: ProviderGroup[];
}

export interface SponsorProviderRaw {
  openai: Array<{ config: OpenAIProviderConfig; index: number }>;
  claude: Array<{ config: ProviderKeyConfig; index: number }>;
  codex: Array<{ config: ProviderKeyConfig; index: number }>;
}

/**
 * Common sheet form values.
 * Gemini/Codex/Claude/Vertex/OpenAI share base fields and enable their own advanced areas.
 */
export interface ModelEntryInput {
  name: string;
  alias?: string;
  priority?: number;
  testModel?: string;
  image?: boolean;
  thinkingJson?: string;
}

export type SponsorProtocol = 'openai' | 'codex' | 'claude';

export interface SponsorKeyEntryInput {
  protocol: SponsorProtocol;
  apiKey: string;
  existingApiKey?: string;
  baseUrl: string;
  proxyUrl: string;
  prefix: string;
  disabled: boolean;
  disableCooling?: boolean;
  priority?: number;
  models: ModelEntryInput[];
}

export interface ApiKeyEntryInput {
  apiKey: string;
  existingApiKey?: string;
  proxyUrl: string;
  selectionWeight?: number;
  authIndex?: string;
}

export interface CloakInput {
  mode: string;
  strictMode: boolean;
  sensitiveWordsText: string;
  cacheUserId: boolean;
}

export interface ProviderEntryFormInput {
  /** Passed through apiKeyEntries only when creating OpenAI providers. */
  apiKey: string;
  /** Required for OpenAI and hidden for other brands. */
  name: string;
  baseUrl: string;
  proxyUrl: string;
  prefix: string;
  disabled: boolean;
  disableCooling?: boolean;
  priority?: number;
  selectionWeight?: number;

  /** Advanced collapsible section. */
  models: ModelEntryInput[];
  headers: Array<{ key: string; value: string }>;
  excludedModelsText: string;

  /** Codex only. */
  websockets?: boolean;
  /** Claude only. */
  cloak?: CloakInput;
  experimentalCchSigning?: boolean;
  /** OpenAI persists this; Gemini/Claude use it for one-off connectivity tests. */
  testModel?: string;
  apiKeyEntries?: ApiKeyEntryInput[];
  /** APIKEY.FUN stores one grouped key per platform protocol. */
  sponsorKeyEntries?: SponsorKeyEntryInput[];
}
