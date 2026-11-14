// Range-bounded filtering and the allowlisted request inspector projection.
import type { Database } from 'bun:sqlite';
import type { AnalyticsRequest } from '../../src/domain/analytics/types';
import { sanitizeCredentialText } from './credentialText';
import { estimateRequestCost } from './pricing';
import { analyticsModel, failSummaryFromBody, scrubTraceId } from './normalize';
import type { RateBook } from './rates';
import { RECORD_KIND, USAGE_FLAG, type EventTokens, type RecordKindCode } from './types';
import type { UsageAnalyticsQuery } from './validate';

export interface Dimension {
  id: number;
  kind: string;
  value: string;
}
export interface QueryFilter {
  sql: string;
  args: (number | string)[];
}
const SEARCH_DIMS = [
  'model_id',
  'requested_model_id',
  'billing_model_id',
  'response_model_id',
  'account_id',
  'account_label_id',
  'auth_index_id',
  'provider_id',
  'api_key_id',
  'user_agent_id',
  'client_ip_id',
  'path_id',
  'method_id',
  'tier_id',
  'requested_tier_id',
  'effective_tier_id',
  'effort_id',
  'executor_id',
  'auth_file_id',
  // CPAMP's endpoint, forwarded-for, source, credential provider and project, quota plan and
  // header error kind and code. Dictionary ids like the rest, so a term costs one integer test.
  'endpoint_id',
  'x_forwarded_for_id',
  'source_id',
  'auth_provider_id',
  'auth_project_id',
  'quota_plan_id',
  'error_kind_id',
  'error_code_id',
];
/** Fields CPAMP's search document holds that Prox keeps as event_detail text. */
const DOCUMENT_TEXT = ['header_trace_id', 'fail_summary'];
const SEARCH_IDS = [
  'execution_id',
  'request_id',
  'session_id',
  'parent_session_id',
  'trace_id',
  ...DOCUMENT_TEXT,
];
/** Parity replay only: the identifiers CPAMP's search document holds. It has none of the others. */
const CPAMP_SEARCH_IDS = ['request_id', ...DOCUMENT_TEXT];
/** Parity replay only: search as CPAMP's document does, plus the events its document alone matches. */
export interface CpampSearchReplay {
  alsoMatchSeqs: readonly number[];
}

