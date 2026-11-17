/** Client key usage counters used by access.api-key-policies limits and the usage page. */
import { apiClient } from './client';

/** Calendar windows that access.api-key-policies limits apply to. */
export type ApiKeyUsageWindow = 'day' | 'week' | 'month';
/** Limit windows plus the all-time total reported for statistics. */
export type ApiKeyStatsWindow = ApiKeyUsageWindow | 'total';

/** A model's usage for one reasoning effort or service tier (`default` when unset). */
export interface ApiKeyDimUsage {
  name: string;
  requests: number;
  failed: number;
  tokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cost: number;
  /** Summed latency (ms) of the `latencyCount` requests that reported one. */
  latencyMs: number;
  latencyCount: number;
}

/** A key's usage through one upstream credential. */
export interface ApiKeyAccountUsage extends ApiKeyDimUsage {
  /** Credential ID; `name` is the display name (account e-mail or label). */
  id: string;
  provider: string;
  plan: string;
}

/** One served request from the recent request log (metadata only). */
export interface ApiKeyRequestEntry {
  time: string;
  key: string;
  keyName: string;
  authId: string;
  accountName: string;
  plan: string;
  provider: string;
  model: string;
  effort: string;
  tier: string;
  stream: boolean;
  failed: boolean;
  statusCode: number;
  latencyMs: number;
  ttftMs: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  tokens: number;
  cost: number;
  requestId: string;
}

export interface ApiKeyModelUsage {
  model: string;
  requests: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  /** Part of `inputTokens` read from the prompt cache (input includes cache for every provider). */
  cachedTokens: number;
  /** Part of `inputTokens` written to the prompt cache. */
  cacheWriteTokens: number;
  reasoningTokens: number;
  tokens: number;
  cost: number;
  /** Streaming requests. */
  streamed: number;
  /** Summed latency / time to first token (ms) over the requests that reported them. */
  latencyMs: number;
  latencyCount: number;
  ttftMs: number;
  ttftCount: number;
  /** Requests by reasoning effort and by service tier, most requests first. */
  efforts: ApiKeyDimUsage[];
  tiers: ApiKeyDimUsage[];
}

export interface ApiKeyWindowUsage {
  tokens: number;
  cost: number;
  requests: number;
  failed: number;
  /** Empty for the total window, which never resets. */
  resetAt: string;
  models: ApiKeyModelUsage[];
  /** Usage by upstream credential, most requests first. */
  accounts: ApiKeyAccountUsage[];
  /** Requests refused by the key policy (disabled, expired, over limit); not in `requests`. */
  rejected: number;
  /** Rejection count per backend reason code, e.g. `api_key_disabled`. */
  rejectedReasons: Record<string, number>;
  /** RFC 3339 time of the latest rejection in the window, or empty. */
  lastRejectedAt: string;
}

/** One time slot of usage history: `YYYY-MM-DD` (daily) or `YYYY-MM-DDTHH` (hourly), server local time. */
export interface ApiKeyHistoryBucket {
  time: string;
  models: ApiKeyModelUsage[];
}

export interface ApiKeyPolicyUsage {
  key: string;
  name: string;
  disabled: boolean;
  expired: boolean;
  usage: Record<ApiKeyStatsWindow, ApiKeyWindowUsage>;
  /** Daily buckets for the last 90 days, oldest first; empty days are omitted. */
  daily: ApiKeyHistoryBucket[];
  /** Hourly buckets for the last 48 hours, oldest first; empty hours are omitted. */
  hourly: ApiKeyHistoryBucket[];
}

export const API_KEY_STATS_WINDOWS: ApiKeyStatsWindow[] = ['day', 'week', 'month', 'total'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const toNumber = (value: unknown): number => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
};

const normalizeDims = (value: unknown): ApiKeyDimUsage[] =>
  (Array.isArray(value) ? value : []).flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name) return [];
    return [
      {
        name: raw.name,
        requests: toNumber(raw.requests),
        failed: toNumber(raw.failed),
        tokens: toNumber(raw.tokens),
        outputTokens: toNumber(raw.output_tokens),
        reasoningTokens: toNumber(raw.reasoning_tokens),
        cost: toNumber(raw.cost),
        latencyMs: toNumber(raw.latency_ms),
        latencyCount: toNumber(raw.latency_count),
      },
    ];
  });

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

