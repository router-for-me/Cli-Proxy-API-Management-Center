import { Database } from 'bun:sqlite';
import { usagePayloadNumber } from './usagePayloads';

/** Selected columns of the CPAMP usage_events schema (repository/sqlite/migrate.go). */
export const CPAMP_COLUMNS = {
  id: 'INTEGER PRIMARY KEY',
  timestamp_ms: 'INTEGER',
  provider: 'TEXT',
  service_tier: 'TEXT',
  model: 'TEXT',
  requested_model: 'TEXT',
  resolved_model: 'TEXT',
  response_model: 'TEXT',
  auth_index: 'TEXT',
  account_snapshot: 'TEXT',
  auth_label_snapshot: 'TEXT',
  auth_file_snapshot: 'TEXT',
  fail_summary: 'TEXT',
  header_trace_id: 'TEXT',
  endpoint: 'TEXT',
  x_forwarded_for: 'TEXT',
  source: 'TEXT',
  auth_provider_snapshot: 'TEXT',
  auth_project_id_snapshot: 'TEXT',
  header_quota_plan_type: 'TEXT',
  header_error_kind: 'TEXT',
  header_error_code: 'TEXT',
  auth_type: 'TEXT',
  api_key_hash: 'TEXT',
  user_agent: 'TEXT',
  client_ip: 'TEXT',
  path: 'TEXT',
  method: 'TEXT',
  reasoning_effort: 'TEXT',
  executor_type: 'TEXT',
  request_id: 'TEXT',
  session_id: 'TEXT',
  parent_session_id: 'TEXT',
  stream: 'INTEGER',
  failed: 'INTEGER',
  fail_status_code: 'INTEGER',
  latency_ms: 'INTEGER',
  ttft_ms: 'INTEGER',
  normalized_total_input_tokens: 'INTEGER',
  normalized_uncached_input_tokens: 'INTEGER',
  normalized_cache_read_tokens: 'INTEGER',
  normalized_cache_creation_tokens: 'INTEGER',
  output_tokens: 'INTEGER',
  reasoning_tokens: 'INTEGER',
  total_tokens: 'INTEGER',
  raw_json: 'TEXT',
} as const;
export const V8_SESSION = '01234567-89ab-8def-8123-456789abcdef';
export const PARENT_SESSION = '01234567-89ab-4def-8123-456789abcdef';

export function cpampRow(index: number, overrides: Record<string, string | number | null> = {}) {
  return {
    id: index,
    timestamp_ms: Date.UTC(2026, 10, 1, index % 3),
    provider: 'claude',
    service_tier: 'standard',
    model: 'client-claude',
    requested_model: 'client-claude',
    resolved_model: 'claude-test-4',
    response_model: 'claude-test-4-20260401',
    auth_index: '3',
    account_snapshot: 'snapshot@example.test',
    auth_label_snapshot: 'Synthetic account',
    auth_file_snapshot: 'synthetic-auth.json',
    fail_summary: index % 2 ? 'upstream said no' : '',
    header_trace_id: `trace-header-${index}`,
    // What the live normalizer derives from usagePayload (its endpoint, forwarded-for, masked
    // source and its Retry-After header), so an event seen live and imported agrees.
    endpoint: 'POST /v1/messages',
    x_forwarded_for: '203.0.113.5, 198.51.100.8',
    source: 'SYN***@example.test',
    auth_provider_snapshot: '',
    auth_project_id_snapshot: '',
    header_quota_plan_type: '',
    header_error_kind: 'rate_limit',
    header_error_code: 'retry_after',
    auth_type: 'oauth',
    api_key_hash: 'a'.repeat(64),
    user_agent: 'test-client/1.0',
    client_ip: '192.0.2.10',
    path: '/v1/messages',
    method: 'POST',
    reasoning_effort: 'medium',
    executor_type: 'ClaudeExecutor',
    request_id: `req-${index}`,
    session_id: V8_SESSION,
    parent_session_id: PARENT_SESSION,
    stream: 1,
    failed: index % 2,
    fail_status_code: index % 2 ? 502 : 200,
    latency_ms: 1500 + index,
    ttft_ms: index % 3 === 0 ? 0 : 420,
    normalized_total_input_tokens: 950,
    normalized_uncached_input_tokens: 100,
    normalized_cache_read_tokens: 800,
    normalized_cache_creation_tokens: 50,
    output_tokens: 200,
    reasoning_tokens: 60,
    total_tokens: 1150,
    raw_json: JSON.stringify(usagePayloadNumber(index)),
    ...overrides,
  };
}

