import { groupDimensions, sumColumns } from './aggregate';

// SQL text only, so any thread may import it. The connections live in store.ts.

export const WRITER_PRAGMAS_SQL = `
  PRAGMA journal_mode = WAL;
  -- WAL stays consistent with NORMAL; a power loss can drop the last commits, and the proxy's
  -- queue or the reconcile job supplies them again. FULL would fsync every 50 ms batch.
  PRAGMA synchronous = NORMAL;
  PRAGMA journal_size_limit = 67108864;
  PRAGMA temp_store = MEMORY;
  PRAGMA busy_timeout = 5000;
`;

/** For connections opened read-only. */
export const READER_PRAGMAS_SQL = `
  PRAGMA query_only = 1;
  PRAGMA mmap_size = 268435456;
  PRAGMA temp_store = MEMORY;
  PRAGMA busy_timeout = 5000;
`;

/** usage.sqlite holds its own version here; the migration runner creates it before anything. */
export const META_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
  -- schema_version, next_seq, retention_floor_ms, import:cpamp:last_id, heartbeat:<instance>, ...
`;

const MIGRATION_1_SQL = `
  -- Repeated strings are stored once. kind: model, provider, tier, instance, account,
  -- account_label, auth_index, api_key (sha256 hex), user_agent, client_ip, path, method,
  -- effort, executor, timing.
  CREATE TABLE dim (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    value TEXT NOT NULL,
    UNIQUE (kind, value)
  );

  -- Sessions are not in dim: hundreds of thousands a year would slow every search over it.
  CREATE TABLE session (
    id INTEGER PRIMARY KEY,
    uuid TEXT UNIQUE NOT NULL,
    parent_id INTEGER,                   -- session.id of the parent, for subagent trees
    derived INTEGER NOT NULL             -- 1 when the proxy derived the id (UUID version 8)
  );

  -- One row per usage record. Integers only; clustered by time so a range read is sequential.
  CREATE TABLE events (
    ts_ms INTEGER NOT NULL,              -- request start as reported by the proxy
    seq INTEGER NOT NULL,                -- ingestion order, unique; cursor tie-break
    instance_id INTEGER,                 -- NULL for records older than instance attribution
    provider_id INTEGER NOT NULL,
    model_id INTEGER NOT NULL,           -- requested model with a reasoning suffix removed
    requested_model_id INTEGER NOT NULL,
    billing_model_id INTEGER NOT NULL,   -- resolved upstream model, else model_id
    response_model_id INTEGER,
    tier_id INTEGER NOT NULL,            -- tier used for pricing
    failed INTEGER NOT NULL,
    status_code INTEGER,
    latency_ms INTEGER,                  -- NULL when not a positive measurement
    ttft_ms INTEGER,                     -- NULL when unreported, per the timing method
    timing_id INTEGER NOT NULL,
    input_total INTEGER NOT NULL,        -- uncached + cache_read + cache_write
    input_uncached INTEGER NOT NULL,
    cache_read INTEGER NOT NULL,
    cache_write INTEGER NOT NULL,
    output_total INTEGER NOT NULL,       -- includes reasoning
    reasoning INTEGER NOT NULL,
    total INTEGER NOT NULL,
    usage_flags INTEGER NOT NULL,        -- bit 0 presence reported, bits 1-6 component reported,
                                         -- bit 7 breakdown complete, bit 8 usage_fields present
    record_kind INTEGER NOT NULL,        -- 0 unknown, 1 execution, 2 supplementary
    stream INTEGER,
    account_id INTEGER, account_label_id INTEGER, api_key_id INTEGER,
    user_agent_id INTEGER, client_ip_id INTEGER, path_id INTEGER, method_id INTEGER,
    effort_id INTEGER, executor_id INTEGER, requested_tier_id INTEGER, effective_tier_id INTEGER,
    session_id INTEGER,                  -- session.id
    auth_index_id INTEGER,               -- the proxy's credential index; the key that joins to quota
    ingest INTEGER NOT NULL,             -- 0 subscribed, 1 drained, 2 imported from CPAMP, 3 replayed
    PRIMARY KEY (ts_ms, seq)
  ) WITHOUT ROWID;

  -- Identifiers and the fields only the request inspector reads. One page of rows at a time.
  CREATE TABLE event_detail (
    seq INTEGER PRIMARY KEY,
    execution_id TEXT NOT NULL UNIQUE,   -- the event's identity
    ts_ms INTEGER NOT NULL,
    request_id TEXT, parent_execution_id TEXT,
    session_id TEXT, parent_session_id TEXT, trace_id TEXT,
    upstream_start_ms INTEGER, first_response_ms INTEGER, first_content_ms INTEGER,
    recorded_ms INTEGER,
    ingested_at_ms INTEGER NOT NULL
  );
  CREATE INDEX event_detail_request ON event_detail (request_id);

  CREATE TABLE ingest_gaps (
    id INTEGER PRIMARY KEY, instance TEXT NOT NULL,
    from_ms INTEGER NOT NULL, to_ms INTEGER NOT NULL, reason TEXT NOT NULL, missed INTEGER
  );
  CREATE TABLE import_conflicts (
    execution_id TEXT NOT NULL, field TEXT NOT NULL, live TEXT, imported TEXT,
    seen_at_ms INTEGER NOT NULL
  );
  CREATE TABLE client_alias (
    api_key_hash TEXT PRIMARY KEY, alias TEXT NOT NULL
  ) WITHOUT ROWID;
