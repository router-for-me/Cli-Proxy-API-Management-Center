import { apiClient } from './client';

export type OllamaRange = '24h' | '7d' | '30d';
export interface OllamaMetrics {
  request_count: number;
  usage_usd?: number | null;
  input_tokens?: number | null;
  cached_input_tokens?: number | null;
  output_tokens?: number | null;
}
export interface OllamaQuota {
  connection_id: string;
  fetched_at: string;
  range: OllamaRange;
  usage?: {
    totals: OllamaMetrics;
    buckets: (OllamaMetrics & { from: string; until: string; partial?: boolean })[];
  };
  balance?: {
    included?: {
      balance_usd?: number | null;
      allowance_usd?: number | null;
      period?: { from: string; until: string };
      session?: { remaining_percent: number; resets_at: string };
      weekly?: { remaining_percent: number; resets_at: string };
    };
    purchased?: { balance_usd: number | null };
  };
  usage_error?: string;
  balance_error?: string;
}
export interface OllamaConnection {
  connection_id: string;
  display_name: string;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = () => new Error('Invalid Ollama quota response');
export function normalizeOllamaConnections(value: unknown): OllamaConnection[] {
  if (!record(value) || !Array.isArray(value.connections)) throw invalid();
  const seen = new Set<string>();
  return value.connections.map((item: unknown) => {
    if (
      !record(item) ||
      typeof item.connection_id !== 'string' ||
      !item.connection_id ||
      typeof item.display_name !== 'string' ||
      !item.display_name ||
      seen.has(item.connection_id)
    )
      throw invalid();
    seen.add(item.connection_id);
    return { connection_id: item.connection_id, display_name: item.display_name };
  });
}
export function normalizeOllamaQuota(
  value: unknown,
  connectionId: string,
  range: OllamaRange
): OllamaQuota {
  if (
    !record(value) ||
    value.connection_id !== connectionId ||
    value.range !== range ||
    typeof value.fetched_at !== 'string' ||
    !Number.isFinite(Date.parse(value.fetched_at))
  )
    throw invalid();
  if (value.usage !== undefined) {
    if (!record(value.usage) || !record(value.usage.totals) || !Array.isArray(value.usage.buckets))
      throw invalid();
    for (const metrics of [value.usage.totals, ...value.usage.buckets]) {
      if (
        !record(metrics) ||
        !Number.isSafeInteger(metrics.request_count) ||
        Number(metrics.request_count) < 0
      )
        throw invalid();
      for (const field of ['usage_usd', 'input_tokens', 'cached_input_tokens', 'output_tokens']) {
        if (
          metrics[field] != null &&
          (typeof metrics[field] !== 'number' || !Number.isFinite(metrics[field]))
        )
          throw invalid();
      }
    }
    for (const bucket of value.usage.buckets) {
      if (
        !record(bucket) ||
        typeof bucket.from !== 'string' ||
        typeof bucket.until !== 'string' ||
        !Number.isFinite(Date.parse(bucket.from)) ||
        !Number.isFinite(Date.parse(bucket.until))
      )
        throw invalid();
    }
  }
  if (
    value.balance !== undefined &&
    (!record(value.balance) ||
      !record(value.balance.included) ||
      !record(value.balance.purchased) ||
      typeof value.balance.purchased.balance_usd !== 'number' ||
      !Number.isFinite(value.balance.purchased.balance_usd))
  )
    throw invalid();
  if (record(value.balance) && record(value.balance.included)) {
    const included = value.balance.included;
    if ('balance_usd' in included) {
      if (
        typeof included.balance_usd !== 'number' ||
        !Number.isFinite(included.balance_usd) ||
        typeof included.allowance_usd !== 'number' ||
        !Number.isFinite(included.allowance_usd) ||
        !record(included.period) ||
        typeof included.period.from !== 'string' ||
        typeof included.period.until !== 'string' ||
        !Number.isFinite(Date.parse(included.period.from)) ||
        !Number.isFinite(Date.parse(included.period.until))
      )
        throw invalid();
    } else {
      for (const field of ['session', 'weekly']) {
        const limit = included[field];
        if (
          !record(limit) ||
          typeof limit.remaining_percent !== 'number' ||
          !Number.isFinite(limit.remaining_percent) ||
          limit.remaining_percent < 0 ||
          limit.remaining_percent > 100 ||
          typeof limit.resets_at !== 'string' ||
          !Number.isFinite(Date.parse(limit.resets_at))
        )
          throw invalid();
      }
    }
  }
  if (value.usage === undefined && value.balance === undefined) throw invalid();
  return value as unknown as OllamaQuota;
}

export const ollamaQuotaApi = {
  async connections(): Promise<OllamaConnection[]> {
    try {
      const result = await apiClient.get<unknown>('/quotas/ollama/connections');
      return normalizeOllamaConnections(result);
    } catch (error) {
      // Older v8 backends do not support config-backed quota discovery.
      if ((error as { status?: number }).status === 404) return [];
      throw error;
    }
  },
  async fetch(connectionId: string, range: OllamaRange): Promise<OllamaQuota> {
    const result = await apiClient.get<unknown>('/quotas/ollama', {
      params: { provider_id: connectionId, range, scope: 'self' },
    });
    return normalizeOllamaQuota(result, connectionId, range);
  },
};
