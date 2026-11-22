import { captureApiCallApi } from '@/services/api/apiCall';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores/useQuotaStore';
import type { CopilotQuotaData, CopilotQuotaState } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isRecord } from '@/utils/helpers';
import { isDisabledAuthFile, resolveAuthProvider } from '@/utils/quota';
import type { QuotaProviderData } from '../types';

const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function parseCopilotQuota(body: unknown): CopilotQuotaData | null {
  if (!isRecord(body) || !isRecord(body.quota_snapshots)) return null;
  const premium = body.quota_snapshots.premium_interactions;
  if (!isRecord(premium) || premium.has_quota === false || premium.unlimited === true) return null;
  const { quota_remaining: remaining, entitlement, percent_remaining: percentRemaining } = premium;
  if (
    !isAmount(remaining) ||
    !isAmount(entitlement) ||
    !isAmount(percentRemaining) ||
    percentRemaining > 100
  )
    return null;
  return { remaining, entitlement, percentRemaining };
}

export const COPILOT_CONFIG: QuotaProviderData<CopilotQuotaState, CopilotQuotaData> = {
  type: 'copilot',
  i18nPrefix: 'copilot_quota',
  filterFn: (file) => resolveAuthProvider(file) === 'copilot' && !isDisabledAuthFile(file),
  fetchQuota: async (file, t) => {
    const unavailable = () => new Error(t('copilot_quota.unavailable'));
    const authIndex = normalizeAuthIndex(file.authIndex ?? file.auth_index);
    if (
      !authIndex ||
      !file.name?.trim() ||
      String(file.runtimeOnly ?? file.runtime_only) === 'true'
    ) {
      throw unavailable();
    }
    const revision = apiClient.getConnectionRevision();
    const generation = captureQuotaCacheGeneration(file.name);
    const isCurrent = () =>
      revision === apiClient.getConnectionRevision() &&
      commitIfQuotaCacheCurrent(generation, () => {});
    const client = captureApiCallApi(isCurrent);
    try {
      const credential: unknown = JSON.parse(await authFilesApi.downloadText(file.name));
      if (!isCurrent() || !isRecord(credential) || credential.type !== 'copilot')
        throw unavailable();
      // Copilot access_token is for inference; only refresh_token holds the GitHub OAuth token.
      const token = credential.refresh_token;
      if (typeof token !== 'string' || !/^[A-Za-z0-9._~-]+$/.test(token)) throw unavailable();
      const result = await client.request({
        authIndex,
        method: 'GET',
        url: 'https://api.github.com/copilot_internal/user',
        header: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'copilot/1.0.114',
          Accept: 'application/json',
        },
      });
      if (!isCurrent() || result.statusCode < 200 || result.statusCode >= 300) throw unavailable();
      const data = parseCopilotQuota(result.body);
      if (data) return data;
    } catch {
      // Transport and parse errors can contain credentials or raw upstream account data.
    }
    throw unavailable();
  },
  storeSelector: (state) => state.copilotQuota,
  storeSetter: 'setCopilotQuota',
  buildLoadingState: () => ({ status: 'loading' }),
  buildSuccessState: (data) => ({ status: 'success', data }),
  buildErrorState: (error, errorStatus) => ({ status: 'error', error, errorStatus }),
};
