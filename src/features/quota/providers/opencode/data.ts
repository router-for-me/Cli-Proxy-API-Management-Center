/**
 * OpenCode Go quota data layer. React-free / SCSS-free.
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, OpenCodeQuotaState, OpenCodeQuotaWindow } from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import {
  OPENCODE_REQUEST_HEADERS,
  OPENCODE_USAGE_URL,
  buildOpenCodeQuotaWindows,
  createStatusError,
  isDisabledAuthFile,
  isOpenCodeGoFile,
  parseOpenCodeUsagePayload,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaProviderData } from '../types';

export type OpenCodeQuotaData = {
  windows: OpenCodeQuotaWindow[];
  useBalance: boolean | null;
};

const mapStatusError = (status: number, fallback: string, t: TFunction) => {
  if (status === 401) return t('opencode_quota.unauthorized');
  if (status === 403) return t('opencode_quota.subscription_required');
  if (status === 429) return t('opencode_quota.rate_limited');
  if (status >= 500) return t('opencode_quota.upstream_unavailable');
  return fallback;
};

const fetchOpenCodeQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<OpenCodeQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('opencode_quota.missing_auth_index'));
  }

  let result;
  try {
    result = await apiCallApi.request({
      authIndex,
      method: 'GET',
      url: OPENCODE_USAGE_URL,
      header: { ...OPENCODE_REQUEST_HEADERS },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : t('opencode_quota.request_failed');
    throw createStatusError(t('opencode_quota.request_failed_with_message', { message }), undefined);
  }

  if (result.statusCode < 200 || result.statusCode >= 300) {
    const fallback = getApiCallErrorMessage(result);
    const message = mapStatusError(result.statusCode, fallback, t);
    throw createStatusError(message, result.statusCode);
  }

  const payload = parseOpenCodeUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('opencode_quota.invalid_response'));
  }

  const windows = buildOpenCodeQuotaWindows(payload);
  if (!windows.some((window) => window.usedPercent !== null || window.resetAtMs != null)) {
    throw new Error(t('opencode_quota.empty_data'));
  }

  const useBalanceRaw = payload.useBalance ?? payload.use_balance;
  const useBalance = typeof useBalanceRaw === 'boolean' ? useBalanceRaw : null;

  return { windows, useBalance };
};

export const OPENCODE_CONFIG: QuotaProviderData<OpenCodeQuotaState, OpenCodeQuotaData> = {
  type: 'opencode',
  i18nPrefix: 'opencode_quota',
  filterFn: (file) => isOpenCodeGoFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchOpenCodeQuota,
  storeSelector: (state) => state.opencodeQuota,
  storeSetter: 'setOpencodeQuota',
  buildLoadingState: () => ({ status: 'loading', windows: [] }),
  buildSuccessState: (data) => ({
    status: 'success',
    windows: data.windows,
    useBalance: data.useBalance,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    error: message,
    errorStatus: status,
  }),
};
