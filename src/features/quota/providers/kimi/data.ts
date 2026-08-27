/**
 * Kimi 额度数据层。React-free / SCSS-free。
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, KimiKeyConfig, KimiQuotaRow, KimiQuotaState } from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import {
  KIMI_USAGE_URL,
  KIMI_REQUEST_HEADERS,
  parseKimiUsagePayload,
  buildKimiQuotaRows,
  createStatusError,
  isKimiFile,
  isDisabledAuthFile,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { KIMI_SERVICE_CODING_PLAN } from '@/features/providers/kimi';
import { hasDisableAllModelsRule } from '@/components/providers/utils';
import { maskApiKey } from '@/utils/format';
import type { QuotaProviderData } from '../types';

const fetchKimiQuota = async (file: AuthFileItem, t: TFunction): Promise<KimiQuotaRow[]> => {
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

const kimiServiceOf = (file: AuthFileItem): string =>
  String(file.kimiService ?? file.service ?? '')
    .trim()
    .toLowerCase();

const isRuntimeOnlyKimiFile = (file: AuthFileItem): boolean => {
  const raw = file.runtimeOnly ?? file['runtime_only'];
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
};

export const kimiKeyToQuotaFile = (key: KimiKeyConfig, index: number): AuthFileItem => {
  const label = key.name?.trim() || maskApiKey(key.apiKey) || `kimi-apikey-${index + 1}`;
  const authIndex = normalizeAuthIndex(key.authIndex);
  return {
    name: authIndex ? `${label} · ${authIndex}` : label,
    type: 'kimi',
    provider: 'kimi',
    authIndex: key.authIndex,
    runtimeOnly: true,
    kimiService: key.service,
  };
};

export const mergeKimiQuotaFiles = (
  files: AuthFileItem[],
  kimiKeys: KimiKeyConfig[]
): AuthFileItem[] => {
  const codingPlanKeys = kimiKeys.filter(
    (key) =>
      key.service === KIMI_SERVICE_CODING_PLAN &&
      normalizeAuthIndex(key.authIndex) &&
      !hasDisableAllModelsRule(key.excludedModels)
  );
  const seen = new Set(
    files
      .map((file) => normalizeAuthIndex(file['auth_index'] ?? file.authIndex))
      .filter((value): value is string => Boolean(value))
  );
  const extras = codingPlanKeys
    .filter((key) => {
      const authIndex = normalizeAuthIndex(key.authIndex);
      return authIndex ? !seen.has(authIndex) : true;
    })
    .map((key, index) => kimiKeyToQuotaFile(key, index));
  return [...files, ...extras];
};

export const KIMI_CONFIG: QuotaProviderData<KimiQuotaState, KimiQuotaRow[]> = {
  type: 'kimi',
  i18nPrefix: 'kimi_quota',
  filterFn: (file) => {
    if (!isKimiFile(file) || isDisabledAuthFile(file)) return false;
    const service = kimiServiceOf(file);
    if (service === 'open-platform') return false;
    if (service === KIMI_SERVICE_CODING_PLAN) return true;
    return !isRuntimeOnlyKimiFile(file);
  },
  fetchQuota: fetchKimiQuota,
  storeSelector: (state) => state.kimiQuota,
  storeSetter: 'setKimiQuota',
  buildLoadingState: () => ({ status: 'loading', rows: [] }),
  buildSuccessState: (rows) => ({ status: 'success', rows }),
  buildErrorState: (message, status) => ({
    status: 'error',
    rows: [],
    error: message,
    errorStatus: status,
  }),
};
