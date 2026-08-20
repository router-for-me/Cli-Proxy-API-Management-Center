/**
 * Cursor 额度数据层。React-free / SCSS-free。
 */

import type { TFunction } from 'i18next';
import type {
  AuthFileItem,
  CursorAgentUsage,
  CursorAggregatedUsage,
  CursorCurrentPeriodUsage,
  CursorFastRequests,
  CursorPlanInfo,
  CursorQuotaState,
  CursorQuotaSummary,
} from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import {
  CURSOR_AGENT_USAGE_URL,
  CURSOR_AGGREGATED_USAGE_URL,
  CURSOR_FAST_REQUESTS_URL,
  CURSOR_PERIOD_USAGE_URL,
  CURSOR_PLAN_INFO_URL,
  CURSOR_REQUEST_HEADERS,
  buildCursorQuotaSummary,
  createStatusError,
  isCursorFile,
  isDisabledAuthFile,
  parseCursorPayload,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaProviderData } from '../types';

/**
 * One DashboardService read.
 *
 * `required` separates the two reads that carry the allowance from the model
 * breakdown, which is enrichment: an account whose usage aggregation fails
 * still has a quota worth showing, but one whose period read fails has nothing
 * and must say so rather than render an empty meter.
 */
const read = async <T>(authIndex: string, url: string, required: boolean): Promise<T | null> => {
  const result = await apiCallApi.request({
    authIndex,
    method: 'POST',
    url,
    header: { ...CURSOR_REQUEST_HEADERS },
    data: '{}',
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    if (!required) return null;
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  return parseCursorPayload<T>(result.body ?? result.bodyText);
};

const fetchCursorQuota = async (file: AuthFileItem, t: TFunction): Promise<CursorQuotaSummary> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('cursor_quota.missing_auth_index'));
  }

  const [plan, period, usage, agent, fast] = await Promise.all([
    read<CursorPlanInfo>(authIndex, CURSOR_PLAN_INFO_URL, false),
    read<CursorCurrentPeriodUsage>(authIndex, CURSOR_PERIOD_USAGE_URL, true),
    read<CursorAggregatedUsage>(authIndex, CURSOR_AGGREGATED_USAGE_URL, false),
    read<CursorAgentUsage>(authIndex, CURSOR_AGENT_USAGE_URL, false),
    read<CursorFastRequests>(authIndex, CURSOR_FAST_REQUESTS_URL, false),
  ]);

  if (!period) {
    throw new Error(t('cursor_quota.empty_data'));
  }

  const summary = buildCursorQuotaSummary(plan, period, usage, agent, fast);
  if (summary.limitCents === null && summary.usedCents === null) {
    throw new Error(t('cursor_quota.empty_data'));
  }

  return summary;
};

export const CURSOR_CONFIG: QuotaProviderData<CursorQuotaState, CursorQuotaSummary> = {
  type: 'cursor',
  i18nPrefix: 'cursor_quota',
  filterFn: (file) => isCursorFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchCursorQuota,
  storeSelector: (state) => state.cursorQuota,
  storeSetter: 'setCursorQuota',
  buildLoadingState: () => ({ status: 'loading', summary: null }),
  buildSuccessState: (summary) => ({ status: 'success', summary }),
  buildErrorState: (message, status) => ({
    status: 'error',
    summary: null,
    error: message,
    errorStatus: status,
  }),
};
