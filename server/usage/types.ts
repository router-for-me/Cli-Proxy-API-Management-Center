// Shared shapes of the usage service. No SQLite here: the thread that owns sockets may import this.

/** Dictionary kinds of the `dim` table. One id per (kind, value). */
export const DIM_KINDS = [
  'model',
  'provider',
  'tier',
  'instance',
  'account',
  'account_label',
  'auth_index',
  'api_key',
  'user_agent',
  'client_ip',
  'path',
  'method',
  'effort',
  'executor',
  'timing',
  'auth_file',
  'endpoint',
  'x_forwarded_for',
  'source',
  'auth_provider',
  'auth_project',
  'quota_plan',
  'error_kind',
  'error_code',
] as const;
export type DimKind = (typeof DIM_KINDS)[number];

/** The one mapping from event dictionary columns to their owning dimension kind. */
export const EVENT_DIMENSIONS: Record<string, DimKind> = {
  instance_id: 'instance',
  provider_id: 'provider',
  model_id: 'model',
  requested_model_id: 'model',
  billing_model_id: 'model',
  response_model_id: 'model',
  tier_id: 'tier',
  timing_id: 'timing',
  account_id: 'account',
  account_label_id: 'account_label',
  api_key_id: 'api_key',
  user_agent_id: 'user_agent',
  client_ip_id: 'client_ip',
  path_id: 'path',
  method_id: 'method',
  effort_id: 'effort',
  executor_id: 'executor',
  requested_tier_id: 'tier',
  effective_tier_id: 'tier',
  auth_index_id: 'auth_index',
  auth_file_id: 'auth_file',
  endpoint_id: 'endpoint',
  x_forwarded_for_id: 'x_forwarded_for',
  source_id: 'source',
  auth_provider_id: 'auth_provider',
  auth_project_id: 'auth_project',
  quota_plan_id: 'quota_plan',
  error_kind_id: 'error_kind',
  error_code_id: 'error_code',
};

/** Providers whose records the normalizer was checked against. Others are stored as reported. */
export const KNOWN_PROVIDERS: readonly string[] = ['claude', 'codex'];

/** `events.usage_flags`. A set component bit means the proxy observed that counter. */
export const USAGE_FLAG = {
  presenceReported: 1 << 0,
  inputTokens: 1 << 1,
  outputTokens: 1 << 2,
  reasoningTokens: 1 << 3,
  cacheReadTokens: 1 << 4,
  cacheCreationTokens: 1 << 5,
  totalTokens: 1 << 6,
  /** The token columns come from a complete canonical breakdown. Clear: raw counters, partial. */
  breakdownComplete: 1 << 7,
  /** The payload carried a `usage_fields` object, so "all false" differs from "absent". */
  fieldsPresent: 1 << 8,
} as const;

/** `events.record_kind`. */
export const RECORD_KIND = { unknown: 0, execution: 1, supplementary: 2 } as const;
export type RecordKindCode = (typeof RECORD_KIND)[keyof typeof RECORD_KIND];

/** `events.ingest`: how the record reached the store. */
export const INGEST = { subscribed: 0, drained: 1, imported: 2, replayed: 3 } as const;
export type IngestSource = (typeof INGEST)[keyof typeof INGEST];

/** `ttft_method` as the proxy reports it; anything else is `unknown`. */
export const TIMING_METHODS = [
  'substantive-content',
  'first-byte',
  'fallback-packet',
  'unavailable',
] as const;
export type TimingMethod = (typeof TIMING_METHODS)[number] | 'unknown';

/**
 * Token columns of one event. With `USAGE_FLAG.breakdownComplete` set:
 * inputTotal = inputUncached + cacheRead + cacheWrite, outputTotal includes reasoning, and
 * total = inputTotal + outputTotal. With it clear live events hold the proxy's raw counters
 * (inputTotal and inputUncached both hold reported input); imported events preserve CPAMP's
 * persisted accounting. Those identities are not guaranteed and pricing remains partial.
 */
export interface EventTokens {
  inputTotal: number;
  inputUncached: number;
  cacheRead: number;
  cacheWrite: number;
  outputTotal: number;
  reasoning: number;
  total: number;
}

/** Offsets from the proxy's execution start. Present only when the payload's timing validated. */
export interface EventTiming {
  upstreamStartMs: number | null;
  firstResponseMs: number | null;
  firstContentMs: number | null;
  recordedMs: number | null;
}

/** A session as the proxy reports it: always a canonical UUID. */
export interface EventSession {
  uuid: string;
  /** Version 8: derived by the proxy (from context or a hash of the first messages), not sent
   * by a client. Derived sessions can merge unrelated conversations that start alike. */
  derived: boolean;
}

