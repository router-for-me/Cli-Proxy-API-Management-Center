/**
 * xAI/Grok provider quota fetch + parse helper.
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, XaiBillingConfig, XaiBillingSummary } from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { XAI_BILLING_URL, XAI_REQUEST_HEADERS } from '../constants';
import { createStatusError } from '../formatters';
import { normalizeAuthIndex, normalizeNumberValue, normalizeStringValue, parseXaiBillingPayload } from '../parsers';

const normalizeXaiCentValue = (value: XaiBillingConfig['monthlyLimit']): number | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    return normalizeNumberValue((value as { val?: unknown }).val);
  }
  return normalizeNumberValue(value);
};

export const buildXaiBillingSummary = (
  config: XaiBillingConfig | null | undefined
): XaiBillingSummary | null => {
  if (!config || typeof config !== 'object') return null;

  const monthlyLimitCents = normalizeXaiCentValue(config.monthlyLimit ?? config.monthly_limit);
  const usedCents = normalizeXaiCentValue(config.used);
  const onDemandCapCents = normalizeXaiCentValue(config.onDemandCap ?? config.on_demand_cap);
  const billingPeriodStart =
    normalizeStringValue(config.billingPeriodStart ?? config.billing_period_start) ?? undefined;
  const billingPeriodEnd =
    normalizeStringValue(config.billingPeriodEnd ?? config.billing_period_end) ?? undefined;

  if (
    monthlyLimitCents === null &&
    usedCents === null &&
    onDemandCapCents === null &&
    !billingPeriodEnd
  ) {
    return null;
  }

  const usedPercent =
    monthlyLimitCents !== null && monthlyLimitCents > 0 && usedCents !== null
      ? (usedCents / monthlyLimitCents) * 100
      : null;

  return {
    monthlyLimitCents,
    usedCents,
    onDemandCapCents,
    billingPeriodStart,
    billingPeriodEnd,
    usedPercent,
  };
};

export const fetchXaiQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<XaiBillingSummary> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('xai_quota.missing_auth_index'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: XAI_BILLING_URL,
    header: { ...XAI_REQUEST_HEADERS },
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseXaiBillingPayload(result.body ?? result.bodyText);
  const summary = buildXaiBillingSummary(payload?.config);
  if (!summary) {
    throw new Error(t('xai_quota.empty_data'));
  }

  return summary;
};
