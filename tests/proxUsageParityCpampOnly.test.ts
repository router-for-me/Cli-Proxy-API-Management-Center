import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { queryAnalytics } from '../server/usage/analytics';
import { compareResponses } from '../scripts/usage-parity/compare';
import {
  cpampOnlySearchExecutions,
  CPAMP_ONLY_SEGMENTS,
  likePattern,
  SEARCH_SEGMENTS,
} from '../scripts/usage-parity/searchCpampOnly';
import { analyticsStore, BASE, event, query, rateState } from './helpers/usageAnalytics';

let fixture: ReturnType<typeof analyticsStore>;
afterEach(() => fixture?.close());

// Two events match "alpha" in this store. CPAMP's search document also holds fields Prox never
// stores, so it additionally matches the failed "beta" event. Prox cannot match it by search.
function setup() {
  const f = (fixture = analyticsStore());
  f.insert([
    event(1, { model: 'alpha', tsMs: BASE + 1 }),
    event(2, { model: 'beta', failed: true, statusCode: 502, tsMs: BASE + 2 }),
    event(3, { model: 'beta', tsMs: BASE + 3 }),
  ]);
  const seq = f.db
    .query<{ seq: number }, [string]>('SELECT seq FROM event_detail WHERE execution_id = ?')
    .get(event(2).executionId)!.seq;
  const rates = rateState();
  const q = query({ search: 'alpha' });
  const prox = queryAnalytics(f.db, q, rates);
  const cpamp = queryAnalytics(f.db, q, rates, { cpampSearch: { alsoMatchSeqs: [seq] } });
  return { f, q, rates, seq, prox, cpamp };
}

describe('replaying a search with extra matched events', () => {
  test('only a search term opts in, and only the listed events are added', () => {
    const { f, q, rates, seq, prox, cpamp } = setup();
    expect(prox.summary.calls).toBe(1);
    expect(cpamp.summary.calls).toBe(2);
    expect(cpamp.requests.items.map((item) => item.model)).toEqual(['beta', 'alpha']);
    expect(cpamp.filter_options.models).toEqual(['alpha', 'beta']);
    // Provider, model and outcome filters still apply to the extra events.
    const success = queryAnalytics(f.db, { ...q, outcome: 'success' }, rates, {
      cpampSearch: { alsoMatchSeqs: [seq] },
    });
    expect(success.summary.calls).toBe(1);
    // Without a search term the list changes nothing.
    const plain = query();
    expect(queryAnalytics(f.db, plain, rates, { cpampSearch: { alsoMatchSeqs: [seq] } }).summary.calls).toBe(3);
    expect(() => queryAnalytics(f.db, q, rates, { cpampSearch: { alsoMatchSeqs: [1.5] } })).toThrow();
  });
});