const normalizeAccounts = (value: unknown): ApiKeyAccountUsage[] => {
  const raws = Array.isArray(value) ? value : [];
  return raws.flatMap((raw) => {
    if (!isRecord(raw) || !str(raw.id)) return [];
    const [dim] = normalizeDims([{ ...raw, name: str(raw.name) || str(raw.id) }]);
    return dim
      ? [{ ...dim, id: str(raw.id), provider: str(raw.provider), plan: str(raw.plan) }]
      : [];
  });
};

/** Sums account rows by credential ID, most requests first. */
export function mergeAccounts(
  a: ApiKeyAccountUsage[],
  b: ApiKeyAccountUsage[]
): ApiKeyAccountUsage[] {
  const meta = new Map<string, ApiKeyAccountUsage>();
  for (const row of [...a, ...b]) if (!meta.has(row.id)) meta.set(row.id, row);
  const asDims = (rows: ApiKeyAccountUsage[]) => rows.map((row) => ({ ...row, name: row.id }));
  return mergeDims(asDims(a), asDims(b)).map((dim) => {
    const info = meta.get(dim.name)!;
    return { ...dim, id: info.id, name: info.name, provider: info.provider, plan: info.plan };
  });
}

export function normalizeApiKeyRequests(payload: unknown): ApiKeyRequestEntry[] {
  const rows = isRecord(payload) && Array.isArray(payload.requests) ? payload.requests : [];
  return rows.flatMap((raw) => {
    if (!isRecord(raw) || !str(raw.time)) return [];
    return [
      {
        time: str(raw.time),
        key: str(raw.key),
        keyName: str(raw.key_name),
        authId: str(raw.auth_id),
        accountName: str(raw.account_name),
        plan: str(raw.plan),
        provider: str(raw.provider),
        model: str(raw.model),
        effort: str(raw.effort),
        tier: str(raw.tier),
        stream: raw.stream === true,
        failed: raw.failed === true,
        statusCode: toNumber(raw.status_code),
        latencyMs: toNumber(raw.latency_ms),
        ttftMs: toNumber(raw.ttft_ms),
        inputTokens: toNumber(raw.input_tokens),
        cachedTokens: toNumber(raw.cached_tokens),
        outputTokens: toNumber(raw.output_tokens),
        reasoningTokens: toNumber(raw.reasoning_tokens),
        tokens: toNumber(raw.tokens),
        cost: toNumber(raw.cost),
        requestId: str(raw.request_id),
      },
    ];
  });
}

/** Sums dimension rows by name, most requests first. */
export function mergeDims(a: ApiKeyDimUsage[], b: ApiKeyDimUsage[]): ApiKeyDimUsage[] {
  const byName = new Map<string, ApiKeyDimUsage>();
  for (const row of [...a, ...b]) {
    const acc = byName.get(row.name);
    if (!acc) {
      byName.set(row.name, { ...row });
      continue;
    }
    acc.requests += row.requests;
    acc.failed += row.failed;
    acc.tokens += row.tokens;
    acc.outputTokens += row.outputTokens;
    acc.reasoningTokens += row.reasoningTokens;
    acc.cost += row.cost;
    acc.latencyMs += row.latencyMs;
    acc.latencyCount += row.latencyCount;
  }
  return [...byName.values()].sort(
    (x, y) => y.requests - x.requests || x.name.localeCompare(y.name)
  );
}

const normalizeModels = (value: unknown): ApiKeyModelUsage[] =>
  (Array.isArray(value) ? value : []).flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.model !== 'string' || !raw.model) return [];
    return [
      {
        model: raw.model,
        requests: toNumber(raw.requests),
        failed: toNumber(raw.failed),
        inputTokens: toNumber(raw.input_tokens),
        outputTokens: toNumber(raw.output_tokens),
        cachedTokens: toNumber(raw.cached_tokens),
        cacheWriteTokens: toNumber(raw.cache_write_tokens),
        reasoningTokens: toNumber(raw.reasoning_tokens),
        tokens: toNumber(raw.tokens),
        cost: toNumber(raw.cost),
        streamed: toNumber(raw.streamed),
        latencyMs: toNumber(raw.latency_ms),
        latencyCount: toNumber(raw.latency_count),
        ttftMs: toNumber(raw.ttft_ms),
        ttftCount: toNumber(raw.ttft_count),
        efforts: normalizeDims(raw.efforts),
        tiers: normalizeDims(raw.tiers),
      },
    ];
  });

