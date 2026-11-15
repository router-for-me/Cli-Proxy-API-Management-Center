/** Read/write helpers for CLIProxyAPI access.api-key-policies and access.model-prices. */
import type { ApiKeyLimits, ApiKeyPolicy, ModelPrice } from '@/types/visualConfig';

export const LIMIT_FIELDS: Array<{ field: keyof ApiKeyLimits; yaml: string }> = [
  { field: 'tokensPerDay', yaml: 'tokens-per-day' },
  { field: 'tokensPerWeek', yaml: 'tokens-per-week' },
  { field: 'tokensPerMonth', yaml: 'tokens-per-month' },
  { field: 'costPerDay', yaml: 'cost-per-day' },
  { field: 'costPerWeek', yaml: 'cost-per-week' },
  { field: 'costPerMonth', yaml: 'cost-per-month' },
];

export const EMPTY_LIMITS: ApiKeyLimits = {
  tokensPerDay: 0,
  tokensPerWeek: 0,
  tokensPerMonth: 0,
  costPerDay: 0,
  costPerWeek: 0,
  costPerMonth: 0,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const toPositiveNumber = (value: unknown): number => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
};

const toStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];

export function parseApiKeyLimits(raw: unknown): ApiKeyLimits {
  const record = isRecord(raw) ? raw : {};
  const limits = { ...EMPTY_LIMITS };
  for (const { field, yaml } of LIMIT_FIELDS) {
    limits[field] = toPositiveNumber(record[yaml]);
  }
  return limits;
}

export function hasLimits(limits: ApiKeyLimits): boolean {
  return LIMIT_FIELDS.some(({ field }) => limits[field] > 0);
}

export function createApiKeyPolicy(key: string): ApiKeyPolicy {
  return {
    key,
    name: '',
    disabled: false,
    allowedAuths: [],
    allowedModels: [],
    expiresAt: '',
    limits: { ...EMPTY_LIMITS },
  };
}

export function isApiKeyPolicyEmpty(policy: ApiKeyPolicy): boolean {
  return (
    !policy.name.trim() &&
    !policy.disabled &&
    policy.allowedAuths.length === 0 &&
    policy.allowedModels.length === 0 &&
    !policy.expiresAt.trim() &&
    !hasLimits(policy.limits)
  );
}

export function parseApiKeyPolicies(raw: unknown): ApiKeyPolicy[] {
  if (!Array.isArray(raw)) return [];
  const policies: ApiKeyPolicy[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    if (!key) continue;
    policies.push({
      key,
      name: typeof item.name === 'string' ? item.name.trim() : '',
      disabled: item.disabled === true,
      allowedAuths: toStringList(item['allowed-auths']),
      allowedModels: toStringList(item['allowed-models']),
      expiresAt: typeof item['expires-at'] === 'string' ? item['expires-at'].trim() : '',
      limits: parseApiKeyLimits(item.limits),
    });
  }
  return policies;
}

/** Keep only meaningful policies for keys that still exist, in YAML field names. */
export function serializeApiKeyPolicies(policies: ApiKeyPolicy[], apiKeys: string[]) {
  const known = new Set(apiKeys);
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const policy of policies) {
    const key = policy.key.trim();
    if (!key || !known.has(key) || seen.has(key) || isApiKeyPolicyEmpty(policy)) continue;
    seen.add(key);
    const entry: Record<string, unknown> = { key };
    const name = policy.name.trim();
    if (name) entry.name = name;
    if (policy.disabled) entry.disabled = true;
    const allowedAuths = Array.from(
      new Set(policy.allowedAuths.map((v) => v.trim()).filter(Boolean))
    );
    if (allowedAuths.length > 0) entry['allowed-auths'] = allowedAuths;
    const allowedModels = Array.from(
      new Set(policy.allowedModels.map((v) => v.trim()).filter(Boolean))
    );
    if (allowedModels.length > 0) entry['allowed-models'] = allowedModels;
    if (policy.expiresAt.trim()) entry['expires-at'] = policy.expiresAt.trim();
    if (hasLimits(policy.limits)) {
      const limits: Record<string, number> = {};
      for (const { field, yaml } of LIMIT_FIELDS) {
        if (policy.limits[field] > 0) limits[yaml] = policy.limits[field];
      }
      entry.limits = limits;
    }
    out.push(entry);
  }
  return out;
}

export function parseModelPrices(raw: unknown): ModelPrice[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!isRecord(item) || typeof item.model !== 'string') return [];
    return [
      {
        model: item.model,
        input: toPositiveNumber(item.input),
        output: toPositiveNumber(item.output),
        cachedInput: toPositiveNumber(item['cached-input']),
      },
    ];
  });
}

export function serializeModelPrices(prices: ModelPrice[]) {
  return prices
    .filter((price) => price.model.trim())
    .map((price) => {
      const entry: Record<string, unknown> = { model: price.model.trim() };
      if (price.input > 0) entry.input = price.input;
      if (price.output > 0) entry.output = price.output;
      if (price.cachedInput > 0) entry['cached-input'] = price.cachedInput;
      return entry;
    });
}

/** Model patterns typed one per line or separated by commas. */
export function parseModelPatterns(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\n,]/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

/** Date-only (YYYY-MM-DD) form of an expires-at value for <input type="date">. */
export function expiresAtToDateInput(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (!trimmed || Number.isNaN(parsed.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
}

/** Moment the key stops working, matching the backend (date-only = end of that local day). */
export function expiresAtMoment(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]) + 1);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Whole days left until expiry (0 = expires today); negative once expired; null = no expiry. */
export function daysUntilExpiry(value: string, now: Date = new Date()): number | null {
  const moment = expiresAtMoment(value);
  if (!moment) return value.trim() ? -1 : null;
  const diff = moment.getTime() - now.getTime();
  if (diff <= 0) return -1;
  return Math.floor(diff / 86_400_000);
}