/** One usage record after normalization: strings are still strings, the store interns them. */
export interface NormalizedEvent {
  /** The event's identity. */
  executionId: string;
  /** Request start as reported by the proxy, truncated to milliseconds. */
  tsMs: number;
  instance: string | null;
  provider: string;
  /** Requested model with a reasoning suffix such as "(high)" removed. */
  model: string;
  requestedModel: string;
  /** Resolved upstream model, else `model`. */
  billingModel: string;
  responseModel: string | null;
  /** Tier used for pricing. Empty when the proxy reported none. */
  tier: string;
  requestedTier: string | null;
  effectiveTier: string | null;
  failed: boolean;
  statusCode: number | null;
  /** Positive measurements only. */
  latencyMs: number | null;
  /** Null when unreported for the timing method. */
  ttftMs: number | null;
  timingMethod: TimingMethod;
  tokens: EventTokens;
  usageFlags: number;
  recordKind: RecordKindCode;
  stream: boolean | null;
  /** The proxy's index of the credential that served the request; the key that joins to quota. */
  authIndex: string | null;
  /** Grouping identity of the credential: its label when known, else the proxy's auth index. */
  account: string | null;
  accountLabel: string | null;
  /** SHA-256 hex of the trimmed client key. The key itself never leaves the normalizer. */
  apiKeyHash: string | null;
  userAgent: string | null;
  clientIp: string | null;
  /** Without its query string. */
  path: string | null;
  method: string | null;
  effort: string | null;
  executor: string | null;
  requestId: string | null;
  parentExecutionId: string | null;
  session: EventSession | null;
  /** Never the session itself, and null without a session. */
  parentSession: EventSession | null;
  traceId: string | null;
  timing: EventTiming | null;
  /** The scrubbed, capped failure text (CPAMP `fail_summary`); null without a failure body. */
  failSummary: string | null;
  /** The trace id from the response headers (CPAMP `header_trace_id`), not the proxy's `trace_id`. */
  headerTraceId: string | null;
  /** The credential file that served the request, as the listing named it (CPAMP `auth_file_snapshot`). */
  authFile: string | null;
  // The CPAMP search columns below are stored as dictionary ids and only searched.
  /** CPAMP `endpoint`: the proxy's "METHOD /route" text, without a query string; "-" when absent. */
  endpoint: string;
  /** CPAMP `x_forwarded_for`: the request header value, one printable line. */
  xForwardedFor: string | null;
  /** CPAMP `source`: the credential's account identifier, masked as CPAMP masks it. Never raw. */
  source: string | null;
  /** CPAMP `auth_provider_snapshot`: the listing's provider for the credential. */
  authProvider: string | null;
  /** CPAMP `auth_project_id_snapshot`: the listing's project id, unless it is a Codex account marker. */
  authProject: string | null;
  /** CPAMP `header_quota_plan_type`: the x-codex-plan-type response header. */
  quotaPlan: string | null;
  /** CPAMP `header_error_kind` and `header_error_code`: classified from the response headers. */
  errorKind: string | null;
  errorCode: string | null;
}

/** The label of a credential in force at ingestion, from the proxy's credential listing. */
export interface AccountLabel {
  account: string;
  label: string;
  /** The listing's file name for the credential; absent when the listing has none. */
  file?: string;
  /** The listing's provider (CPAMP's normalized form) and project id; absent when it has none. */
  provider?: string;
  project?: string;
}
export type AccountLabelLookup = (authIndex: string) => AccountLabel | undefined;

/** The payload with secrets removed and unknown keys dropped, ready for the raw buffer. */
export interface SanitizedPayload {
  json: string;
  /** Keys outside the allowlist, at any depth, that were dropped. */
  droppedKeys: number;
}

export type RejectReason =
  'not-json' | 'not-an-object' | 'missing-execution-id' | 'invalid-timestamp';

export type NormalizeResult =
  | { kind: 'event'; event: NormalizedEvent; raw: SanitizedPayload }
  | { kind: 'control'; control: 'refresh' | 'support-refresh' }
  /** `raw` is null when the text was not a JSON object and so could not be allowlisted. */
  | { kind: 'rejected'; reason: RejectReason; raw: SanitizedPayload | null };

/** What the writer inserts: a normalized event and, for live records, its sanitized payload. */
export interface IngestItem {
  event: NormalizedEvent;
  raw: SanitizedPayload | null;
}

export interface InsertResult {
  inserted: number;
  /** Events whose `execution_id` was already stored; nothing was written for them. */
  duplicates: number;
}
