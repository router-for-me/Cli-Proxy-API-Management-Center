/**
 * CodeBuddy CN 额度数据层。React-free / SCSS-free。
 *
 * 计费接口在 www.workbuddy.cn（与 copilot.tencent.com 不同源），POST
 * get-user-resource 汇总各资源包的 CycleCapacity*Precise 得出总额度/已用/剩余。
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, CodeBuddyCnQuotaRow, CodeBuddyCnQuotaState } from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import {
  CODEBUDDY_CN_BILLING_URL,
  CODEBUDDY_CN_REQUEST_HEADERS,
  createStatusError,
  isCodeBuddyCnFile,
  isDisabledAuthFile,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaProviderData } from '../types';

interface BillingAccount {
  PackageName?: string;
  CapacityUnit?: string;
  CycleCapacitySizePrecise?: string;
  CycleCapacityRemainPrecise?: string;
  CycleCapacityUsedPrecise?: string;
}

interface BillingUserResourceBody {
  code?: number;
  msg?: string;
  data?: {
    Response?: {
      Data?: {
        Accounts?: BillingAccount[];
      };
    };
  };
}

const parsePrecise = (value: string | undefined): number => {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 0;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildBillingRequestBody = (): string => {
  const begin = new Date('2024-12-01T21:25:00');
  const now = new Date();
  const format = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  return JSON.stringify({
    PageNumber: 1,
    PageSize: 100,
    ProductCode: 'p_tcaca',
    Status: [0, 3],
    PackageStartTimeRangeBegin: format(begin),
    PackageStartTimeRangeEnd: format(now),
  });
};

const buildCodeBuddyCnQuotaRows = (accounts: BillingAccount[]): CodeBuddyCnQuotaRow[] =>
  accounts.map((acc, index) => {
    const limit = parsePrecise(acc.CycleCapacitySizePrecise);
    const used = parsePrecise(acc.CycleCapacityUsedPrecise);
    return {
      id: String(acc.PackageName ?? `package-${index}`),
      label: acc.PackageName || `Package ${index + 1}`,
      unit: acc.CapacityUnit || '',
      used,
      limit,
    };
  });

const fetchCodeBuddyCnQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<CodeBuddyCnQuotaRow[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('codebuddy_cn_quota.missing_auth_index'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'POST',
    url: CODEBUDDY_CN_BILLING_URL,
    header: { ...CODEBUDDY_CN_REQUEST_HEADERS },
    data: buildBillingRequestBody(),
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = (result.body ?? null) as BillingUserResourceBody | null;
  if (!payload || payload.code !== 0) {
    const message = payload?.msg ? `code=${payload.code} msg=${payload.msg}` : 'empty data';
    throw new Error(t('codebuddy_cn_quota.empty_data') + ` (${message})`);
  }

  const accounts = payload.data?.Response?.Data?.Accounts ?? [];
  const rows = buildCodeBuddyCnQuotaRows(accounts);
  if (rows.length === 0) {
    throw new Error(t('codebuddy_cn_quota.empty_data'));
  }
  return rows;
};

export const CODEBUDDY_CN_CONFIG: QuotaProviderData<CodeBuddyCnQuotaState, CodeBuddyCnQuotaRow[]> =
  {
    type: 'codebuddy-cn',
    i18nPrefix: 'codebuddy_cn_quota',
    filterFn: (file) => isCodeBuddyCnFile(file) && !isDisabledAuthFile(file),
    fetchQuota: fetchCodeBuddyCnQuota,
    storeSelector: (state) => state.codebuddyCnQuota,
    storeSetter: 'setCodebuddyCnQuota',
    buildLoadingState: () => ({ status: 'loading', rows: [] }),
    buildSuccessState: (rows) => ({ status: 'success', rows }),
    buildErrorState: (message, status) => ({
      status: 'error',
      rows: [],
      error: message,
      errorStatus: status,
    }),
  };
