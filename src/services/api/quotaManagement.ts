import { apiClient } from './client';
import type {
  ManagementQuotaCollectionState,
  ManagementQuotaCredentialDetails,
  ManagementQuotaCredentialSnapshot,
  ManagementQuotaError,
  ManagementQuotaListResponse,
  ManagementQuotaPlan,
  ManagementQuotaResetCredit,
  ManagementQuotaResetCredits,
  ManagementQuotaRuntime,
  ManagementQuotaWindow,
} from '@/types';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const read = (record: Record<string, unknown> | null, ...keys: string[]): unknown => {
  if (!record) return undefined;
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
};

const stringValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();

const nullableString = (
  record: Record<string, unknown> | null,
  ...keys: string[]
): string | null => {
  const value = stringValue(read(record, ...keys));
  return value || null;
};

const numberValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const numberField = (record: Record<string, unknown> | null, ...keys: string[]): number | null =>
  numberValue(read(record, ...keys));

const booleanValue = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  return false;
};

const normalizeError = (value: unknown): ManagementQuotaError | null => {
  const record = asRecord(value);
  if (!record) return null;
  return {
    code: stringValue(read(record, 'code')),
    message: stringValue(read(record, 'message')),
    retryable: booleanValue(read(record, 'retryable')),
    occurredAt: nullableString(record, 'occurred_at', 'occurredAt'),
    upstreamStatusCode: numberField(record, 'upstream_status_code', 'upstreamStatusCode'),
    requestId: nullableString(record, 'request_id', 'requestId'),
  };
};

const normalizeWindow = (value: unknown): ManagementQuotaWindow | null => {
  const record = asRecord(value);
  if (!record) return null;
  return {
    id: stringValue(read(record, 'id')),
    label: nullableString(record, 'label'),
    scope: stringValue(read(record, 'scope')),
    scopeId: nullableString(record, 'scope_id', 'scopeId'),
    mode: stringValue(read(record, 'mode')),
    status: stringValue(read(record, 'status')) || 'unknown',
    unit: stringValue(read(record, 'unit')),
    currency: nullableString(record, 'currency'),
    used: numberField(record, 'used'),
    remaining: numberField(record, 'remaining'),
    limit: numberField(record, 'limit'),
    usedRatio: numberField(record, 'used_ratio', 'usedRatio'),
    remainingRatio: numberField(record, 'remaining_ratio', 'remainingRatio'),
    isUnlimited: booleanValue(read(record, 'is_unlimited', 'isUnlimited')),
    resetAt: nullableString(record, 'reset_at', 'resetAt'),
    windowSeconds: numberField(record, 'window_seconds', 'windowSeconds'),
    periodUnit: stringValue(read(record, 'period_unit', 'periodUnit')) || 'unknown',
    periodValue: numberField(record, 'period_value', 'periodValue'),
    source: stringValue(read(record, 'source')),
    observedAt: nullableString(record, 'observed_at', 'observedAt'),
    expiresAt: nullableString(record, 'expires_at', 'expiresAt'),
  };
};

const normalizePlan = (value: unknown): ManagementQuotaPlan | null => {
  const record = asRecord(value);
  if (!record) return null;
  const name = stringValue(read(record, 'name'));
  return name ? { name, premium: booleanValue(read(record, 'premium')) } : null;
};

const normalizeRuntime = (value: unknown): ManagementQuotaRuntime | null => {
  const record = asRecord(value);
  if (!record) return null;
  return {
    homeId: stringValue(read(record, 'home_id', 'homeId')),
    homeLabel: stringValue(read(record, 'home_label', 'homeLabel')),
    cpaNodeId: stringValue(read(record, 'cpa_node_id', 'cpaNodeId')),
    cpaNodeLabel: stringValue(read(record, 'cpa_node_label', 'cpaNodeLabel')),
  };
};

const normalizeResetCredit = (value: unknown): ManagementQuotaResetCredit | null => {
  const record = asRecord(value);
  if (!record) return null;
  return {
    status: stringValue(read(record, 'status')),
    grantedAt: nullableString(record, 'granted_at', 'grantedAt'),
    expiresAt: nullableString(record, 'expires_at', 'expiresAt'),
  };
};

const normalizeResetCredits = (value: unknown): ManagementQuotaResetCredits | null => {
  const record = asRecord(value);
  if (!record) return null;
  const credits = Array.isArray(record.credits)
    ? record.credits
        .map(normalizeResetCredit)
        .filter((item): item is ManagementQuotaResetCredit => item !== null)
    : [];
  return {
    availableCount: numberField(record, 'available_count', 'availableCount'),
    observedAt: nullableString(record, 'observed_at', 'observedAt'),
    credits,
  };
};