describe('search-cpamp-only comparison rule', () => {
  test('a pair that the CPAMP-only rows explain exactly is known, field by field', () => {
    const { prox, cpamp } = setup();
    const unexplained = compareResponses(cpamp, prox);
    expect(unexplained.length).toBeGreaterThan(5);
    expect(unexplained.every((d) => d.class === 'unexplained')).toBe(true);
    const known = compareResponses(cpamp, prox, { matched: cpamp, priced: prox });
    expect(known.map((d) => d.path)).toEqual(unexplained.map((d) => d.path));
    expect(known.every((d) => d.class === 'search-cpamp-only')).toBe(true);
    // Covers the counters, both breakdown arrays, the selector lists and the request page.
    const paths = known.map((d) => d.path).join('\n');
    for (const path of [
      '$.summary.calls',
      '$.summary.failure_calls',
      '$.models[1]',
      '$.filter_options.models[1]',
      '$.requests.total_count',
      '$.requests.items[0]',
    ])
      expect(paths).toContain(path);
  });

  test('whole objects match whatever their key order, and a changed leaf inside one does not', () => {
    const { prox, cpamp } = setup();
    const reordered = structuredClone(cpamp);
    const bucket = reordered.models[1] as unknown as Record<string, unknown>;
    reordered.models[1] = Object.fromEntries(
      Object.entries(bucket).reverse()
    ) as unknown as (typeof reordered.models)[number];
    const known = compareResponses(reordered, prox, { matched: cpamp, priced: prox });
    expect(known.some((d) => d.path === '$.models[1]')).toBe(true);
    expect(known.every((d) => d.class === 'search-cpamp-only')).toBe(true);
    reordered.models[1].calls += 1;
    const open = compareResponses(reordered, prox, { matched: cpamp, priced: prox }).filter(
      (d) => d.class === 'unexplained'
    );
    expect(open.map((d) => d.path)).toEqual(['$.models[1]']);
  });

  test('a whole extra request item matches although its provider and trace id follow their own rule', () => {
    const { prox, cpamp } = setup();
    const real = structuredClone(cpamp);
    real.requests.items[1].trace_id = 'a59914ce6aa7e761-DEN';
    real.requests.items[1].provider = 'other';
    const result = compareResponses(real, prox, { matched: cpamp, priced: prox });
    expect(result.find((d) => d.path === '$.requests.items[1]')!.class).toBe('search-cpamp-only');
    // A changed leaf elsewhere in that item is a real difference.
    real.requests.items[1].latency_ms = 123456;
    expect(
      compareResponses(real, prox, { matched: cpamp, priced: prox }).find((d) => d.path === '$.requests.items[1]')!
        .class
    ).toBe('unexplained');
  });

  test('the same pair plus one real difference leaves exactly that difference unexplained', () => {
    const { prox, cpamp } = setup();
    for (const change of [
      (r: typeof cpamp) => {
        r.summary.input_tokens += 1;
      },
      (r: typeof cpamp) => {
        r.summary.calls += 1;
      },
      (r: typeof cpamp) => {
        r.timeline[0].average_latency_ms = 123456;
      },
      (r: typeof cpamp) => {
        r.requests.items[1].model = 'something-else';
      },
      (r: typeof cpamp) => {
        r.coverage.raw_complete = !r.coverage.raw_complete;
      },
    ]) {
      const real = structuredClone(cpamp);
      change(real);
      const result = compareResponses(real, prox, { matched: cpamp, priced: prox });
      const open = result.filter((d) => d.class === 'unexplained');
      expect(open.length).toBeGreaterThan(0);
      expect(open.length).toBeLessThan(result.length);
    }
  });

  test('a Prox value that its own plain replay does not predict is never excused', () => {
    const { prox, cpamp } = setup();
    // Prox's served response drifted from what Prox itself computes for the query.
    const served = structuredClone(prox);
    served.summary.input_tokens += 1;
    served.models[0].calls += 1;
    const result = compareResponses(cpamp, served, { matched: cpamp, priced: prox });
    const open = result.filter((d) => d.class === 'unexplained').map((d) => d.path);
    expect(open).toEqual(['$.summary.input_tokens', '$.models[0].calls']);
    // Without the independent plain replay nothing can be proved.
    expect(
      compareResponses(cpamp, prox, { matched: cpamp }).every((d) => d.class === 'unexplained')
    ).toBe(true);
  });

  test('a replay that does not reproduce CPAMP value for value explains nothing', () => {
    const { prox, cpamp } = setup();
    const replay = structuredClone(cpamp);
    replay.summary.calls = 5;
    const result = compareResponses(cpamp, prox, { matched: replay, priced: prox });
    expect(result.find((d) => d.path === '$.summary.calls')!.class).toBe('unexplained');
    expect(result.find((d) => d.path === '$.summary.failure_calls')!.class).toBe(
      'search-cpamp-only'
    );
    // And a witness for an unrelated response proves nothing about this one.
    expect(
      compareResponses(cpamp, prox, { matched: prox, priced: prox }).every((d) => d.class === 'unexplained')
    ).toBe(true);
  });
});

describe('the LIKE emulation', () => {
  test('agrees with SQLite on wildcards, case, escapes, separators and non-ASCII text', () => {
    const db = new Database(':memory:');
    const like = db.query<{ m: number }, [string, string]>('SELECT ? LIKE ? AS m');
    const texts = ['abc', 'a\x1fb', 'a.b', 'aXb', '100% sure', 'claude/v1', 'Ünï ünï', 'a(b)[c]{d}|^$+*?', '', 'ab\nc'];
    const patterns = ['%a_b%', '%a.b%', '%100%%', '%/v1%', '%ünï%', '%(b)[c]{d}|^$+*?%', '%x%', '%_%', '%a\\b%', '%b\nc%', '%a-b%'];
    for (const text of texts.map((t) => t.replace(/\\x1f/g, '\x1f')))
      for (const pattern of patterns)
        expect(likePattern(pattern).test(text), `${JSON.stringify(text)} ${pattern}`).toBe(
          !!like.get(text, pattern)!.m
        );
  });
});

