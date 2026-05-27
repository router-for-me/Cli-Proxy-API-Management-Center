/**
 * Kimi provider quota fetch + parse helper.
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, KimiQuotaRow } from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { KIMI_REQUEST_HEADERS, KIMI_USAGE_URL } from '../constants';
import { createStatusError } from '../formatters';
import { normalizeAuthIndex, parseKimiUsagePayload } from '../parsers';
import { buildKimiQuotaRows } from '../builders';

export const fetchKimiQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<KimiQuotaRow[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('kimi_quota.missing_auth_index'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: KIMI_USAGE_URL,
    header: { ...KIMI_REQUEST_HEADERS },
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseKimiUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('kimi_quota.empty_data'));
  }

  return buildKimiQuotaRows(payload);
};
