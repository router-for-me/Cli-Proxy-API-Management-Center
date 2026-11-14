// Per-column search probe. For one window it derives one real term for each of CPAMP's 29 search
// columns, as a distinctive substring of an actual value in CPAMP's own search document, and
// compares the events CPAMP and Prox match for it. Read-only on both databases; nothing runs on
// import. A difference is explained only by a rule written down here:
//   - CPAMP matches, Prox does not: only when every field of the event that matches the term is
//     one of the CPAMP-only hashes (the replay proof, cpampOnlySearchExecutions).
//   - Prox matches, CPAMP does not: only when a Prox-only searched field (PROX_ONLY_SEARCH_DIMS)
//     of the event matches the term.
// Anything else is unexplained and fails the probe.
import type { Database } from 'bun:sqlite';
import { PROX_ONLY_SEARCH_DIMS, queryFilter } from '../../server/usage/search';
import type { UsageAnalyticsQuery } from '../../server/usage/validate';
import {
  CPAMP_ONLY_SEGMENTS,
  cpampOnlySearchExecutions,
  documents,
  likePattern,
  SEARCH_SEGMENTS,
} from './searchCpampOnly';

/** usageprojection.SearchColumns at CPAMP commit 52b12b45, in document order. */
export const SEARCH_COLUMNS = [
  'request_id',
  'event_hash',
  'model',
  'requested_model',
  'analytics_model',
  'resolved_model',
  'endpoint',
  'method',
  'path',
  'client_ip',
  'x_forwarded_for',
  'user_agent',
  'source',
  'source_hash',
  'api_key_hash',
  'auth_index',
  'account_snapshot',
  'auth_label_snapshot',
  'auth_file_snapshot',
  'auth_provider_snapshot',
  'auth_project_id_snapshot',
  'reasoning_effort',
  'service_tier',
  'executor_type',
  'fail_summary',
  'header_quota_plan_type',
  'header_error_kind',
  'header_error_code',
  'header_trace_id',
] as const;

export interface ProbeWindow {
  from_ms: number;
  to_ms: number;
}
export interface ProbeTerm {
  index: number;
  column: string;
  /** The term: a slice of one real value, lowercase, no wildcard or separator character. */
  term: string;
  /** How many events of the window hold exactly the value the term was cut from. */
  valueEvents: number;
}
export interface ColumnResult {
  index: number;
  column: string;
  /** Why no term could be derived; the other fields are then zero. */
  skipped?: string;
  term?: string;
  termLength?: number;
  cpamp: number;
  /** Prox with CPAMP's document emulated (replay), then production search for comparison. */
  prox: number;
  proxProduction: number;
  both: number;
  cpampOnlyByHash: number;
  cpampOnlyUnexplained: number;
  proxOnlyByProxOnlyField: number;
  proxOnlyUnexplained: number;
  /** CPAMP events without a usable execution id: they cannot be compared. */
  unmapped: number;
  unexplained: number;
}
export interface ProbeReport {
  window: ProbeWindow;
  events: number;
  columns: ColumnResult[];
  /** Probed columns, skipped columns and the sum of unexplained events. */
  probed: number;
  skipped: number;
  unexplained: number;
}

const MAX_TERM = 12;
const SEPARATOR = '\x1f';
const hasWildcardOrSeparator = (text: string) => /[%_]/.test(text) || text.includes(SEPARATOR);

/** The longest run of ordinary characters in the value, up to MAX_TERM of it from the middle. */
export function distinctiveSlice(value: string): string | null {
  let best = '';
  for (const run of value.split(/[%_]/).flatMap((part) => part.split(SEPARATOR)))
    if (run.length > best.length) best = run;
  const offset = Math.max(0, Math.floor((best.length - MAX_TERM) / 2));
  const slice = best.slice(offset, offset + MAX_TERM).trim();
  return slice && !hasWildcardOrSeparator(slice) ? slice : null;
}

/**
 * One term per column from the window's documents: cut from the rarest non-empty value (ties:
 * the longer, then the lexicographically first), so the term is distinctive for the column.
 */