describe('CPAMP events that only CPAMP can match', () => {
  const separator = '\x1f';
  const names = new Map(
    [...CPAMP_ONLY_SEGMENTS].map(([index, name]) => [name, index] as const)
  );
  function cpampDatabase(
    rows: { id: number; ts: number; text: string; raw?: string }[]
  ) {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE usage_events (id INTEGER PRIMARY KEY, raw_json TEXT);
      CREATE TABLE usage_monitoring_event_projection_v1 (event_id INTEGER PRIMARY KEY,
        timestamp_ms INTEGER NOT NULL, search_text TEXT NOT NULL);`);
    for (const row of rows) {
      db.query('INSERT INTO usage_events VALUES (?, ?)').run(
        row.id,
        row.raw ?? JSON.stringify({ execution_id: `execution-${row.id}` })
      );
      db.query('INSERT INTO usage_monitoring_event_projection_v1 VALUES (?, ?, ?)').run(
        row.id,
        row.ts,
        row.text
      );
    }
    return db;
  }
  // 29 segments; `fields` sets them by index or by the name of a CPAMP-only field.
  const document = (fields: Record<string, string>) =>
    Array.from({ length: SEARCH_SEGMENTS }, (_, i) => {
      for (const [key, value] of Object.entries(fields))
        if (key === String(i) || names.get(key) === i) return value;
      return '';
    }).join(separator);
  const range = { from_ms: 1000, to_ms: 2000 };

  test('the unsearchable fields are a closed, explicit list: the three internal hashes', () => {
    expect([...CPAMP_ONLY_SEGMENTS.values()]).toEqual(['event_hash', 'source_hash', 'api_key_hash']);
    expect([...CPAMP_ONLY_SEGMENTS.keys()]).toEqual([1, 13, 14]);
  });

  test('lists events matched only through the event hash, within the range', () => {
    const db = cpampDatabase([
      { id: 1, ts: 1500, text: document({ event_hash: '9f2cancel1' }) },
      { id: 2, ts: 1500, text: document({ event_hash: '9f2cancel2', 2: 'canceled-model' }) },
      // The failure text, response trace id and credential file are searchable in Prox now.
      { id: 3, ts: 1500, text: document({ fail_summary: 'context canceled' }) },
      { id: 4, ts: 1500, text: document({ header_trace_id: 'a59914cancel-den' }) },
      { id: 5, ts: 1500, text: document({ auth_file_snapshot: 'cancel-user.json' }) },
      { id: 6, ts: 1500, text: document({ event_hash: 'other-hash' }) },
      { id: 7, ts: 999, text: document({ event_hash: '9f2cancel7' }) },
      { id: 8, ts: 2000, text: document({ event_hash: '9f2cancel8' }) },
    ]);
    // Event 2 also matches in a stored model field, so Prox matches it too.
    expect(cpampOnlySearchExecutions(db, { ...range, search: 'Cancel' })).toEqual(['execution-1']);
    expect(cpampOnlySearchExecutions(db, { ...range, search: 'nothing' })).toEqual([]);
    expect(cpampOnlySearchExecutions(db, { ...range, search: '  ' })).toEqual([]);
    // LIKE wildcards behave as they do in CPAMP's own query.
    expect(cpampOnlySearchExecutions(db, { ...range, search: '9f2c_ncel1' })).toEqual([
      'execution-1',
    ]);
    expect(cpampOnlySearchExecutions(db, { ...range, search: '9f2c%1' })).toEqual(['execution-1']);
  });

  test('a wildcard never bridges two fields: CPAMP matches one field at a time', () => {
    const db = cpampDatabase([
      // "a_b" would match "...a" + separator + "b...", but CPAMP does not match across fields.
      { id: 1, ts: 1500, text: document({ 2: 'claude-opus-a', 3: 'b-model' }) },
      // A CPAMP-only field matches on its own and no stored field does: claimed.
      { id: 2, ts: 1500, text: document({ event_hash: 'a-b' }) },
      // The same plus a stored field that matches: Prox must match it, so not claimed.
      { id: 3, ts: 1500, text: document({ event_hash: 'a-b', 5: 'a-b' }) },
      // A stored field the failure text now lives in: Prox must match it, so not claimed.
      { id: 5, ts: 1500, text: document({ fail_summary: 'a-b' }) },
      // Stored fields match on their own.
      { id: 4, ts: 1500, text: document({ 2: 'axb' }) },
    ]);
    expect(cpampOnlySearchExecutions(db, { ...range, search: 'a_b' })).toEqual(['execution-2']);
  });

  test('a stored field that matches is never claimed, so a Prox miss there stays a failure', () => {
    // Event 1 matches through `endpoint` (segment 6), which Prox also has as method and path,
    // and event 2 through a model. If Prox failed to return either, no replay would add it.
    const db = cpampDatabase([
      { id: 1, ts: 1500, text: document({ 6: 'post /v1/needle' }) },
      { id: 2, ts: 1500, text: document({ 2: 'needle-model', event_hash: 'needle' }) },
    ]);
    expect(cpampOnlySearchExecutions(db, { ...range, search: 'needle' })).toEqual([]);
  });

  test('claims nothing when the document layout or an execution ID is unexpected', () => {
    const odd = cpampDatabase([{ id: 1, ts: 1500, text: 'too\x1fshort context canceled' }]);
    expect(cpampOnlySearchExecutions(odd, { ...range, search: 'cancel' })).toBeNull();
    const anonymous = cpampDatabase([
      { id: 1, ts: 1500, text: document({ event_hash: 'context canceled' }), raw: '{}' },
    ]);
    expect(cpampOnlySearchExecutions(anonymous, { ...range, search: 'cancel' })).toBeNull();
  });
});
