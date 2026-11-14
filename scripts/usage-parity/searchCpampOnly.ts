// Evidence for the search-cpamp-only rule: which CPAMP events match a search term only through
// the fields that Prox does not store (the three internal hashes). CPAMP keeps one search document per event (fields joined by
// char(31)); a term without wildcards is in the document exactly when it is in one field, and a
// term with `%` or `_` is matched field by field (usageevent/analytics.go, and usagemonitoring
// filter.go, which exclude "%_\x1f" from the document path), so a wildcard never bridges two
// fields. Read-only; the CPAMP handle comes from openParityReader.
import type { Database } from 'bun:sqlite';
import type { UsageAnalyticsQuery } from '../../server/usage/validate';

/**
 * CPAMP's search document is the lowercase fields of usageprojection.SearchColumns joined by
 * char(31), commit 52b12b45 of CPA-Manager-Plus. A document of any other shape is not
 * understood, so no event is ever claimed from it.
 */
export const SEARCH_SEGMENTS = 29;
/**
 * Fields in that document that Prox does not store: the three internal hashes CPAMP derives
 * itself, the event hash (1), the source hash (13) and the API key hash (14). Every other field
 * has a stored, searchable counterpart, so a match there that Prox misses stays a failure.
 * (Prox does keep the API key hash, as the `api_key` dictionary value, and searches it; the
 * entry only means a difference there would not be a failure of a missing field.)
 */
export const CPAMP_ONLY_SEGMENTS: ReadonlyMap<number, string> = new Map([
  [1, 'event_hash'],
  [13, 'source_hash'],
  [14, 'api_key_hash'],
]);

/** SQLite's LIKE without ESCAPE: `%` any run, `_` one character, everything else literal. */
export function likePattern(pattern: string): RegExp {
  let source = '';
  for (const char of pattern)
    source +=
      char === '%'
        ? '[^]*'
        : char === '_'
          ? '[^]'
          : /[a-z]/i.test(char) // ASCII only, as SQLite folds it; ü and Ü stay different
            ? `[${char.toLowerCase()}${char.toUpperCase()}]`
            : char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  return new RegExp(`^${source}$`, 'u');
}
interface Candidate {
  id: number;
  text: string;
}
// One read of CPAMP per range serves every term and filter combination of the matrix.
const ranges = new WeakMap<Database, Map<string, Candidate[]>>();
export function documents(cpamp: Database, from: number, to: number): Candidate[] {
  const cache = ranges.get(cpamp) ?? new Map<string, Candidate[]>();
  ranges.set(cpamp, cache);
  const key = `${from}:${to}`;
  let rows = cache.get(key);
  if (!rows) {
    rows = cpamp
      .query<Candidate, [number, number]>(
        `SELECT event_id AS id, search_text AS text FROM usage_monitoring_event_projection_v1
         WHERE timestamp_ms >= ? AND timestamp_ms < ? ORDER BY event_id`
      )
      .all(from, to);
    cache.set(key, rows);
  }
  return rows;
}
const identities = new WeakMap<Database, Map<number, string>>();
/**
 * Execution IDs of the events in [from_ms, to_ms) that CPAMP matches through a field of the
 * closed CPAMP-only list while none of the fields Prox can search matches the term. Returns null
 * when the proof is not available: an unexpected document layout or an event without an
 * execution ID.
 */
export function cpampOnlySearchExecutions(
  cpamp: Database,
  q: Pick<UsageAnalyticsQuery, 'from_ms' | 'to_ms' | 'search'>
): string[] | null {
  const term = q.search?.trim().toLowerCase();
  if (!term) return [];
  const pattern = likePattern(`%${term}%`);
  const only: number[] = [];
  for (const row of documents(cpamp, q.from_ms, q.to_ms)) {
    const segments = row.text.split('\x1f');
    if (segments.length !== SEARCH_SEGMENTS) return null;
    // CPAMP matches a single field. Claim the event when only the CPAMP-only ones match.
    if (!segments.some((segment) => pattern.test(segment))) continue;
    if (!segments.some((segment, i) => !CPAMP_ONLY_SEGMENTS.has(i) && pattern.test(segment)))
      only.push(row.id);
  }
  const cache = identities.get(cpamp) ?? new Map<number, string>();
  identities.set(cpamp, cache);
  const identity = cpamp.query<{ execution_id: unknown }, [number]>(
    `SELECT json_extract(CASE WHEN json_valid(raw_json) THEN raw_json ELSE '{}' END,
       '$.execution_id') AS execution_id FROM usage_events WHERE id = ?`
  );
  const executions: string[] = [];
  for (const id of only) {
    let execution = cache.get(id);
    if (execution === undefined) {
      const value = identity.get(id)?.execution_id;
      if (typeof value !== 'string' || !value.trim()) return null;
      execution = value.trim();
      cache.set(id, execution);
    }
    executions.push(execution);
  }
  return executions;
}
