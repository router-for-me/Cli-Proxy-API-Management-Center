import type {
  AnalyticsMetrics,
  AnalyticsRequest,
  AnalyticsResponse,
} from '../../src/domain/analytics/types';

/** Synthetic only. Never derived from production usage, auth, queues or metadata. */
export const analyticsUiMetrics: AnalyticsMetrics = {
  calls: 128,
  success_calls: 120,
  failure_calls: 8,
  input_tokens: 84000,
  output_tokens: 12500,
  cache_read_tokens: 46000,
  cache_creation_tokens: 1500,
  reasoning_tokens: 2000,
  total_tokens: 98000,
  uncached_input_tokens: null,
  cost: {
    usd: 0.45678,
    status: 'partial',
    reasons: ['Legacy cache-write lifetime unavailable'],
    priced_calls: 100,
    unpriced_calls: 28,
  },
  average_latency_ms: 1100,
  p95_latency_ms: 2400,
  p95_ttft_ms: null,
};
export const analyticsUiRequest: AnalyticsRequest = {
  usage_presence: 'reported',
  record_kind: 'execution',
  parent_execution_id: 'synthetic-parent-execution',
  timing: {
    origin: 'execution-start',
    upstream_start_ms: 20,
    first_response_ms: 150,
    first_content_ms: null,
    recorded_ms: 1200,
  },
  id: 'synthetic-event-2',
  request_id: 'synthetic-request-2',
  execution_id: 'synthetic-execution-2',
  instance_id: 'fixture-source',
  timestamp_ms: 1793233800000,
  provider: 'claude',
  model: 'fixture-model',
  requested_model: 'fixture-alias',
  resolved_model: 'fixture-model',
  response_model: 'fixture-model',
  failed: false,
  status_code: 200,
  latency_ms: 1200,
  ttft_ms: null,
  output_tokens_per_second: 50,
  timing_method: 'reported-mixed-method',
  input_tokens: 1000,
  output_tokens: 60,
  cache_read_tokens: 800,
  cache_creation_tokens: 0,
  reasoning_tokens: 0,
  total_tokens: 1060,
  uncached_input_tokens: null,
  cost: { usd: null, status: 'unpriced', reasons: ['Billing alias unresolved'] },
  method: 'POST',
  path: '/v1/messages',
  stream: true,
  requested_service_tier: 'auto',
  effective_service_tier: 'standard',
  service_tier: 'standard',
  reasoning_effort: 'medium',
  executor_type: 'fixture',
  account_label: 'Synthetic account',
  session_id: 'synthetic-session',
  parent_session_id: 'synthetic-parent',
  trace_id: 'synthetic-trace',
  client_ip: '192.0.2.10',
  user_agent: 'SyntheticBrowser/1.0',
};
export const analyticsUiResponse: AnalyticsResponse = {
  schema_version: 1,
  generated_at_ms: 1793235600000,
  from_ms: 1793224800000,
  to_ms: 1793235600000,
  granularity: 'hour',
  coverage: {
    scope: 'retained-usage-events',
    raw_complete: false,
    limitations: ['Synthetic fixture: retention and measurement gaps'],
    source_attribution: 'partial',
    price_basis: 'current-configured-rates',
    price_revision: 'synthetic-rate-revision-1',
    timing_method: 'reported-mixed-method',
  },
  summary: analyticsUiMetrics,
  timeline: [
    { ...analyticsUiMetrics, bucket_ms: 1793224800000, calls: 50 },
    // Intentionally omit one bucket to exercise a gap.
    { ...analyticsUiMetrics, bucket_ms: 1793232000000, calls: 78, p95_latency_ms: null },
  ],
  models: [{ ...analyticsUiMetrics, key: 'fixture-model', label: 'Fixture model (billing alias)' }],
  providers: [{ ...analyticsUiMetrics, key: 'claude', label: 'Claude' }],
  filter_options: { providers: ['claude', 'codex'], models: ['fixture-model', 'fixture-unpriced'] },
  requests: {
    items: [
      analyticsUiRequest,
      {
        ...analyticsUiRequest,
        id: 'synthetic-event-1',
        failed: true,
        status_code: 429,
        error_summary: 'Synthetic rate limit',
        cost: { usd: 0, status: 'explicit-zero', reasons: [] },
      },
    ],
    total_count: 128,
    has_more: true,
    next_before_ms: 1793233800000,
    next_before_id: 1,
  },
  rates: [
    {
      instance_id: 'fixture-source',
      instance_label: 'Synthetic source',
      provider: 'claude',
      id: 'fixture-model',
      registered: true,
      matched_model: 'billing-fixture',
      status: 'priced',
      input_per_million: 3,
      output_per_million: 15,
      cache_read_per_million: 0.3,
      cache_write_per_million: 3.75,
      source: 'synthetic configured rates',
      updated_at_ms: 1793235600000,
      context_tiers: [
        { above_input_tokens: 200000, input_per_million: 6, output_per_million: 22.5 },
      ],
      service_tiers: [{ name: 'fast', input_per_million: 6, output_per_million: 30 }],
    },
    {
      instance_id: 'fixture-source',
      instance_label: 'Synthetic source',
      provider: 'codex',
      id: 'unused-unpriced-model',
      registered: true,
      matched_model: null,
      status: 'unpriced',
      input_per_million: null,
      output_per_million: null,
      cache_read_per_million: null,
      cache_write_per_million: null,
      source: 'synthetic catalog',
      updated_at_ms: null,
      context_tiers: [],
      service_tiers: [],
    },
  ],
  catalog_sources: [
    { instance_id: 'fixture-source', label: 'Synthetic source', state: 'ready' },
    { instance_id: 'offline-source', label: 'Offline synthetic source', state: 'unavailable' },
  ],
};

