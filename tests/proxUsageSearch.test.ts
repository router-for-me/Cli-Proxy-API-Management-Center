import { afterEach, expect, test } from 'bun:test';
import { queryAnalytics } from '../server/usage/analytics';
import { analyticsStore, BASE, event, query, rateState } from './helpers/usageAnalytics';

let fixture: ReturnType<typeof analyticsStore>;
afterEach(() => fixture?.close());

test('CPAMP shared-column search: literal substrings, SQL wildcards, filters and range bounds', () => {
  const f = (fixture = analyticsStore());
  f.insert([
    event(1, {
      model: 'needle-model',
      requestedModel: 'needle-model(high)',
      billingModel: 'needle-upstream',
      userAgent: 'NEEDLE-Team/1.0',
      account: "o'brien",
      accountLabel: '100% a_b ünï ÜNÏ',
      path: '/v1/chat',
      method: 'POST',
      endpoint: 'POST /v1/chat',
      tier: 'priority',
      traceId: 'trace-needle',
      clientIp: '192.0.2.10',
      requestId: 'exact-request-123456789',
      failed: true,
    }),
    event(2, {
      model: 'quiet-model',
      userAgent: 'other/1.0',
      provider: 'codex',
      account: 'quiet',
      path: '/quiet',
      method: 'GET',
      endpoint: 'GET /quiet',
      clientIp: '198.51.100.2',
      accountLabel: null,
      tier: 'standard',
      traceId: 'quiet-trace',
      requestId: 'request-other',
      session: { uuid: '0f0e0d0c-0b0a-4908-8706-050403020100', derived: false },
    }),
    event(3, { tsMs: BASE - 1, model: 'outside-needle', requestId: 'outside-request-123456789' }),
    event(4, { tsMs: BASE + 86400000, model: 'outside-needle', traceId: 'outside-trace' }),
    event(5, { recordKind: 2, model: 'supplementary-needle' }),
  ]);
  for (const term of [
    'needle',
    'NEEDLE',
    'Needle-Team',
    'ne',
    '/v1/chat',
    'post',
    "o'brien",
    'a_b',
    'ünï',
    'ÜNÏ',
    'priority',
    'trace-needle',
    '192.0.2.10',
    'exact-request-123456789',
    'request-123456',
    'execution-000000000000000000000001',
  ]) {
    const response = queryAnalytics(f.db, query({ search: term }), rateState());
    expect(response.summary.calls, term).toBe(1);
    expect(response.requests.items[0].execution_id, term).toBe(event(1).executionId);
    expect(response.filter_options.models, term).toEqual(['needle-model']);
  }
  for (const term of ['outside-needle', 'outside-request-123456789', 'nothing-matches'])
    expect(queryAnalytics(f.db, query({ search: term }), rateState()).summary.calls, term).toBe(0);
  for (const term of ['%', '_', '100%'])
    expect(queryAnalytics(f.db, query({ search: term }), rateState()).summary.calls).toBe(2);
  expect(
    queryAnalytics(f.db, query({ search: '0f0e0d0c-0b0a-4908-8706-050403020100' }), rateState())
      .summary.calls
  ).toBe(2);
  expect(
    queryAnalytics(
      f.db,
      query({
        search: 'needle',
        provider: 'CLAUDE',
        model: 'needle-model(high)',
        outcome: 'failed',
      }),
      rateState()
    ).summary.calls
  ).toBe(1);
  expect(
    queryAnalytics(f.db, query({ search: 'needle', outcome: 'success' }), rateState()).summary.calls
  ).toBe(0);
  expect(queryAnalytics(f.db, query({ provider: 'CODEX' }), rateState()).summary.calls).toBe(1);
});

test('a fallback stays under the requested model; resolved_model shows the model that served it', () => {
  const f = (fixture = analyticsStore());
  // Client asked for Fable 5.1, Opus 5 served it: billed as Opus 5 (normalize.ts).
  f.insert([
    event(1, {
      model: 'claude-fable-5-1',
      requestedModel: 'claude-fable-5-1',
      billingModel: 'claude-opus-5',
      responseModel: 'claude-opus-5',
    }),
  ]);
  for (const term of ['claude-fable-5-1', 'claude-opus-5']) {
    const response = queryAnalytics(f.db, query({ search: term }), rateState());
    expect(response.summary.calls, term).toBe(1);
    expect(
      response.models.map((row) => row.key),
      term
    ).toEqual(['claude-fable-5-1']);
    const item = response.requests.items[0] as unknown as Record<string, unknown>;
    expect(item.requested_model).toBe('claude-fable-5-1');
    expect(item.resolved_model).toBe('claude-opus-5');
  }
});