export function queryFilter(
  db: Database,
  q: UsageAnalyticsQuery,
  dims: readonly Dimension[],
  selectors = false,
  replay?: CpampSearchReplay
): QueryFilter {
  const conditions = [
    'e.ts_ms >= ?',
    'e.ts_ms < ?',
    `e.record_kind != ${RECORD_KIND.supplementary}`,
  ];
  const args: (number | string)[] = [q.from_ms, q.to_ms];
  if (!selectors) {
    const provider = q.provider?.trim().toLowerCase();
    if (provider) {
      const ids = dims
        .filter((d) => d.kind === 'provider' && d.value.toLowerCase() === provider)
        .map((d) => d.id);
      conditions.push(`e.provider_id IN (${ids.join(',') || 'NULL'})`);
    }
    if (q.model?.trim()) {
      // The filter uses the same canonical reasoning-suffix rule as the normalizer.
      const model = analyticsModel(q.model.trim());
      conditions.push("e.model_id IN (SELECT id FROM dim WHERE kind = 'model' AND value = ?)");
      args.push(model);
    }
    if (q.outcome !== 'all') conditions.push(`e.failed = ${q.outcome === 'failed' ? 1 : 0}`);
  }
  const term = q.search?.trim().toLowerCase();
  if (term) {
    // Match CPAMP's SQL LIKE semantics, including % and _ wildcards and ASCII SQL lower().
    const matching = db
      .query<{ id: number }, [string]>('SELECT id FROM dim WHERE lower(value) LIKE ?')
      .all(`%${term}%`)
      .map((row) => row.id);
    const clauses = SEARCH_DIMS.map((column) => `e.${column} IN (${matching.join(',') || 'NULL'})`);
    // Long identifiers try indexed exact lookups first, but substring matches remain included.
    // Every detail lookup is joined from events inside the requested range; no global detail scan.
    if (term.length >= 16) {
      if (!replay) {
        clauses.push(
          `e.seq IN (SELECT seq FROM event_detail WHERE execution_id = ? AND ts_ms >= ? AND ts_ms < ?)`
        );
        args.push(term, q.from_ms, q.to_ms);
      }
      clauses.push(
        `e.seq IN (SELECT seq FROM event_detail WHERE request_id = ? AND ts_ms >= ? AND ts_ms < ?)`
      );
      args.push(term, q.from_ms, q.to_ms);
      if (!replay) {
        clauses.push('e.session_id IN (SELECT id FROM session WHERE uuid = ?)');
        args.push(term);
      }
    }
    if (replay?.alsoMatchSeqs.length) {
      if (!replay.alsoMatchSeqs.every(Number.isSafeInteger))
        throw new Error('Invalid event sequence');
      clauses.push(`e.seq IN (${replay.alsoMatchSeqs.join(',')})`);
    }
    clauses.push(
      // LIKE already folds ASCII case and the term is lowercased, so the newer text columns skip
      // lower(): it would copy up to 4 KB of failure text per event of the range, and NULL
      // simply does not match.
      `EXISTS (SELECT 1 FROM event_detail sd WHERE sd.seq = e.seq AND (${(replay ? CPAMP_SEARCH_IDS : SEARCH_IDS).map((key) => (DOCUMENT_TEXT.includes(key) ? `sd.${key} LIKE ?` : `lower(coalesce(sd.${key}, '')) LIKE ?`)).join(' OR ')}))`
    );
    args.push(...(replay ? CPAMP_SEARCH_IDS : SEARCH_IDS).map(() => `%${term}%`));
    conditions.push(`(${clauses.join(' OR ')})`);
  }
  return { sql: conditions.join(' AND '), args };
}
export interface TokenRow {
  input_total: number;
  input_uncached: number;
  cache_read: number;
  cache_write: number;
  output_total: number;
  reasoning: number;
  total: number;
}
export function eventTokens(row: TokenRow): EventTokens {
  return {
    inputTotal: row.input_total,
    inputUncached: row.input_uncached,
    cacheRead: row.cache_read,
    cacheWrite: row.cache_write,
    outputTotal: row.output_total,
    reasoning: row.reasoning,
    total: row.total,
  };
}
interface RequestRow extends TokenRow {
  [key: string]: number | string | null;
  seq: number;
  ts_ms: number;
  model_id: number;
  billing_model_id: number;
  requested_model_id: number;
  provider_id: number;
  tier_id: number;
  usage_flags: number;
  record_kind: RecordKindCode;
  execution_id: string;
  latency_ms: number | null;
  ttft_ms: number | null;
}
export function requestPage(
  db: Database,
  q: UsageAnalyticsQuery,
  filter: QueryFilter,
  dims: Map<number, string>,
  book: RateBook
) {
  const args = [...filter.args];
  let cursor = '';
  if (q.before_ms !== undefined) {
    cursor = ' AND (e.ts_ms, e.seq) < (?, ?)';
    args.push(q.before_ms, q.before_id!);
  }
  args.push((q.limit ?? 100) + 1);
  const rows = db
    .query<RequestRow, (string | number)[]>(
      `SELECT e.*, d.* FROM events e JOIN event_detail d ON d.seq = e.seq WHERE ${filter.sql}${cursor} ORDER BY e.ts_ms DESC, e.seq DESC LIMIT ?`
    )
    .all(...args);
  const hasMore = rows.length > (q.limit ?? 100);
  if (hasMore) rows.pop();
  const items = rows.map((row): AnalyticsRequest => {
    const dim = (key: string) => dims.get(Number(row[key])) ?? '';
    const flags = row.usage_flags;
    const reported = !!(flags & USAGE_FLAG.presenceReported);
    const measured = (value: number, bit: number) =>
      value > 0 || (reported && (flags & bit) === bit) ? value : null;
    const tokens = eventTokens(row);
    const cost = estimateRequestCost(
      {
        model: dim('model_id'),
        billingModel: dim('billing_model_id'),
        requestedModel: dim('requested_model_id'),
        tier: dim('tier_id'),
        tokens,
        usageFlags: flags,
        recordKind: row.record_kind,
      },
      book
    );
    const result: AnalyticsRequest = {
      id: String(row.seq),
      timestamp_ms: row.ts_ms,
      provider: dim('provider_id'),
      model: dim('model_id'),
      execution_id: row.execution_id,
      failed: !!row.failed,
      input_tokens: measured(tokens.inputTotal, USAGE_FLAG.inputTokens),
      output_tokens: measured(tokens.outputTotal, USAGE_FLAG.outputTokens),
      cache_read_tokens: measured(tokens.cacheRead, USAGE_FLAG.cacheReadTokens),
      cache_creation_tokens: measured(tokens.cacheWrite, USAGE_FLAG.cacheCreationTokens),
      reasoning_tokens: measured(tokens.reasoning, USAGE_FLAG.reasoningTokens),
      total_tokens: measured(tokens.total, USAGE_FLAG.totalTokens),
      uncached_input_tokens: measured(
        tokens.inputUncached,
        USAGE_FLAG.inputTokens | USAGE_FLAG.cacheReadTokens | USAGE_FLAG.cacheCreationTokens
      ),
      latency_ms: row.latency_ms,
      ttft_ms: row.ttft_ms,
      output_tokens_per_second:
        row.latency_ms &&
        row.latency_ms > 0 &&
        measured(tokens.outputTotal, USAGE_FLAG.outputTokens) !== null
          ? (tokens.outputTotal * 1000) / row.latency_ms
          : null,
      timing_method: dim('timing_id') || 'unknown',
      cost,
      usage_presence: reported ? 'reported' : 'unknown',
      usage_fields:
        flags & USAGE_FLAG.fieldsPresent
          ? {
              input_tokens: !!(flags & USAGE_FLAG.inputTokens),
              output_tokens: !!(flags & USAGE_FLAG.outputTokens),
              cache_read_tokens: !!(flags & USAGE_FLAG.cacheReadTokens),
              cache_creation_tokens: !!(flags & USAGE_FLAG.cacheCreationTokens),
              reasoning_tokens: !!(flags & USAGE_FLAG.reasoningTokens),
              total_tokens: !!(flags & USAGE_FLAG.totalTokens),
            }
          : null,
      record_kind:
        row.record_kind === RECORD_KIND.execution
          ? 'execution'
          : row.record_kind === RECORD_KIND.supplementary
            ? 'supplementary'
            : 'unknown',
      timing: ['upstream_start_ms', 'first_response_ms', 'first_content_ms', 'recorded_ms'].some(
        (key) => row[key] !== null
      )
        ? {
            origin: 'execution-start',
            upstream_start_ms: row.upstream_start_ms as number | null,
            first_response_ms: row.first_response_ms as number | null,
            first_content_ms: row.first_content_ms as number | null,
            recorded_ms: row.recorded_ms as number | null,
          }
        : null,
    };
    const optionalDims = {
      instance_id: 'instance_id',
      requested_model: 'requested_model_id',
      resolved_model: 'billing_model_id',
      response_model: 'response_model_id',
      method: 'method_id',
      path: 'path_id',
      service_tier: 'tier_id',
      requested_service_tier: 'requested_tier_id',
      effective_service_tier: 'effective_tier_id',
      reasoning_effort: 'effort_id',
      executor_type: 'executor_id',
      client_ip: 'client_ip_id',
      user_agent: 'user_agent_id',
      account_label: 'account_label_id',
      auth_file_snapshot: 'auth_file_id',
    } as const;
    for (const [key, column] of Object.entries(optionalDims)) {
      let value = dim(column);
      if (key === 'path') value = value.split('?')[0];
      if (key === 'user_agent') value = sanitizeCredentialText(value);
      if (value) Object.assign(result, { [key]: value });
    }
    for (const key of [
      'request_id',
      'parent_execution_id',
      'session_id',
      'parent_session_id',
      'trace_id',
    ] as const)
      if (row[key]) result[key] = String(row[key]);
    // The stored text is already scrubbed and capped; the same helpers again keep a stored leak
    // from being served and keep the served value within the cap.
    const headerTrace = row.header_trace_id ? scrubTraceId(String(row.header_trace_id)) : null;
    if (headerTrace) result.header_trace_id = headerTrace;
    const failSummary = row.fail_summary ? failSummaryFromBody(String(row.fail_summary)) : null;
    if (failSummary) result.fail_summary = failSummary;
    if (row.status_code !== null) result.status_code = Number(row.status_code);
    if (row.stream !== null) result.stream = !!row.stream;
    if (row.failed)
      result.error_summary =
        Number(row.status_code) >= 400 && Number(row.status_code) <= 599
          ? `Upstream HTTP ${row.status_code}`
          : 'Execution failed';
    return result;
  });
  const last = rows[rows.length - 1];
  return {
    items,
    has_more: hasMore,
    next_before_ms: hasMore ? last!.ts_ms : null,
    next_before_id: hasMore ? last!.seq : null,
  };
}
