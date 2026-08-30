/**
 * OpenCode Go quota data layer. React-free / SCSS-free.
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, OpencodeQuotaRow, OpencodeQuotaState } from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import {
  OPENCODE_USAGE_URL,
  OPENCODE_REQUEST_HEADERS,
  parseOpencodeUsagePayload,
  buildOpencodeQuotaRows,
  createStatusError,
  isOpencodeFile,
  isDisabledAuthFile,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaProviderData } from '../types';

const fetchOpencodeQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<OpencodeQuotaRow[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('opencode_quota.missing_auth_index'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: OPENCODE_USAGE_URL,
    header: { ...OPENCODE_REQUEST_HEADERS },
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseOpencodeUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('opencode_quota.empty_data'));
  }

  // The timeline model is React-free and cannot translate, so the label is
  // resolved here alongside the key — same split as claude/data.ts.
  return buildOpencodeQuotaRows(payload).map((row) => ({ ...row, label: t(row.labelKey) }));
};

export const OPENCODE_CONFIG: QuotaProviderData<OpencodeQuotaState, OpencodeQuotaRow[]> = {
  type: 'opencode',
  i18nPrefix: 'opencode_quota',
  filterFn: (file) => isOpencodeFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchOpencodeQuota,
  storeSelector: (state) => state.opencodeQuota,
  storeSetter: 'setOpencodeQuota',
  buildLoadingState: () => ({ status: 'loading', rows: [] }),
  buildSuccessState: (rows) => ({ status: 'success', rows }),
  buildErrorState: (message, status) => ({
    status: 'error',
    rows: [],
    error: message,
    errorStatus: status,
  }),
};
