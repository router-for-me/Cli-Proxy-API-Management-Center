/** Quota adapters combine data modules with rendering components. Pages use the common QuotaAdapter contract; each data module retains its specific state types. */

import type { ComponentType } from 'react';
import type { TFunction } from 'i18next';
import { useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import type { QuotaBodyProps } from '../types';
import type { QuotaProviderType, QuotaStore } from './types';
import { ANTIGRAVITY_CONFIG } from './antigravity/data';
import { AntigravityQuotaBody } from './antigravity/AntigravityQuotaBody';
import { CLAUDE_CONFIG } from './claude/data';
import { ClaudeQuotaBody } from './claude/ClaudeQuotaBody';
import { CODEX_CONFIG } from './codex/data';
import { CodexQuotaBody } from './codex/CodexQuotaBody';
import { COPILOT_CONFIG } from './copilot/data';
import { CopilotQuotaBody } from './copilot/CopilotQuotaBody';
import { KIMI_CONFIG } from './kimi/data';
import { KimiQuotaBody } from './kimi/KimiQuotaBody';
import { XAI_CONFIG } from './xai/data';
import { XaiQuotaBody } from './xai/XaiQuotaBody';

/** Common subset of all provider quota states. */
export interface QuotaCardState {
  status: 'idle' | 'loading' | 'success' | 'error';
  error?: string;
  errorStatus?: number;
}

export interface QuotaAdapter {
  type: QuotaProviderType;
  i18nPrefix: string;
  filterFn: (file: AuthFileItem) => boolean;
  fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
  resetQuota?: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
  canResetQuota?: (quota: QuotaCardState) => boolean;
  storeSelector: (state: QuotaStore) => Record<string, QuotaCardState>;
  storeSetter: keyof QuotaStore;
  buildLoadingState: () => QuotaCardState;
  buildSuccessState: (data: unknown) => QuotaCardState;
  buildErrorState: (message: string, status?: number) => QuotaCardState;
  Body: ComponentType<QuotaBodyProps<QuotaCardState>>;
}

export const QUOTA_ADAPTERS: Record<QuotaProviderType, QuotaAdapter> = {
  antigravity: {
    ...ANTIGRAVITY_CONFIG,
    Body: AntigravityQuotaBody,
  } as unknown as QuotaAdapter,
  claude: { ...CLAUDE_CONFIG, Body: ClaudeQuotaBody } as unknown as QuotaAdapter,
  codex: { ...CODEX_CONFIG, Body: CodexQuotaBody } as unknown as QuotaAdapter,
  'github-copilot': { ...COPILOT_CONFIG, Body: CopilotQuotaBody } as unknown as QuotaAdapter,
  kimi: { ...KIMI_CONFIG, Body: KimiQuotaBody } as unknown as QuotaAdapter,
  xai: { ...XAI_CONFIG, Body: XaiQuotaBody } as unknown as QuotaAdapter,
};

export type QuotaMapUpdater = (
  updater: (prev: Record<string, QuotaCardState>) => Record<string, QuotaCardState>
) => void;

/** Read the adapter store setter without subscribing. */
export const getQuotaSetter = (adapter: QuotaAdapter): QuotaMapUpdater =>
  useQuotaStore.getState()[adapter.storeSetter] as unknown as QuotaMapUpdater;

/** Read the adapter quota cache without subscribing. */
export const getQuotaMap = (adapter: QuotaAdapter): Record<string, QuotaCardState> =>
  adapter.storeSelector(useQuotaStore.getState() as unknown as QuotaStore);