export type AnalyticsScenario = 'ready' | 'empty' | 'unknown' | 'zero' | 'large';

/** Canned transport scenarios, not a replacement for CPA accounting or query tests. */
export function analyticsScenario(
  scenario: AnalyticsScenario,
  query: import('../../src/domain/analytics/types').AnalyticsQuery
): AnalyticsResponse {
  const data = structuredClone(analyticsUiResponse);
  data.from_ms = query.from_ms;
  data.to_ms = query.to_ms;
  data.generated_at_ms = query.to_ms;
  data.granularity = query.granularity;
  const step = query.granularity === 'day' ? 86_400_000 : 3_600_000;
  data.timeline = Array.from(
    { length: Math.ceil((query.to_ms - query.from_ms) / step) },
    (_, i) => ({
      ...data.summary,
      bucket_ms: query.from_ms + i * step,
      calls: [0, 3, 7, 12, 6, 9][i % 6],
      // Volumes move with traffic so trend lines are distinguishable in screenshots.
      input_tokens: [2_100, 6_400, 9_800, 16_000, 7_300, 11_200][i % 6] * (1 + (i % 4) / 3),
      output_tokens: [90, 320, 610, 1_050, 410, 700][(i + 1) % 6],
      cache_read_tokens: [1_200, 4_000, 7_500, 12_800, 5_200, 8_600][(i + 2) % 6],
      total_tokens: [3_400, 10_700, 17_900, 29_900, 12_900, 20_500][i % 6] * (1 + (i % 4) / 3),
      cost: { ...data.summary.cost, usd: [0.4, 1.3, 2.6, 4.9, 1.8, 3.2][(i + 3) % 6] },
      average_latency_ms: [800, 950, 1_400, 1_900, 1_100, 1_250][i % 6],
      p95_latency_ms: [1_600, 2_100, 2_900, 3_800, 2_400, 2_700][i % 6],
      p95_ttft_ms: i % 3 === 0 ? null : [150, 210, 320, 480, 260, 300][i % 6],
    })
  ).filter((_, i) => i !== 2); // A missing time bucket is different from an explicit zero.
  data.providers.push({ ...data.summary, key: 'codex', label: 'GPT / Codex' });
  data.requests.items.push({
    ...structuredClone(analyticsUiRequest),
    id: 'synthetic-codex',
    provider: 'codex',
  });
  data.requests.items.forEach((r) => {
    r.timestamp_ms = query.to_ms - 60_000;
  });
  data.requests.next_before_ms = query.to_ms - 60_000;
  if (query.provider)
    data.requests.items = data.requests.items.filter((r) => r.provider === query.provider);
  if (query.outcome !== 'all')
    data.requests.items = data.requests.items.filter(
      (r) => r.failed === (query.outcome === 'failed')
    );
  if (query.before_id !== undefined) {
    data.requests.items = [{ ...data.requests.items[0], id: 'synthetic-next-page' }];
    data.requests.has_more = false;
    data.requests.next_before_ms = null;
    data.requests.next_before_id = null;
  }
  if (scenario === 'large') {
    data.summary.input_tokens = 3_500_360_831;
    data.summary.output_tokens = 14_480_164;
    data.summary.cost.usd = 1547.350158;
    const longName = 'synthetic-provider-model-with-a-very-long-qualified-name-and-context-variant';
    data.models[0].label = longName;
    data.rates[0].id = longName;
    data.requests.items[0].model = longName;
    data.requests.items[0].error_summary = 'Synthetic detailed error '.repeat(20);
    data.requests.items[0].fail_summary = `${'Synthetic upstream failure text. '.repeat(120)}END-OF-FAILURE`;
    data.requests.items[0].header_trace_id = `synthetic-header-trace-${'x'.repeat(160)}`;
    data.requests.items[0].auth_file_snapshot = `${'synthetic-credential-file-'.repeat(8)}.json`;
  }
  if (scenario === 'unknown') {
    data.summary.cost = {
      usd: null,
      status: 'unavailable',
      reasons: ['Synthetic missing measurement'],
    };
    data.summary.average_latency_ms = null;
    data.summary.p95_latency_ms = null;
    data.summary.p95_ttft_ms = null;
    // Unknown timing stays unknown everywhere, not only in the totals.
    [...data.timeline, ...data.providers, ...data.models].forEach((point) => {
      point.cost = data.summary.cost;
      point.average_latency_ms = null;
      point.p95_latency_ms = null;
      point.p95_ttft_ms = null;
    });
    data.requests.items.forEach((r) => {
      r.usage_presence = 'unknown';
      r.input_tokens = r.cache_read_tokens = r.cache_creation_tokens = r.ttft_ms = null;
      r.output_tokens_per_second = null;
      r.cost = data.summary.cost;
    });
  }
  if (scenario === 'zero' || scenario === 'empty') {
    data.summary = {
      calls: scenario === 'empty' ? 0 : 3,
      success_calls: scenario === 'empty' ? 0 : 3,
      failure_calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 0,
      uncached_input_tokens: 0,
      cost: { usd: 0, status: 'explicit-zero', reasons: [], priced_calls: 3, unpriced_calls: 0 },
      average_latency_ms: 0,
      p95_latency_ms: 0,
      p95_ttft_ms: 0,
    };
    data.timeline = data.timeline.map((p) => ({ ...data.summary, bucket_ms: p.bucket_ms }));
  }
  if (scenario === 'empty') {
    data.summary.average_latency_ms = null;
    data.summary.p95_latency_ms = null;
    data.summary.p95_ttft_ms = null;
    data.summary.cost = {
      usd: null,
      status: 'unavailable',
      reasons: [],
      priced_calls: 0,
      unpriced_calls: 0,
    };
    data.timeline = [];
    data.providers = [];
    data.models = [];
    data.rates = [];
    data.requests = {
      items: [],
      total_count: 0,
      has_more: false,
      next_before_ms: null,
      next_before_id: null,
    };
    data.catalog_sources = [];
  }
  return data;
}
