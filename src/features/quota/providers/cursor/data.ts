import type { TFunction } from 'i18next';
import type { AuthFileItem, CursorQuotaData, CursorQuotaState } from '@/types';
import { apiClient } from '@/services/api/client';
import { isDisabledAuthFile, resolveAuthProvider } from '@/utils/quota';
import type { QuotaProviderData } from '../types';

interface CursorStatusAccount {
  name?: string;
  auth_index?: string;
  subscription_quota?: {
    status?: string;
    reason?: string;
    plan_name?: string;
    price?: string;
    display_message?: string;
    auto_display_message?: string;
    api_display_message?: string;
    included_percent_used?: number | null;
    auto_percent_used?: number | null;
    api_percent_used?: number | null;
    included_spend_cents?: number | null;
    included_limit_cents?: number | null;
    cycle_start_at?: string;
    resets_at?: string;
    grok_bot_label?: string;
    grok_bot_percent_used?: number | null;
    grok_bot_cycle_start_at?: string;
    grok_bot_resets_at?: string;
    on_demand_kind?: string;
    on_demand_used_cents?: number | null;
    on_demand_limit_cents?: number | null;
  };
}

interface CursorStatusResponse {
  accounts?: CursorStatusAccount[];
}

const asPercent = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const asCents = (value: number | null | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export async function fetchCursorQuota(file: AuthFileItem): Promise<CursorQuotaData> {
  const payload = await apiClient.get<CursorStatusResponse>('/plugins/cursor/status');
  const name = String(file.name ?? '');
  const authIndex = String(file.auth_index ?? file.authIndex ?? '');
  const account = (payload.accounts ?? []).find(
    (candidate) =>
      (name !== '' && candidate.name === name) ||
      (authIndex !== '' && candidate.auth_index === authIndex)
  );
  const quota = account?.subscription_quota;
  if (!account || !quota || quota.status !== 'available') {
    throw new Error(quota?.reason || 'Cursor plan usage is unavailable');
  }
  return {
    planName: quota.plan_name,
    price: quota.price,
    displayMessage: quota.display_message,
    autoDisplayMessage: quota.auto_display_message,
    apiDisplayMessage: quota.api_display_message,
    includedPercentUsed: asPercent(quota.included_percent_used),
    autoPercentUsed: asPercent(quota.auto_percent_used),
    apiPercentUsed: asPercent(quota.api_percent_used),
    includedSpendCents: asCents(quota.included_spend_cents),
    includedLimitCents: asCents(quota.included_limit_cents),
    cycleStartAt: quota.cycle_start_at,
    resetsAt: quota.resets_at,
    grokBotLabel: quota.grok_bot_label,
    grokBotPercentUsed: asPercent(quota.grok_bot_percent_used),
    grokBotCycleStartAt: quota.grok_bot_cycle_start_at,
    grokBotResetsAt: quota.grok_bot_resets_at,
    onDemandKind: quota.on_demand_kind,
    onDemandUsedCents: quota.on_demand_used_cents,
    onDemandLimitCents: quota.on_demand_limit_cents,
  };
}

export const CURSOR_CONFIG: QuotaProviderData<CursorQuotaState, CursorQuotaData> = {
  type: 'cursor',
  i18nPrefix: 'cursor_quota',
  filterFn: (file) => resolveAuthProvider(file) === 'cursor' && !isDisabledAuthFile(file),
  fetchQuota: async (file, _t: TFunction) => fetchCursorQuota(file),
  storeSelector: (state) => state.cursorQuota,
  storeSetter: 'setCursorQuota',
  buildLoadingState: () => ({ status: 'loading' }),
  buildSuccessState: (data) => ({ status: 'success', data }),
  buildErrorState: (error, errorStatus) => ({
    status: 'error',
    error,
    errorStatus,
  }),
};
