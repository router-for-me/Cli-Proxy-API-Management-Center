import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaSubscription,
  AntigravityQuotaSummaryPayload,
  AuthFileItem,
  PluginQuotaMetric,
  PluginQuotaState,
} from '@/types';
import { apiClient } from '@/services/api/client';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { buildAntigravityQuotaGroups, isDisabledAuthFile } from '@/utils/quota';
import type { QuotaProviderData } from '../types';

type PluginQuotaPayload = AntigravityQuotaSummaryPayload & {
  subscription?: Partial<AntigravityQuotaSubscription> | null;
  summary?: Array<Partial<PluginQuotaMetric>>;
};

type PluginQuotaData = {
  groups: PluginQuotaState['groups'];
  subscription: AntigravityQuotaSubscription | null;
  summary: PluginQuotaMetric[];
};

export const normalizePluginQuotaSummary = (summary: PluginQuotaPayload['summary']): PluginQuotaMetric[] => {
  if (!Array.isArray(summary)) return [];
  return summary.flatMap((metric) => {
    const key = typeof metric.key === 'string' ? metric.key.trim() : '';
    const label = typeof metric.label === 'string' ? metric.label.trim() : '';
    if (!key || !label || typeof metric.value !== 'number' || !Number.isFinite(metric.value)) return [];
    const format = metric.format === 'currency' || metric.format === 'number' ? metric.format : undefined;
    const unit = typeof metric.unit === 'string' && metric.unit.trim() ? metric.unit.trim() : undefined;
    const currency =
      format === 'currency' && typeof metric.currency === 'string' && /^[A-Z]{3}$/.test(metric.currency)
        ? metric.currency
        : undefined;
    return [{ key, label, value: metric.value, unit, format, currency }];
  });
};

export const isPluginQuotaFile = (file: AuthFileItem): boolean => {
  const rawSupported = file.supportsQuota ?? file['supports_quota'];
  const supported = rawSupported === true || rawSupported === 'true' || rawSupported === '1';
  return supported;
};

const normalizeSubscription = (
  subscription: PluginQuotaPayload['subscription']
): AntigravityQuotaSubscription | null => {
  if (!subscription) return null;
  const value = (field: unknown) => (typeof field === 'string' && field.trim() ? field.trim() : null);
  return {
    plan: value(subscription.plan),
    tierName: value(subscription.tierName),
    tierId: value(subscription.tierId),
  };
};

export const fetchPluginQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<PluginQuotaData> => {
  const authIndex = normalizeAuthIndex(file.authIndex ?? file['auth_index']);
  if (!authIndex) throw new Error(t('plugin_quota.missing_auth_index'));

  const provider = String(file.quotaProvider ?? file['quota_provider'] ?? '').trim();

  const payload = await apiClient.post<PluginQuotaPayload>('/quota/fetch', {
    ...(provider ? { provider } : {}),
    auth_index: authIndex,
  });
  return {
    groups: buildAntigravityQuotaGroups(payload),
    subscription: normalizeSubscription(payload.subscription),
    summary: normalizePluginQuotaSummary(payload.summary),
  };
};

export const PLUGIN_CONFIG: QuotaProviderData<PluginQuotaState, PluginQuotaData> = {
  type: 'plugin',
  i18nPrefix: 'plugin_quota',
  filterFn: (file) => isPluginQuotaFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchPluginQuota,
  storeSelector: (state) => state.pluginQuota,
  storeSetter: 'setPluginQuota',
  buildLoadingState: () => ({ status: 'loading', groups: [], subscription: null, summary: [] }),
  buildSuccessState: (data) => ({ status: 'success', ...data }),
  buildErrorState: (error, errorStatus) => ({
    status: 'error',
    groups: [],
    subscription: null,
    summary: [],
    error,
    errorStatus,
  }),
};
