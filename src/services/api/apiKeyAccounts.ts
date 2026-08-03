import { apiClient } from './client';
import type {
  ApiKeyLimit,
  ApiKeyProfile,
  ApiKeyUsageEventsPage,
  ApiKeyUsageSettings,
  ApiKeyUsageSummary,
} from '@/types/apiKeyAccounts';

interface LimitWire {
  requests?: number;
  tokens?: number;
}

interface ProfileWire {
  id: string;
  name: string;
  'api-key'?: string;
  'key-fingerprint'?: string;
  disabled?: boolean;
  'allowed-models'?: string[];
  weekly?: LimitWire;
  monthly?: LimitWire;
}

interface SettingsWire {
  enabled?: boolean;
  'database-path'?: string;
  'retention-days'?: number;
  timezone?: string;
}

interface TotalsWire {
  requests?: number;
  successes?: number;
  failures?: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
  total_tokens?: number;
}

interface ProfileUsageWire {
  id?: string;
  name?: string;
  key_fingerprint?: string;
  disabled?: boolean;
  allowed_models?: string[];
  limit?: LimitWire;
  usage?: TotalsWire;
  remaining_requests?: number;
  remaining_tokens?: number;
}

interface ModelUsageWire {
  profile_id?: string;
  model?: string;
  provider?: string;
  calls?: number;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface SummaryWire {
  period?: string;
  timezone?: string;
  start?: string;
  end?: string;
  totals?: TotalsWire;
  profiles?: ProfileUsageWire[];
  models?: ModelUsageWire[];
}

interface EventWire {
  id?: number;
  profile_id?: string;
  key_fingerprint?: string;
  provider?: string;
  model?: string;
  requested_at?: string;
  failed?: boolean;
  status_code?: number;
  latency_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cached_tokens?: number;
  total_tokens?: number;
}

interface EventsPageWire {
  events?: EventWire[];
  limit?: number;
  offset?: number;
  total?: number;
}

const toLimit = (wire?: LimitWire): ApiKeyLimit => ({
  requests: Number(wire?.requests ?? 0),
  tokens: Number(wire?.tokens ?? 0),
});

const fromProfileWire = (wire: ProfileWire): ApiKeyProfile => ({
  id: wire.id,
  name: wire.name,
  apiKey: wire['api-key'] ?? '',
  keyFingerprint: wire['key-fingerprint'] ?? '',
  disabled: Boolean(wire.disabled),
  allowedModels: Array.isArray(wire['allowed-models']) ? wire['allowed-models'] : [],
  weekly: toLimit(wire.weekly),
  monthly: toLimit(wire.monthly),
});

const toProfileWire = (profile: ApiKeyProfile): ProfileWire => ({
  id: profile.id,
  name: profile.name,
  'api-key': profile.apiKey,
  disabled: profile.disabled,
  'allowed-models': profile.allowedModels,
  weekly: profile.weekly,
  monthly: profile.monthly,
});

const fromSettingsWire = (wire?: SettingsWire): ApiKeyUsageSettings => ({
  enabled: Boolean(wire?.enabled),
  databasePath: wire?.['database-path'] ?? '',
  retentionDays: Number(wire?.['retention-days'] ?? 400),
  timezone: wire?.timezone ?? 'UTC',
});

const mapTotals = (wire: TotalsWire | undefined) => ({
  requests: Number(wire?.requests ?? 0),
  successes: Number(wire?.successes ?? 0),
  failures: Number(wire?.failures ?? 0),
  inputTokens: Number(wire?.input_tokens ?? 0),
  outputTokens: Number(wire?.output_tokens ?? 0),
  reasoningTokens: Number(wire?.reasoning_tokens ?? 0),
  cachedTokens: Number(wire?.cached_tokens ?? 0),
  totalTokens: Number(wire?.total_tokens ?? 0),
});

const fromSummaryWire = (wire: SummaryWire): ApiKeyUsageSummary => ({
  period: wire.period === 'month' ? 'month' : 'week',
  timezone: String(wire.timezone ?? 'UTC'),
  start: String(wire.start ?? ''),
  end: String(wire.end ?? ''),
  totals: mapTotals(wire.totals),
  profiles: Array.isArray(wire.profiles)
    ? wire.profiles.map((profile) => ({
        id: String(profile.id ?? ''),
        name: String(profile.name ?? ''),
        keyFingerprint: String(profile.key_fingerprint ?? ''),
        disabled: Boolean(profile.disabled),
        allowedModels: Array.isArray(profile.allowed_models) ? profile.allowed_models : [],
        limit: toLimit(profile.limit),
        usage: mapTotals(profile.usage),
        remainingRequests: Number(profile.remaining_requests ?? -1),
        remainingTokens: Number(profile.remaining_tokens ?? -1),
      }))
    : [],
  models: Array.isArray(wire.models)
    ? wire.models.map((model) => ({
        profileId: String(model.profile_id ?? ''),
        model: String(model.model ?? ''),
        provider: String(model.provider ?? ''),
        calls: Number(model.calls ?? 0),
        inputTokens: Number(model.input_tokens ?? 0),
        outputTokens: Number(model.output_tokens ?? 0),
        totalTokens: Number(model.total_tokens ?? 0),
      }))
    : [],
});

const mapEventPage = (wire: EventsPageWire): ApiKeyUsageEventsPage => ({
  events: Array.isArray(wire.events)
    ? wire.events.map((event) => ({
        id: Number(event.id),
        profileId: String(event.profile_id ?? ''),
        keyFingerprint: String(event.key_fingerprint ?? ''),
        provider: String(event.provider ?? ''),
        model: String(event.model ?? ''),
        requestedAt: String(event.requested_at ?? ''),
        failed: Boolean(event.failed),
        statusCode: Number(event.status_code ?? 0),
        latencyMs: Number(event.latency_ms ?? 0),
        inputTokens: Number(event.input_tokens ?? 0),
        outputTokens: Number(event.output_tokens ?? 0),
        reasoningTokens: Number(event.reasoning_tokens ?? 0),
        cachedTokens: Number(event.cached_tokens ?? 0),
        totalTokens: Number(event.total_tokens ?? 0),
      }))
    : [],
  limit: Number(wire.limit ?? 100),
  offset: Number(wire.offset ?? 0),
  total: Number(wire.total ?? 0),
});

export const apiKeyAccountsApi = {
  async getProfiles(): Promise<{
    profiles: ApiKeyProfile[];
    settings: ApiKeyUsageSettings;
  }> {
    const response = await apiClient.get<{
      'api-key-profiles'?: ProfileWire[];
      'api-key-usage'?: SettingsWire;
    }>('/api-key-profiles');
    return {
      profiles: (response['api-key-profiles'] ?? []).map(fromProfileWire),
      settings: fromSettingsWire(response['api-key-usage']),
    };
  },

  async create(profile: ApiKeyProfile): Promise<ApiKeyProfile> {
    const response = await apiClient.post<{ profile: ProfileWire }>(
      '/api-key-profiles',
      toProfileWire(profile)
    );
    return fromProfileWire(response.profile);
  },

  async update(profile: ApiKeyProfile): Promise<ApiKeyProfile> {
    const response = await apiClient.put<{ profile: ProfileWire }>(
      `/api-key-profiles/${encodeURIComponent(profile.id)}`,
      toProfileWire(profile)
    );
    return fromProfileWire(response.profile);
  },

  delete: (id: string) =>
    apiClient.delete<{ status: string }>(`/api-key-profiles/${encodeURIComponent(id)}`),

  async getSummary(period: 'week' | 'month'): Promise<ApiKeyUsageSummary | null> {
    const response = await apiClient.get<{ enabled: boolean; summary?: SummaryWire }>(
      '/api-key-usage-summary',
      { params: { period } }
    );
    return response.enabled && response.summary ? fromSummaryWire(response.summary) : null;
  },

  async getEvents(params: {
    profileId?: string;
    start?: string;
    end?: string;
    limit?: number;
    offset?: number;
  }): Promise<ApiKeyUsageEventsPage> {
    const response = await apiClient.get<EventsPageWire>('/api-key-usage-events', {
      params: {
        profile_id: params.profileId || undefined,
        start: params.start || undefined,
        end: params.end || undefined,
        limit: params.limit ?? 100,
        offset: params.offset ?? 0,
      },
    });
    return mapEventPage(response);
  },
};
