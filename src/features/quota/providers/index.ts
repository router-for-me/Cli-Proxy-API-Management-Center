/**
 * 额度提供商适配器 = 数据层（data.ts，React-free）+ 渲染体（*QuotaBody.tsx）。
 *
 * 页面侧以擦除泛型的 QuotaAdapter 视图统一消费（与 AuthFileQuotaSection 的
 * 窄接口 cast 同一模式）；具体状态类型由各 data.ts 的强类型导出承载。
 */

import type { ComponentType } from 'react';
import type { PoolProviderId } from '@/domain/quotaPool/types';
import { refreshPoolAccountAfterReset } from '@/features/quotaPool/accountSync';
import type { SourceSession } from '@/services/api/sourceSession';
import type { QuotaStore as BoundQuotaStore } from '@/stores/useQuotaStore';
import { createQuotaConfigs } from './scoped';
import { createSourceResetGrants, type ResetGrantScope } from './claude/resetGrantScope';
import type { TFunction } from 'i18next';
import { useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import type { QuotaBodyProps } from '../types';
import type { QuotaProviderType, QuotaStore } from './types';
import { AntigravityQuotaBody } from './antigravity/AntigravityQuotaBody';
import { ClaudeQuotaBody } from './claude/ClaudeQuotaBody';
import { DevinQuotaBody } from './devin/DevinQuotaBody';
import { CodexQuotaBody } from './codex/CodexQuotaBody';
import { MetaQuotaBody } from './meta/MetaQuotaBody';
import { KimiQuotaBody } from './kimi/KimiQuotaBody';
import { PluginQuotaBody } from './plugin/PluginQuotaBody';
import { XaiQuotaBody } from './xai/XaiQuotaBody';

/** 所有 provider 额度状态的公共骨架（各 *QuotaState 的结构子集）。 */
export interface QuotaCardState {
  status: 'idle' | 'loading' | 'success' | 'error';
  error?: string;
  errorStatus?: number;
}

export interface QuotaAdapter {
  type: QuotaProviderType;
  /** The source session's reset-grant reads and claim journal; the only reset path. */
  resetGrants: ResetGrantScope;
  i18nPrefix: string;
  filterFn: (file: AuthFileItem) => boolean;
  fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
  enrichQuota?: (file: AuthFileItem, data: unknown, t: TFunction) => Promise<unknown>;
  resetQuota?: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
  canResetQuota?: (quota: QuotaCardState) => boolean;
  storeSelector: (state: QuotaStore) => Record<string, QuotaCardState>;
  storeSetter: keyof QuotaStore;
  buildLoadingState: () => QuotaCardState;
  buildSuccessState: (data: unknown) => QuotaCardState;
  buildErrorState: (message: string, status?: number) => QuotaCardState;
  Body: ComponentType<QuotaBodyProps<QuotaCardState>>;
}

export const QUOTA_PRESENTATION: Record<QuotaProviderType, Pick<QuotaAdapter, 'Body'>> = {
  antigravity: { Body: AntigravityQuotaBody as unknown as QuotaAdapter['Body'] },
  claude: { Body: ClaudeQuotaBody as unknown as QuotaAdapter['Body'] },
  codex: { Body: CodexQuotaBody as unknown as QuotaAdapter['Body'] },
  devin: { Body: DevinQuotaBody as unknown as QuotaAdapter['Body'] },
  kimi: { Body: KimiQuotaBody as unknown as QuotaAdapter['Body'] },
  meta: { Body: MetaQuotaBody as unknown as QuotaAdapter['Body'] },
  plugin: { Body: PluginQuotaBody as unknown as QuotaAdapter['Body'] },
  xai: { Body: XaiQuotaBody as unknown as QuotaAdapter['Body'] },
};

/**
 * A confirmed reset attempt may have spent the credit even when a later step failed, so every
 * attempt, from any page, has the history server re-read that account (accountSync.ts).
 */
function withPoolRefresh(
  session: SourceSession,
  provider: PoolProviderId,
  reset: (file: AuthFileItem, t: TFunction) => Promise<unknown>
): QuotaAdapter['resetQuota'] {
  return async (file, t) => {
    try {
      return await reset(file, t);
    } finally {
      // Even if the page was left meanwhile: the attempt happened, and the server is per source.
      void refreshPoolAccountAfterReset(session.owner, provider, file.auth_index ?? file.authIndex);
    }
  };
}

/** Create once per source session/store; no requests occur during construction. */
export function createQuotaAdapters(
  session: SourceSession,
  store?: BoundQuotaStore
): Record<QuotaProviderType, QuotaAdapter> {
  const configs = createQuotaConfigs(session, store);
  const resetGrants = createSourceResetGrants(session);
  return Object.fromEntries(
    Object.entries(configs).map(([type, config]) => [
      type,
      {
        ...config,
        ...(type === 'codex' && config.resetQuota
          ? { resetQuota: withPoolRefresh(session, 'codex', config.resetQuota) }
          : {}),
        Body: QUOTA_PRESENTATION[type as QuotaProviderType].Body,
        resetGrants,
      },
    ])
  ) as Record<QuotaProviderType, QuotaAdapter>;
}

export type QuotaMapUpdater = (
  updater: (prev: Record<string, QuotaCardState>) => Record<string, QuotaCardState>
) => void;

/** 取 adapter 对应的 store setter（getState 直读，不建立订阅）。 */
export const getQuotaSetter = (
  adapter: QuotaAdapter,
  store: BoundQuotaStore = useQuotaStore
): QuotaMapUpdater => store.getState()[adapter.storeSetter] as unknown as QuotaMapUpdater;

/** 取 adapter 对应的额度缓存快照（getState 直读，不建立订阅）。 */
export const getQuotaMap = (
  adapter: QuotaAdapter,
  store: BoundQuotaStore = useQuotaStore
): Record<string, QuotaCardState> =>
  adapter.storeSelector(store.getState() as unknown as QuotaStore);