`;

/**
 * Numbered, forward-only migrations of usage.sqlite: entry n brings version n to n + 1, and
 * `meta.schema_version` records how many have run. Append; never edit or reorder an entry that
 * has shipped. A migration that rewrites a table must run as a governed bulk job instead.
 */
const MIGRATION_2_SQL = `
  -- Missing state is unbuilt. Dirty state and event inserts commit atomically.
  CREATE TABLE usage_hour_state (
    hour_ms INTEGER PRIMARY KEY,
    layout TEXT NOT NULL DEFAULT '',
    dirty INTEGER NOT NULL DEFAULT 1,
    supported INTEGER NOT NULL DEFAULT 1
  );
  -- Coverage also includes supplementary events, unlike displayed metrics.
  CREATE TABLE usage_hour_coverage (
    hour_ms INTEGER NOT NULL,
    provider_id INTEGER NOT NULL,
    imported INTEGER NOT NULL,
    PRIMARY KEY (hour_ms, provider_id)
  ) WITHOUT ROWID;
  CREATE TABLE usage_hour_rollup (
    bucket INTEGER NOT NULL,
    ${groupDimensions.map((key) => `${key} INTEGER NOT NULL`).join(',\n    ')},
    ${sumColumns.map((key) => `${key} INTEGER NOT NULL`).join(',\n    ')},
    latencies BLOB NOT NULL,
    ttfts BLOB NOT NULL,
    PRIMARY KEY (bucket, ${groupDimensions.join(', ')})
  ) WITHOUT ROWID;
`;
const MIGRATION_3_SQL = `
  -- A gap stays recorded after an exact CPAMP import or reconcile pass accounts for every
  -- source event in its interval; raw_complete then ignores it. NULL means still open.
  ALTER TABLE ingest_gaps ADD COLUMN filled_at_ms INTEGER;
  ALTER TABLE ingest_gaps ADD COLUMN filled_by TEXT;  -- the job kind: import or reconcile
`;
const MIGRATION_4_SQL = `
  -- Three searchable fields CPAMP keeps: the credential file (a dictionary id, like every
  -- repeated string), the response trace id and the scrubbed failure text. Nullable, no table
  -- rewrite: existing rows read NULL until an exact CPAMP reconcile pass fills them.
  ALTER TABLE events ADD COLUMN auth_file_id INTEGER;
  ALTER TABLE event_detail ADD COLUMN header_trace_id TEXT;
  ALTER TABLE event_detail ADD COLUMN fail_summary TEXT;
  -- The reconcile cursor restarts so that pass reads every CPAMP row once, with the same
  -- governed, paced chunks as any other pass. Duplicates write nothing but those NULL fields.
  UPDATE meta SET value = '0' WHERE key = 'import:cpamp:last_id';
`;
const MIGRATION_5_SQL = `
  -- Eight more searchable CPAMP fields, each a dictionary id like every repeated string:
  -- the endpoint text, the forwarded-for header, the masked source, the credential's provider
  -- and project, and the quota plan and error kind and code from the response headers.
  -- Nullable, no table rewrite: existing rows read NULL until an exact CPAMP reconcile fills them.
  ALTER TABLE events ADD COLUMN endpoint_id INTEGER;
  ALTER TABLE events ADD COLUMN x_forwarded_for_id INTEGER;
  ALTER TABLE events ADD COLUMN source_id INTEGER;
  ALTER TABLE events ADD COLUMN auth_provider_id INTEGER;
  ALTER TABLE events ADD COLUMN auth_project_id INTEGER;
  ALTER TABLE events ADD COLUMN quota_plan_id INTEGER;
  ALTER TABLE events ADD COLUMN error_kind_id INTEGER;
  ALTER TABLE events ADD COLUMN error_code_id INTEGER;
  -- The reconcile cursor restarts, as in migration 4, so that pass reads every CPAMP row once.
  UPDATE meta SET value = '0' WHERE key = 'import:cpamp:last_id';
`;
export const USAGE_MIGRATIONS: readonly string[] = [
  MIGRATION_1_SQL,
  MIGRATION_2_SQL,
  MIGRATION_3_SQL,
  MIGRATION_4_SQL,
  MIGRATION_5_SQL,
];

/** usage-raw.sqlite: a 30-day buffer for re-deriving events. Analytics never reads it. It has
 * no migrations: the file may be deleted while the service is stopped and is created again. */
export const RAW_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS payloads (
    seq INTEGER PRIMARY KEY,             -- events.seq
    ts_ms INTEGER NOT NULL,
    dropped_keys INTEGER NOT NULL,       -- payload keys outside the allowlist
    payload BLOB NOT NULL                -- gzip of the allowlisted JSON
  );
  CREATE INDEX IF NOT EXISTS payloads_ts ON payloads (ts_ms);

  -- Payloads that could not become an event. payload is NULL when the text was not a JSON
  -- object, because text that cannot be allowlisted is never stored.
  CREATE TABLE IF NOT EXISTS rejects (
    id INTEGER PRIMARY KEY,
    received_at_ms INTEGER NOT NULL,
    reason TEXT NOT NULL,
    dropped_keys INTEGER,
    payload BLOB
  );
`;
