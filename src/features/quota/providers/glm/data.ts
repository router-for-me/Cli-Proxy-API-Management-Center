/**
 * GLM Coding Plan quota data layer.
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, GlmQuotaData, GlmQuotaState } from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import {
  GLM_CODING_QUOTA_URL,
  GLM_CODING_REQUEST_HEADERS,
  buildGlmQuotaData,
  createStatusError,
  isDisabledAuthFile,
  isGlmFile,
  normalizeNumberValue,
  parseGlmQuotaPayload,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaProviderData } from '../types';

const fetchGlmQuota = async (file: AuthFileItem, t: TFunction): Promise<GlmQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('glm_quota.missing_auth_index'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: GLM_CODING_QUOTA_URL,
    header: { ...GLM_CODING_REQUEST_HEADERS },
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseGlmQuotaPayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('glm_quota.invalid_data'));
  }

  const businessCode = normalizeNumberValue(payload.code);
  if (payload.success === false || (businessCode !== null && businessCode !== 200)) {
    throw new Error(payload.msg || payload.message || t('glm_quota.load_failed_unknown'));
  }

  const data = buildGlmQuotaData(payload);
  if (data.rows.length === 0) {
    throw new Error(t('glm_quota.empty_data'));
  }
  return data;
};

export const GLM_CONFIG: QuotaProviderData<GlmQuotaState, GlmQuotaData> = {
  type: 'glm',
  i18nPrefix: 'glm_quota',
  filterFn: (file) => isGlmFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchGlmQuota,
  storeSelector: (state) => state.glmQuota,
  storeSetter: 'setGlmQuota',
  buildLoadingState: () => ({ status: 'loading', rows: [], planName: null }),
  buildSuccessState: (data) => ({ status: 'success', ...data }),
  buildErrorState: (message, status) => ({
    status: 'error',
    rows: [],
    planName: null,
    error: message,
    errorStatus: status,
  }),
};