export function deriveTerms(docs: readonly { text: string }[]): {
  terms: ProbeTerm[];
  skipped: Map<number, string>;
} {
  const counts = SEARCH_COLUMNS.map(() => new Map<string, number>());
  for (const doc of docs) {
    const segments = doc.text.split('\x1f');
    if (segments.length !== SEARCH_SEGMENTS) throw new Error('Unexpected CPAMP search document layout');
    segments.forEach((value, i) => {
      if (value) counts[i].set(value, (counts[i].get(value) ?? 0) + 1);
    });
  }
  const terms: ProbeTerm[] = [];
  const skipped = new Map<number, string>();
  counts.forEach((values, index) => {
    const ranked = [...values].sort(
      (a, b) => a[1] - b[1] || b[0].length - a[0].length || (a[0] < b[0] ? -1 : 1)
    );
    // A term of three characters or more is far more selective than "-" or "1"; take a shorter
    // one only when the column holds nothing longer.
    const candidates = ranked.flatMap(([value, valueEvents]) => {
      const term = distinctiveSlice(value);
      return term ? [{ term, valueEvents }] : [];
    });
    const pick = candidates.find((c) => c.term.length >= 3) ?? candidates[0];
    if (pick) {
      terms.push({ index, column: SEARCH_COLUMNS[index], ...pick });
      return;
    }
    skipped.set(
      index,
      values.size ? 'every value is only wildcard characters' : 'no event of the window holds a value'
    );
  });
  return { terms, skipped };
}

function proxExecutions(prox: Database, sql: string, args: (number | string)[]): Set<string> {
  return new Set(
    prox
      .query<{ x: string }, (number | string)[]>(
        `SELECT d.execution_id AS x FROM events e JOIN event_detail d ON d.seq = e.seq WHERE ${sql}`
      )
      .all(...args)
      .map((row) => row.x)
  );
}

/** Run the probe. `cpamp` and `prox` are read-only handles; the window is [from_ms, to_ms). */
export function probeSearchColumns(cpamp: Database, prox: Database, window: ProbeWindow): ProbeReport {
  const docs = documents(cpamp, window.from_ms, window.to_ms);
  const { terms, skipped } = deriveTerms(docs);
  const identity = cpamp.query<{ execution_id: unknown }, [number]>(
    `SELECT json_extract(CASE WHEN json_valid(raw_json) THEN raw_json ELSE '{}' END,
       '$.execution_id') AS execution_id FROM usage_events WHERE id = ?`
  );
  const executionOf = new Map<number, string | null>();
  const execution = (id: number): string | null => {
    if (!executionOf.has(id)) {
      const value = identity.get(id)?.execution_id;
      executionOf.set(id, typeof value === 'string' && value.trim() ? value.trim() : null);
    }
    return executionOf.get(id)!;
  };
  const segments = docs.map((doc) => ({ id: doc.id, parts: doc.text.split('\x1f') }));
  const byIndex = new Map(terms.map((term) => [term.index, term]));
  const columns: ColumnResult[] = SEARCH_COLUMNS.map((column, index): ColumnResult => {
    const blank: ColumnResult = {
      index,
      column,
      cpamp: 0,
      prox: 0,
      proxProduction: 0,
      both: 0,
      cpampOnlyByHash: 0,
      cpampOnlyUnexplained: 0,
      proxOnlyByProxOnlyField: 0,
      proxOnlyUnexplained: 0,
      unmapped: 0,
      unexplained: 0,
    };
    const probe = byIndex.get(index);
    if (!probe) return { ...blank, skipped: skipped.get(index) ?? 'no term' };
    const q = {
      from_ms: window.from_ms,
      to_ms: window.to_ms,
      outcome: 'all',
      search: probe.term,
    } as unknown as UsageAnalyticsQuery;
    const pattern = likePattern(`%${probe.term}%`);
    const cpampIds = segments.filter((doc) => doc.parts.some((part) => pattern.test(part))).map((doc) => doc.id);
    const cpampExecutions = new Set<string>();
    let unmapped = 0;
    for (const id of cpampIds) {
      const value = execution(id);
      if (value === null) unmapped += 1;
      else cpampExecutions.add(value);
    }
    const replay = queryFilter(prox, q, [], false, { alsoMatchSeqs: [] });
    const proxDoc = proxExecutions(prox, replay.sql, replay.args);
    const production = queryFilter(prox, q, [], false);
    const proxProduction = proxExecutions(prox, production.sql, production.args);

    // CPAMP matches Prox misses: the replay proof's closed list of hash fields, nothing else.
    const hashOnly = new Set(cpampOnlySearchExecutions(cpamp, q) ?? []);
    const cpampOnly = [...cpampExecutions].filter((id) => !proxDoc.has(id));
    const cpampOnlyByHash = cpampOnly.filter((id) => hashOnly.has(id)).length;
    // Prox matches CPAMP misses: only through a field Prox searches and CPAMP's document lacks.
    const matching = prox
      .query<{ id: number }, [string]>('SELECT id FROM dim WHERE lower(value) LIKE ?')
      .all(`%${probe.term}%`)
      .map((row) => row.id);
    const proxOnlyFields = proxExecutions(
      prox,
      `e.ts_ms >= ? AND e.ts_ms < ? AND (${PROX_ONLY_SEARCH_DIMS.map((c) => `e.${c} IN (${matching.join(',') || 'NULL'})`).join(' OR ')})`,
      [window.from_ms, window.to_ms]
    );
    const proxOnly = [...proxDoc].filter((id) => !cpampExecutions.has(id));
    const proxOnlyByField = proxOnly.filter((id) => proxOnlyFields.has(id)).length;
    const result: ColumnResult = {
      ...blank,
      term: probe.term,
      termLength: probe.term.length,
      cpamp: cpampExecutions.size,
      prox: proxDoc.size,
      proxProduction: proxProduction.size,
      both: cpampExecutions.size - cpampOnly.length,
      cpampOnlyByHash,
      cpampOnlyUnexplained: cpampOnly.length - cpampOnlyByHash,
      proxOnlyByProxOnlyField: proxOnlyByField,
      proxOnlyUnexplained: proxOnly.length - proxOnlyByField,
      unmapped,
    };
    result.unexplained = result.cpampOnlyUnexplained + result.proxOnlyUnexplained + unmapped;
    return result;
  });
  return {
    window,
    events: docs.length,
    columns,
    probed: columns.filter((c) => !c.skipped).length,
    skipped: columns.filter((c) => c.skipped).length,
    unexplained: columns.reduce((sum, c) => sum + c.unexplained, 0),
  };
}