const normalizeReasons = (value: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!isRecord(value)) return out;
  for (const [reason, count] of Object.entries(value)) {
    const n = toNumber(count);
    if (reason && n > 0) out[reason] = n;
  }
  return out;
};

const normalizeHistory = (value: unknown): ApiKeyHistoryBucket[] =>
  (Array.isArray(value) ? value : []).flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.time !== 'string' || !raw.time) return [];
    return [{ time: raw.time, models: normalizeModels(raw.models) }];
  });

export function normalizeApiKeyPolicyUsage(payload: unknown): ApiKeyPolicyUsage[] {
  const keys = isRecord(payload) && Array.isArray(payload.keys) ? payload.keys : [];
  return keys.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.key !== 'string') return [];
    const rawUsage = isRecord(entry.usage) ? entry.usage : {};
    const usage = {} as Record<ApiKeyStatsWindow, ApiKeyWindowUsage>;
    for (const window of API_KEY_STATS_WINDOWS) {
      const raw = isRecord(rawUsage[window]) ? rawUsage[window] : {};
      usage[window] = {
        tokens: toNumber(raw.tokens),
        cost: toNumber(raw.cost),
        requests: toNumber(raw.requests),
        failed: toNumber(raw.failed),
        resetAt: typeof raw.reset_at === 'string' ? raw.reset_at : '',
        models: normalizeModels(raw.models),
        accounts: normalizeAccounts(raw.accounts),
        rejected: toNumber(raw.rejected),
        rejectedReasons: normalizeReasons(raw.rejected_reasons),
        lastRejectedAt: typeof raw.last_rejected_at === 'string' ? raw.last_rejected_at : '',
      };
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    return [
      {
        key: entry.key,
        name,
        disabled: entry.disabled === true,
        expired: entry.expired === true,
        usage,
        daily: normalizeHistory(entry.daily),
        hourly: normalizeHistory(entry.hourly),
      },
    ];
  });
}

/** Sums the given keys' model rows for one window, heaviest token users first. */
export function aggregateModelUsage(
  entries: ApiKeyPolicyUsage[],
  window: ApiKeyStatsWindow
): ApiKeyModelUsage[] {
  const byModel = new Map<string, ApiKeyModelUsage>();
  for (const entry of entries) {
    for (const row of entry.usage[window].models) {
      const acc = byModel.get(row.model);
      if (!acc) {
        byModel.set(row.model, {
          ...row,
          efforts: mergeDims(row.efforts, []),
          tiers: mergeDims(row.tiers, []),
        });
        continue;
      }
      acc.requests += row.requests;
      acc.failed += row.failed;
      acc.inputTokens += row.inputTokens;
      acc.outputTokens += row.outputTokens;
      acc.cachedTokens += row.cachedTokens;
      acc.cacheWriteTokens += row.cacheWriteTokens;
      acc.reasoningTokens += row.reasoningTokens;
      acc.tokens += row.tokens;
      acc.cost += row.cost;
      acc.streamed += row.streamed;
      acc.latencyMs += row.latencyMs;
      acc.latencyCount += row.latencyCount;
      acc.ttftMs += row.ttftMs;
      acc.ttftCount += row.ttftCount;
      acc.efforts = mergeDims(acc.efforts, row.efforts);
      acc.tiers = mergeDims(acc.tiers, row.tiers);
    }
  }
  return [...byModel.values()].sort(
    (a, b) => b.tokens - a.tokens || b.requests - a.requests || a.model.localeCompare(b.model)
  );
}

export const apiKeyPolicyUsageApi = {
  list: async () =>
    normalizeApiKeyPolicyUsage(await apiClient.get<unknown>('/access/api-key-usage')),
  /** Latest served requests, newest first; older backends without the endpoint reject. */
  requests: async (limit = 500) =>
    normalizeApiKeyRequests(
      await apiClient.get<unknown>(`/access/api-key-requests?limit=${limit}`)
    ),
};
