import type { AuthFileItem, CopilotQuotaState, CopilotQuotaRow } from '@/types';
import { apiClient } from '@/services/api/client';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { normalizeOAuthProviderKey } from '@/utils/providerKeys';
import { isRecord } from '@/utils/helpers';
import { isDisabledAuthFile, parseIsoToMs } from '@/utils/quota';
import type { QuotaProviderData } from '../types';

const number = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
};

export function parseCopilotQuota(payload: unknown): Pick<CopilotQuotaState, 'rows' | 'plan'> {
  if (!isRecord(payload)) return { rows: [] };
  const snapshots = isRecord(payload.quota_snapshots) ? payload.quota_snapshots : {};
  const reset = typeof payload.quota_reset_date === 'string' ? payload.quota_reset_date : undefined;
  const rows: CopilotQuotaRow[] = [];
  for (const [id, value] of Object.entries(snapshots)) {
    if (!isRecord(value)) continue;
    const entitlement = number(value.entitlement);
    const remaining = number(value.remaining);
    const unlimited = value.unlimited === true || entitlement === -1;
    const rawPercent =
      number(value.percent_remaining) ??
      (entitlement !== null && entitlement > 0 && remaining !== null
        ? (remaining / entitlement) * 100
        : null);
    const percent = rawPercent === null ? null : Math.max(0, Math.min(100, rawPercent));
    const resetTime = typeof value.reset_date === 'string' ? value.reset_date : reset;
    rows.push({
      id,
      entitlement,
      remaining,
      unlimited,
      percent,
      used:
        entitlement !== null && entitlement >= 0 && percent !== null
          ? entitlement * (1 - percent / 100)
          : null,
      overage: number(value.overage_count),
      overageAllowed: typeof value.overage_permitted === 'boolean' ? value.overage_permitted : null,
      resetAtMs: resetTime ? parseIsoToMs(resetTime) : null,
    });
  }
  return {
    rows,
    plan: typeof payload.copilot_plan === 'string' ? payload.copilot_plan : undefined,
  };
}

export const COPILOT_CONFIG: QuotaProviderData<
  CopilotQuotaState,
  ReturnType<typeof parseCopilotQuota>
> = {
  type: 'github-copilot',
  i18nPrefix: 'github_copilot_quota',
  filterFn: (file: AuthFileItem) =>
    normalizeOAuthProviderKey(String(file.type ?? file.provider ?? '')) === 'github-copilot' &&
    !isDisabledAuthFile(file),
  fetchQuota: async (file, t) => {
    const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
    if (!authIndex) throw new Error(t('github_copilot_quota.missing_auth_index'));
    const result = await apiClient.get<unknown>('/github-copilot-quota', {
      params: { auth_index: authIndex },
    });
    return parseCopilotQuota(result);
  },
  storeSelector: (state) => state.copilotQuota,
  storeSetter: 'setCopilotQuota',
  buildLoadingState: () => ({ status: 'loading', rows: [] }),
  buildSuccessState: (data) => ({ status: 'success', ...data }),
  buildErrorState: (error, errorStatus) => ({ status: 'error', rows: [], error, errorStatus }),
};