export function createCpamp(path: string, count: number) {
  const db = new Database(path, { create: true, strict: true });
  db.exec('PRAGMA temp_store=MEMORY');
  db.exec(
    `CREATE TABLE usage_events (${Object.entries(CPAMP_COLUMNS)
      .map(([key, type]) => `${key} ${type}`)
      .join(', ')})`
  );
  const columns = Object.keys(CPAMP_COLUMNS);
  const insert = db.query(
    `INSERT INTO usage_events (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  );
  const add = (row: ReturnType<typeof cpampRow>) =>
    insert.run(...columns.map((key) => row[key as keyof typeof row]));
  db.transaction(() => {
    for (let i = 1; i <= count; i += 1) add(cpampRow(i));
  })();
  return { db, add };
}

const ROLLUP_REVISION = 'synthetic-provider-2';
export const ROLLUP_HOUR = Date.UTC(2026, 10, 1, 1);
/** Synthetic provider-rollup schema from CPAMP's repository/sqlite/migrate.go. */
export function createCpampRollups(
  db: Database,
  overrides: Record<string, string | number | null> = {}
) {
  db.exec(`CREATE TABLE usage_pricing_rollup_state (
    rollup_name TEXT PRIMARY KEY, schema_version INTEGER NOT NULL,
    structure_revision TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
    backfill_last_event_id INTEGER NOT NULL DEFAULT 0, coverage_event_id INTEGER NOT NULL DEFAULT 0,
    target_event_id INTEGER NOT NULL DEFAULT 0, processed_events INTEGER NOT NULL DEFAULT 0,
    min_bucket_ms INTEGER, max_bucket_ms INTEGER, last_run_started_at_ms INTEGER,
    updated_at_ms INTEGER NOT NULL DEFAULT 0, finished_at_ms INTEGER, last_error TEXT
  );
  CREATE TABLE usage_pricing_hourly_provider_rollups_v1 (
    structure_revision TEXT NOT NULL, bucket_ms INTEGER NOT NULL, model TEXT NOT NULL,
    billing_model TEXT NOT NULL, pricing_model TEXT NOT NULL, service_tier TEXT NOT NULL,
    context_threshold_tokens INTEGER NOT NULL, failed INTEGER NOT NULL,
    provider TEXT NOT NULL, auth_provider_snapshot TEXT NOT NULL,
    calls INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    cached_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_creation_tokens INTEGER NOT NULL DEFAULT 0, long_input_tokens INTEGER NOT NULL DEFAULT 0,
    long_output_tokens INTEGER NOT NULL DEFAULT 0, long_cached_tokens INTEGER NOT NULL DEFAULT 0,
    long_cache_read_tokens INTEGER NOT NULL DEFAULT 0, long_cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0, latency_sum_ms INTEGER NOT NULL DEFAULT 0,
    latency_samples INTEGER NOT NULL DEFAULT 0, zero_token_calls INTEGER NOT NULL DEFAULT 0,
    positive_latency_sum_ms INTEGER NOT NULL DEFAULT 0, positive_latency_samples INTEGER NOT NULL DEFAULT 0,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY (structure_revision, bucket_ms, model, billing_model, pricing_model,
      service_tier, context_threshold_tokens, failed, provider, auth_provider_snapshot)
  )`);
  function insert(table: string, row: Record<string, string | number | null>) {
    const keys = Object.keys(row);
    db.query(
      `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
    ).run(...Object.values(row));
  }
  insert('usage_pricing_rollup_state', {
    rollup_name: 'pricing_v1',
    schema_version: 1,
    structure_revision: ROLLUP_REVISION,
    status: 'ready',
    coverage_event_id: 1,
    min_bucket_ms: ROLLUP_HOUR,
    max_bucket_ms: ROLLUP_HOUR,
    ...overrides,
  });
  return (row: Record<string, string | number | null> = {}) =>
    insert('usage_pricing_hourly_provider_rollups_v1', {
      structure_revision: ROLLUP_REVISION,
      bucket_ms: ROLLUP_HOUR,
      model: 'client-claude',
      billing_model: 'claude-test-4',
      pricing_model: 'claude-test-4',
      service_tier: 'standard',
      context_threshold_tokens: 0,
      failed: 1,
      provider: 'claude',
      auth_provider_snapshot: 'claude',
      calls: 1,
      input_tokens: 950,
      output_tokens: 200,
      reasoning_tokens: 60,
      cached_tokens: 0,
      cache_read_tokens: 800,
      cache_creation_tokens: 50,
      total_tokens: 1150,
      updated_at_ms: ROLLUP_HOUR + 3_600_000,
      ...row,
    });
}