/**
 * Does Prox store what CPAMP's `api_key_hash` column holds? Prox keeps the same SHA-256 of the
 * trimmed client key as the `api_key` dictionary value, so the distinct hashes of the window
 * should all be there.
 */
export function apiKeyHashParity(cpamp: Database, prox: Database, window: ProbeWindow) {
  const hashes = new Set(
    documents(cpamp, window.from_ms, window.to_ms)
      .map((doc) => doc.text.split('\x1f')[14])
      .filter(Boolean)
  );
  const find = prox.query<{ id: number }, [string]>(`SELECT id FROM dim WHERE kind = 'api_key' AND value = ?`);
  return { cpamp: hashes.size, inProx: [...hashes].filter((hash) => find.get(hash)).length };
}

/** A table for the PR and the evidence folder. Terms are real values (accounts, addresses), so
 * only their length is shown; the JSON report keeps them for the operator. */
export function probeMarkdown(report: ProbeReport): string {
  const preview = (term?: string) => (term ? `${term.length} chars` : '');
  const rows = report.columns.map((c) =>
    c.skipped
      ? `| ${c.index} | ${c.column} | not probed: ${c.skipped} | | | | | | |`
      : `| ${c.index} | ${c.column} | ${preview(c.term)} | ${c.cpamp} | ${c.prox} | ${c.both} | ${c.cpampOnlyByHash} | ${c.proxOnlyByProxOnlyField} | ${c.unexplained} |`
  );
  return [
    `Window ${new Date(report.window.from_ms).toISOString()} .. ${new Date(report.window.to_ms).toISOString()}, ${report.events} events`,
    '',
    '| # | column | term | CPAMP | Prox | both | CPAMP-only: hash | Prox-only: Prox-only field | unexplained |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `Probed ${report.probed} of ${SEARCH_COLUMNS.length} columns, ${report.skipped} not probed, **${report.unexplained} unexplained**.`,
    `Hash columns (CPAMP-only list: ${[...CPAMP_ONLY_SEGMENTS.values()].join(', ')}) are explained by the replay proof.`,
  ].join('\n');
}