const normalizeSnapshot = (value: unknown): ManagementQuotaCredentialSnapshot | null => {
  const record = asRecord(value);
  if (!record) return null;
  const credentialId = stringValue(read(record, 'credential_id', 'credentialId'));
  if (!credentialId) return null;
  const windows = Array.isArray(record.primary_windows)
    ? record.primary_windows
        .map(normalizeWindow)
        .filter((item): item is ManagementQuotaWindow => item !== null)
    : [];
  return {
    credentialId,
    authIndex: nullableString(record, 'auth_index', 'authIndex'),
    provider: stringValue(read(record, 'provider')) || 'unknown',
    credentialType: stringValue(read(record, 'credential_type', 'credentialType')),
    label: stringValue(read(record, 'label')) || credentialId,
    account: nullableString(record, 'account'),
    project: nullableString(record, 'project'),
    credentialStatus:
      stringValue(read(record, 'credential_status', 'credentialStatus')) || 'unknown',
    quotaStatus: stringValue(read(record, 'quota_status', 'quotaStatus')) || 'unknown',
    freshness: stringValue(read(record, 'freshness')) || 'never',
    collectionStatus: stringValue(read(record, 'collection_status', 'collectionStatus')) || 'idle',
    source: nullableString(record, 'source'),
    observedAt: nullableString(record, 'observed_at', 'observedAt'),
    expiresAt: nullableString(record, 'expires_at', 'expiresAt'),
    earliestResetAt: nullableString(record, 'earliest_reset_at', 'earliestResetAt'),
    lastAttemptAt: nullableString(record, 'last_attempt_at', 'lastAttemptAt'),
    lastSuccessAt: nullableString(record, 'last_success_at', 'lastSuccessAt'),
    nextProbeAt: nullableString(record, 'next_probe_at', 'nextProbeAt'),
    consecutiveFailure: numberField(record, 'consecutive_failures', 'consecutiveFailure') ?? 0,
    primaryWindows: windows,
    windowCount: numberField(record, 'window_count', 'windowCount') ?? windows.length,
    error: normalizeError(read(record, 'error')),
    runtime: normalizeRuntime(read(record, 'runtime')),
    plan: normalizePlan(read(record, 'plan')),
  };
};

const normalizeDetails = (payload: unknown): ManagementQuotaCredentialDetails => {
  const record = asRecord(payload);
  const credential = normalizeSnapshot(read(record, 'credential')) ?? normalizeSnapshot(payload);
  const base = credential ?? {
    credentialId: '',
    authIndex: null,
    provider: 'unknown',
    credentialType: '',
    label: '',
    account: null,
    project: null,
    credentialStatus: 'unknown',
    quotaStatus: 'unknown',
    freshness: 'never',
    collectionStatus: 'idle',
    source: null,
    observedAt: null,
    expiresAt: null,
    earliestResetAt: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    nextProbeAt: null,
    consecutiveFailure: 0,
    primaryWindows: [],
    windowCount: 0,
    error: null,
    runtime: null,
    plan: null,
  };
  const windows = Array.isArray(record?.windows)
    ? record.windows
        .map(normalizeWindow)
        .filter((item): item is ManagementQuotaWindow => item !== null)
    : base.primaryWindows;
  const collection = asRecord(read(record, 'collection'));
  const collectionError = normalizeError(read(collection, 'error'));
  return {
    ...base,
    source: nullableString(collection, 'source') ?? base.source,
    freshness: stringValue(read(collection, 'freshness')) || base.freshness,
    collectionStatus:
      stringValue(read(collection, 'status', 'collection_status', 'collectionStatus')) ||
      base.collectionStatus,
    observedAt: nullableString(collection, 'observed_at', 'observedAt') ?? base.observedAt,
    expiresAt: nullableString(collection, 'expires_at', 'expiresAt') ?? base.expiresAt,
    lastAttemptAt:
      nullableString(collection, 'last_attempt_at', 'lastAttemptAt') ?? base.lastAttemptAt,
    lastSuccessAt:
      nullableString(collection, 'last_success_at', 'lastSuccessAt') ?? base.lastSuccessAt,
    nextProbeAt: nullableString(collection, 'next_probe_at', 'nextProbeAt') ?? base.nextProbeAt,
    consecutiveFailure:
      numberField(collection, 'consecutive_failures', 'consecutiveFailure') ??
      base.consecutiveFailure,
    error: collectionError ?? base.error,
    windows,
    resetCredits: normalizeResetCredits(read(record, 'reset_credits', 'resetCredits')),
    generatedAt: nullableString(record, 'generated_at', 'generatedAt'),
  };
};

const normalizeList = (payload: unknown): ManagementQuotaListResponse => {
  const record = asRecord(payload);
  const items = Array.isArray(record?.items)
    ? record.items
        .map(normalizeSnapshot)
        .filter((item): item is ManagementQuotaCredentialSnapshot => item !== null)
    : [];
  return {
    items,
    total: numberField(record, 'total') ?? items.length,
    generatedAt: nullableString(record, 'generated_at', 'generatedAt'),
  };
};

const normalizeCollection = (payload: unknown): ManagementQuotaCollectionState => {
  const record = asRecord(payload);
  return {
    accepted: numberField(record, 'accepted') ?? 0,
    running: booleanValue(read(record, 'running')),
  };
};

export const quotaManagementApi = {
  list: async (credentialIds: string[] = []): Promise<ManagementQuotaListResponse> => {
    const ids = credentialIds.map((value) => value.trim()).filter(Boolean);
    return normalizeList(
      await apiClient.get(
        '/quota/credentials',
        ids.length ? { params: { ids: ids.join(','), limit: 200 } } : { params: { limit: 200 } }
      )
    );
  },
  get: async (credentialId: string): Promise<ManagementQuotaCredentialDetails> =>
    normalizeDetails(await apiClient.get(`/quota/credentials/${encodeURIComponent(credentialId)}`)),
  collect: async (
    credentialIds: string[] = [],
    providers: string[] = []
  ): Promise<ManagementQuotaCollectionState> =>
    normalizeCollection(
      await apiClient.post('/quota/collect', {
        ...(credentialIds.length ? { credential_ids: credentialIds } : {}),
        ...(providers.length ? { providers } : {}),
      })
    ),
};
