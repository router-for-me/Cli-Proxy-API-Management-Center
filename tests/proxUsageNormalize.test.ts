import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normalizeUsagePayload } from '../server/usage/normalize';
import { resolveModelPrice } from '../server/usage/pricing';
import { RECORD_KIND, USAGE_FLAG, type NormalizedEvent } from '../server/usage/types';
import { FAIL_BODY, SECRET, usagePayload } from './fixtures/usagePayloads';

function normalize(overrides: Record<string, unknown> = {}) {
  return normalizeUsagePayload(JSON.stringify(usagePayload(overrides)));
}
function event(overrides: Record<string, unknown> = {}): NormalizedEvent {
  const result = normalize(overrides);
  if (result.kind !== 'event') throw new Error(`expected an event, got ${JSON.stringify(result)}`);
  return result.event;
}
const breakdown = (overrides: Record<string, unknown>) => ({
  token_breakdown: { ...(usagePayload().token_breakdown as object), ...overrides },
});

describe('usage payload normalization: tokens', () => {
  test('a complete canonical breakdown supplies every token column', () => {
    const normalized = event();
    // The legacy counters say input 100 and output 140; the breakdown says 950 and 200.
    expect(normalized.tokens).toEqual({
      inputTotal: 950,
      inputUncached: 100,
      cacheRead: 800,
      cacheWrite: 50,
      outputTotal: 200,
      reasoning: 60,
      total: 1150,
    });
    expect(normalized.usageFlags & USAGE_FLAG.breakdownComplete).toBe(USAGE_FLAG.breakdownComplete);
  });

  test.each([
    ['accounting version 1', { accounting_version: 1 }],
    ['breakdown schema version 1', breakdown({ schema_version: 1 })],
    ['quality inconsistent', breakdown({ quality: 'inconsistent' })],
    ['unclassified tokens', breakdown({ unclassified_tokens: 5 })],
    [
      'input parts that do not add up',
      breakdown({
        input: {
          total_tokens: 951,
          uncached_tokens: 100,
          cache_read_tokens: 800,
          cache_write_tokens: 50,
        },
      }),
    ],
    [
      'output parts that do not add up',
      breakdown({ output: { total_tokens: 200, non_reasoning_tokens: 141, reasoning_tokens: 60 } }),
    ],
    ['a total that is not input plus output', breakdown({ total_tokens: 1151 })],
    [
      'a negative counter',
      breakdown({
        input: {
          total_tokens: 950,
          uncached_tokens: -100,
          cache_read_tokens: 1000,
          cache_write_tokens: 50,
        },
      }),
    ],
    ['a fractional counter', breakdown({ total_tokens: 1150.5 })],
    [
      'a missing counter',
      breakdown({ input: { total_tokens: 950, uncached_tokens: 100, cache_read_tokens: 850 } }),
    ],
    ['no breakdown', { token_breakdown: undefined }],
  ])('%s keeps the raw counters and clears the complete flag', (_name, overrides) => {
    const normalized = event(overrides);
    expect(normalized.usageFlags & USAGE_FLAG.breakdownComplete).toBe(0);
    // Reported counters, with no inference about whether input includes cache.
    expect(normalized.tokens).toEqual({
      inputTotal: 100,
      inputUncached: 100,
      cacheRead: 800,
      cacheWrite: 50,
      outputTotal: 140,
      reasoning: 60,
      total: 1150,
    });
  });

  test('an unknown provider is stored with tokens as reported, like any other', () => {
    const normalized = event({ provider: 'gemini', executor_type: 'GeminiExecutor' });
    expect(normalized.provider).toBe('gemini');
    expect(normalized.tokens).toEqual(event().tokens);
    expect(event({ provider: '  ' }).provider).toBe('unknown');
  });
});

describe('usage payload normalization: models', () => {
  test('the model is the alias when set, else the upstream model', () => {
    expect(event().model).toBe('client-claude');
    expect(event().requestedModel).toBe('client-claude');
    expect(event({ alias: '' }).model).toBe('claude-test-4');
    expect(event({ alias: '', model: '' }).model).toBe('-');
  });

  test.each([
    'none',
    'auto',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'HIGH',
    '-1',
    '0',
    '8192',
  ])('a trailing (%s) is a reasoning suffix and is removed', (suffix) => {
    const normalized = event({ alias: `client-claude(${suffix})` });
    expect(normalized.model).toBe('client-claude');
    expect(normalized.requestedModel).toBe(`client-claude(${suffix})`);
  });

  test.each([
    'client-claude(preview)',
    'client-claude(-2)',
    'client-claude(1.5)',
    '(high)',
    'client-claude(high) beta',
    'client-claude(99999999999999999999)',
  ])('%s is not a reasoning suffix and stays whole', (alias) => {
    expect(event({ alias }).model).toBe(alias);
  });

  test('the billing model is the upstream model, else the analytics model', () => {
    expect(event({ alias: 'client-claude(high)' }).billingModel).toBe('claude-test-4');
    expect(event({ alias: 'client-claude(high)', model: '' }).billingModel).toBe('client-claude');
    expect(event().responseModel).toBe('claude-test-4-20260401');
    expect(event({ response_model: undefined }).responseModel).toBeNull();
  });

  test('a fallback is billed as the model that served it; the requested model stays the model', () => {
    // A Claude server-side fallback: the client asked for Fable 5.1, Opus 5 answered (ProxD v8.0.76
    // records the served model in response_model; model and alias stay the requested one).
    const fallback = event({
      alias: 'claude-fable-5-1',
      model: 'claude-fable-5-1',
      response_model: 'claude-opus-5',
    });
    expect(fallback.model).toBe('claude-fable-5-1');
    expect(fallback.requestedModel).toBe('claude-fable-5-1');
    expect(fallback.billingModel).toBe('claude-opus-5');
    // A dated snapshot of the same model is not a different model: billing keeps the model.
    expect(event().billingModel).toBe('claude-test-4');
    expect(event({ response_model: 'claude-test-4' }).billingModel).toBe('claude-test-4');
    expect(
      event({
        alias: 'gpt-6.2-sol',
        model: 'gpt-6.2-sol',
        response_model: 'gpt-6.2-sol-2026-11-01',
      }).billingModel
    ).toBe('gpt-6.2-sol');
    expect(event({ response_model: undefined }).billingModel).toBe('claude-test-4');
  });

  test.each([
    ['claude-opus-5', 'claude-opus-5-5'],
    ['claude-opus-5-5', 'claude-opus-5'],
    ['gpt-6.2', 'gpt-6.2-sol'],
  ])(
    '%s served by %s is billed as the served model (a longer id is not a snapshot)',
    (asked, served) => {
      expect(event({ alias: asked, model: asked, response_model: served }).billingModel).toBe(
        served
      );
    }
  );

  test('with an unpriced custom alias, an unpriced served model leaves the request unpriced', () => {
    // Pinned on purpose (RULES.md): the upstream model is no longer a pricing candidate once a
    // different served model is billed, and the unpriced-model alert reports it.
    const e = event({ alias: 'my-alias', model: 'claude-test-4', response_model: 'claude-new-9' });
    const book = { models: { 'claude-test-4': {} } } as unknown as Parameters<
      typeof resolveModelPrice
    >[1];
    expect(e.billingModel).toBe('claude-new-9');
    expect(resolveModelPrice([e.billingModel, e.model, e.requestedModel], book)).toBeNull();
  });
});

describe('usage payload normalization: pricing tier', () => {
  const codex = { provider: 'codex', executor_type: 'CodexExecutor' };

  test('for Codex the requested tier wins over the response tier', () => {
    const normalized = event({
      ...codex,
      service_tier: 'priority',
      response_service_tier: 'default',
    });
    expect(normalized.tier).toBe('priority');
    expect(normalized.requestedTier).toBe('priority');
    expect(event({ ...codex, service_tier: '', response_service_tier: 'default' }).tier).toBe(
      'default'
    );
  });

  test('Codex is recognized from the executor or the auth type as well as the provider', () => {
    const tiers = { service_tier: 'priority', response_service_tier: 'default' };
    expect(event({ ...tiers, provider: 'openai', executor_type: 'CodexExecutor' }).tier).toBe(
      'priority'
    );
    expect(
      event({ ...tiers, provider: 'openai', executor_type: 'x', auth_type: 'codex-oauth' }).tier
    ).toBe('priority');
  });

  test('for other providers the response tier wins over the requested tier', () => {
    expect(event({ service_tier: 'auto', response_service_tier: 'standard' }).tier).toBe(
      'standard'
    );
    expect(event({ service_tier: 'auto', response_service_tier: '' }).tier).toBe('auto');
    expect(event({ service_tier: '', response_service_tier: '' }).tier).toBe('');
  });

  test('an explicit effective tier replaces the requested tier', () => {
    const effective = { service_tier: 'auto', effective_service_tier: 'priority' };
    const codexEvent = event({ ...codex, ...effective, response_service_tier: 'default' });
    expect(codexEvent.tier).toBe('priority');
    expect(codexEvent.requestedTier).toBe('auto');
    expect(codexEvent.effectiveTier).toBe('priority');
    // The response still wins for a provider that reports its real tier.
    expect(event({ ...effective, response_service_tier: 'standard' }).tier).toBe('standard');
    expect(event({ ...effective, response_service_tier: '' }).tier).toBe('priority');
    expect(event().effectiveTier).toBeNull();
  });
});

describe('usage payload normalization: timing', () => {
  test('latency is kept only when positive', () => {
    expect(event({ latency_ms: 1500 }).latencyMs).toBe(1500);
    expect(event({ latency_ms: 0 }).latencyMs).toBeNull();
    expect(event({ latency_ms: -4 }).latencyMs).toBeNull();
    expect(event({ latency_ms: undefined }).latencyMs).toBeNull();
  });

  test('time to first token is null when negative or when the method is unavailable', () => {
    expect(event({ ttft_ms: 420 }).ttftMs).toBe(420);
    expect(event({ ttft_ms: -1 }).ttftMs).toBeNull();
    expect(event({ ttft_ms: 420, ttft_method: 'unavailable' }).ttftMs).toBeNull();
    expect(event({ ttft_ms: undefined }).ttftMs).toBeNull();
  });

  test('a zero is kept only for a known method', () => {
    for (const method of ['substantive-content', 'first-byte', 'fallback-packet']) {
      expect(event({ ttft_ms: 0, ttft_method: method }).ttftMs).toBe(0);
    }
    expect(event({ ttft_ms: 0, ttft_method: 'guessed' }).ttftMs).toBeNull();
    expect(event({ ttft_ms: 0, ttft_method: undefined }).ttftMs).toBeNull();
    // A positive value from an unrecognized method is still a measurement.
    expect(event({ ttft_ms: 7, ttft_method: 'guessed' }).ttftMs).toBe(7);
  });

  test('the timing method is one of the four the proxy reports, else unknown', () => {
    expect(event().timingMethod).toBe('substantive-content');
    expect(event({ ttft_method: 'unavailable' }).timingMethod).toBe('unavailable');
    expect(event({ ttft_method: 'guessed' }).timingMethod).toBe('unknown');
    expect(event({ ttft_method: undefined }).timingMethod).toBe('unknown');
  });

  test('execution timing is kept when its offsets are consistent', () => {
    expect(event().timing).toEqual({
      upstreamStartMs: 12,
      firstResponseMs: 340,
      firstContentMs: 420,
      recordedMs: 1500,
    });
    // Missing and zero stay distinct.
    const sparse = {
      origin: 'execution-start',
      upstream_start_ms: 0,
      first_response_ms: 0,
      first_content_ms: null,
      recorded_ms: 5,
    };
    expect(event({ timing: sparse }).timing).toEqual({
      upstreamStartMs: 0,
      firstResponseMs: 0,
      firstContentMs: null,
      recordedMs: 5,
    });
  });

  test.each([
    ['another origin', { origin: 'request-start' }],
    ['a negative offset', { upstream_start_ms: -1 }],
    [
      'an offset beyond 31 days',
      { first_content_ms: 31 * 86_400_000 + 1, recorded_ms: 31 * 86_400_000 + 2 },
    ],
    ['an offset after the recorded time', { first_content_ms: 1501 }],
    ['a response before the upstream start', { upstream_start_ms: 400 }],
    ['content before the response', { first_content_ms: 300 }],
    ['a fractional offset', { first_response_ms: 340.5 }],
  ])('execution timing with %s is dropped whole', (_name, overrides) => {
    const timing = { ...(usagePayload().timing as object), ...overrides };
    expect(event({ timing }).timing).toBeNull();
  });

  test('the timestamp is truncated to milliseconds, never rounded', () => {
    expect(event().tsMs).toBe(Date.UTC(2026, 3, 25, 0, 0, 0, 123));
    expect(event({ timestamp: '2026-04-25T00:00:00.9999999Z' }).tsMs).toBe(
      Date.UTC(2026, 3, 25, 0, 0, 0, 999)
    );
    expect(event({ timestamp: '2026-04-25T00:00:00Z' }).tsMs).toBe(Date.UTC(2026, 3, 25));
    expect(event({ timestamp: '2026-04-25T00:00:00.5Z' }).tsMs).toBe(
      Date.UTC(2026, 3, 25, 0, 0, 0, 500)
    );
    expect(event({ timestamp: '2026-04-25T08:00:00.25+08:00' }).tsMs).toBe(
      Date.UTC(2026, 3, 25, 0, 0, 0, 250)
    );
    expect(event({ timestamp: '2026-04-24T19:30:00-04:30' }).tsMs).toBe(Date.UTC(2026, 3, 25));
  });
});

describe('usage payload normalization: presence', () => {
  test('usage presence and the reported components become flags', () => {
    const flags = event().usageFlags;
    expect(flags & USAGE_FLAG.presenceReported).toBeTruthy();
    expect(flags & USAGE_FLAG.fieldsPresent).toBeTruthy();
    expect(flags & USAGE_FLAG.inputTokens).toBeTruthy();
    expect(flags & USAGE_FLAG.outputTokens).toBeTruthy();
    expect(flags & USAGE_FLAG.cacheReadTokens).toBeTruthy();
    expect(flags & USAGE_FLAG.cacheCreationTokens).toBeTruthy();
    expect(flags & USAGE_FLAG.totalTokens).toBeTruthy();
    expect(flags & USAGE_FLAG.reasoningTokens).toBe(0);
  });

  test('each component has its own bit, in the proxy field order', () => {
    const names = [
      'input_tokens',
      'output_tokens',
      'reasoning_tokens',
      'cache_read_tokens',
      'cache_creation_tokens',
      'total_tokens',
    ];
    names.forEach((name, index) => {
      const flags = event({
        usage_presence: 'unknown',
        usage_fields: { [name]: true },
        token_breakdown: undefined,
      }).usageFlags;
      expect(flags).toBe(USAGE_FLAG.fieldsPresent | (1 << (index + 1)));
    });
  });

  test('presence is reported only by that exact word', () => {
    expect(event({ usage_presence: 'unknown' }).usageFlags & USAGE_FLAG.presenceReported).toBe(0);
    expect(event({ usage_presence: 'yes' }).usageFlags & USAGE_FLAG.presenceReported).toBe(0);
    expect(event({ usage_presence: undefined }).usageFlags & USAGE_FLAG.presenceReported).toBe(0);
  });

  test('absent usage fields differ from fields that are all false', () => {
    const absent = event({ usage_fields: null }).usageFlags;
    const allFalse = event({ usage_fields: {} }).usageFlags;
    expect(absent & USAGE_FLAG.fieldsPresent).toBe(0);
    expect(allFalse & USAGE_FLAG.fieldsPresent).toBe(USAGE_FLAG.fieldsPresent);
    // One member of the wrong type invalidates the object, as in the proxy's own reader.
    const invalid = event({
      usage_fields: { input_tokens: 'yes', output_tokens: true },
    }).usageFlags;
    expect(invalid & (USAGE_FLAG.fieldsPresent | USAGE_FLAG.outputTokens)).toBe(0);
  });

  test('the record kind is execution, supplementary or unknown', () => {
    expect(event().recordKind).toBe(RECORD_KIND.execution);
    expect(event({ record_kind: 'supplementary' }).recordKind).toBe(RECORD_KIND.supplementary);
    expect(event({ record_kind: 'unknown' }).recordKind).toBe(RECORD_KIND.unknown);
    expect(event({ record_kind: 'retry' }).recordKind).toBe(RECORD_KIND.unknown);
    expect(event({ record_kind: undefined }).recordKind).toBe(RECORD_KIND.unknown);
  });
});

describe('usage payload normalization: identity and request fields', () => {
  test('the client key is stored only as the SHA-256 of the trimmed key', () => {
    const expected = createHash('sha256').update(SECRET.apiKey).digest('hex');
    expect(event().apiKeyHash).toBe(expected);
    expect(event({ api_key: `  ${SECRET.apiKey}\n` }).apiKeyHash).toBe(expected);
    expect(event({ api_key: '' }).apiKeyHash).toBeNull();
  });

  test('no secret survives normalization, in the event or in the raw payload', () => {
    const result = normalize({
      failed: true,
      fail: { status_code: 429, body: `${FAIL_BODY} ${SECRET.failKey}`, code: 'rate_limited' },
      endpoint: `POST /v1/messages?key=${SECRET.query}`,
      brand_new_field: SECRET.unknownField,
    });
    const serialized = JSON.stringify(result);
    for (const secret of Object.values(SECRET)) expect(serialized).not.toContain(secret);
    // The failure text is kept, scrubbed, as the event's summary; the raw buffer never keeps it.
    expect(serialized.split(FAIL_BODY)).toHaveLength(2);
    if (result.kind !== 'event') throw new Error('expected an event');
    expect(result.event.failSummary).toBe(`${FAIL_BODY} [redacted]`);
    expect(result.raw.json).not.toContain(FAIL_BODY);
    expect(result.event.statusCode).toBe(429);
    expect(result.event.failed).toBe(true);
    expect(result.event.path).toBe('/v1/messages');
    const raw = JSON.parse(result.raw.json);
    expect(raw.fail).toEqual({ status_code: 429, code: 'rate_limited' });
    expect(raw.endpoint).toBe('POST /v1/messages');
    expect(raw.execution_id).toBe(result.event.executionId);
    expect(raw.token_breakdown).toEqual(usagePayload().token_breakdown);
  });

  test('keys outside the allowlist are dropped and counted, at any depth', () => {
    const result = normalize({
      brand_new_field: 1,
      tokens: { ...(usagePayload().tokens as object), brand_new_counter: 9 },
      user_agent: { nested: 'object where a string belongs' },
      constructor: 'not an allowlisted key',
    });
    if (result.kind !== 'event') throw new Error('expected an event');
    expect(result.raw.droppedKeys).toBe(4);
    const raw = JSON.parse(result.raw.json);
    expect(Object.keys(raw)).not.toContain('brand_new_field');
    expect(Object.keys(raw.tokens)).not.toContain('brand_new_counter');
    // Fields the proxy is known to send but that are not kept are not "unknown".
    expect(normalize({ cost_details: { usd: 1 }, iterations: [{}] })).toMatchObject({
      raw: { droppedKeys: 0 },
    });
  });

  test('method and path come from the endpoint, without the query string', () => {
    const normalized = event({ endpoint: 'POST /v1/chat/completions?alt=sse' });
    expect(normalized.method).toBe('POST');
    expect(normalized.path).toBe('/v1/chat/completions');
    expect(event({ endpoint: 'custom-operation' })).toMatchObject({ method: null, path: null });
  });

  test('request metadata is one bounded line of printable text', () => {
    expect(event({ user_agent: ' agent\tname\r\n\u0000 v2 ' }).userAgent).toBe('agent name v2');
    const long = event({ user_agent: 'é'.repeat(2000) }).userAgent as string;
    expect(Buffer.byteLength(long)).toBeLessThanOrEqual(1024);
    expect(long.endsWith('...')).toBe(true);
    expect(Buffer.byteLength(event({ client_ip: '1'.repeat(200) }).clientIp as string)).toBe(64);
    expect(event({ user_agent: '' }).userAgent).toBeNull();
  });

  test('identifiers and optional strings are trimmed, and empty means absent', () => {
    const normalized = event({
      parent_execution_id: ' parent-1 ',
      parent_session_id: '',
      instance_id: '',
    });
    expect(normalized).toMatchObject({
      executionId: '12345678-1234-4234-8234-123456789abc',
      requestId: '000000ab',
      traceId: '000000ab',
      session: { uuid: '0f0e0d0c-0b0a-4908-8706-050403020100', derived: false },
      parentExecutionId: 'parent-1',
      parentSession: null,
      instance: null,
      effort: 'medium',
      executor: 'ClaudeExecutor',
      stream: true,
      statusCode: 200,
    });
    expect(event({ stream: undefined }).stream).toBeNull();
  });

  test('a version 8 session id is one the proxy derived; any other came from a client', () => {
    const session = (version: number) => `0f0e0d0c-0b0a-${version}908-8706-050403020100`;
    for (const version of [1, 4, 5, 7]) {
      expect(event({ session_id: session(version) }).session).toEqual({
        uuid: session(version),
        derived: false,
      });
    }
    expect(event({ session_id: session(8) }).session).toEqual({ uuid: session(8), derived: true });
    // Only the version digit counts: an 8 elsewhere in the id means nothing.
    expect(event({ session_id: '88888888-8888-4888-8888-888888888888' }).session?.derived).toBe(
      false
    );
    expect(event({ session_id: '' }).session).toBeNull();
  });

  test('a parent session is kept with its own provenance, never as its own parent', () => {
    const child = '0f0e0d0c-0b0a-8908-8706-0504030201aa';
    const parent = '0f0e0d0c-0b0a-4908-8706-0504030201bb';
    expect(event({ session_id: child, parent_session_id: parent })).toMatchObject({
      session: { uuid: child, derived: true },
      parentSession: { uuid: parent, derived: false },
    });
    expect(event({ session_id: child, parent_session_id: child }).parentSession).toBeNull();
    expect(event({ session_id: '', parent_session_id: parent })).toMatchObject({
      session: null,
      parentSession: null,
    });
  });

  test('the account is the credential label when one is known, else the auth index', () => {
    expect(event()).toMatchObject({ account: '3', accountLabel: null, authIndex: '3' });
    const labelled = normalizeUsagePayload(JSON.stringify(usagePayload()), (authIndex) =>
      authIndex === '3'
        ? { account: 'synthetic@example.test', label: 'Synthetic account' }
        : undefined
    );
    expect(labelled).toMatchObject({
      event: { account: 'synthetic@example.test', accountLabel: 'Synthetic account' },
    });
    const unknown = normalizeUsagePayload(JSON.stringify(usagePayload()), () => undefined);
    expect(unknown).toMatchObject({ event: { account: '3', accountLabel: null } });
    // The auth index itself is kept whatever the label says: it is the key that joins to quota.
    expect(labelled).toMatchObject({ event: { authIndex: '3' } });
    expect(event({ auth_index: '' })).toMatchObject({
      account: null,
      accountLabel: null,
      authIndex: null,
    });
  });
});

describe('usage payload normalization: what is not an event', () => {
  test('the proxy control messages are recognized and never stored', () => {
    expect(normalizeUsagePayload('{"refresh":true}')).toEqual({
      kind: 'control',
      control: 'refresh',
    });
    expect(normalizeUsagePayload('{"support_refresh":true}')).toEqual({
      kind: 'control',
      control: 'support-refresh',
    });
  });

  test('a payload that cannot be an event is rejected with a reason', () => {
    expect(normalizeUsagePayload(`{"api_key":"${SECRET.apiKey}"`)).toEqual({
      kind: 'rejected',
      reason: 'not-json',
      raw: null,
    });
    expect(normalizeUsagePayload('[1,2]')).toEqual({
      kind: 'rejected',
      reason: 'not-an-object',
      raw: null,
    });
    expect(normalize({ execution_id: ' ' })).toMatchObject({
      kind: 'rejected',
      reason: 'missing-execution-id',
    });
    expect(normalizeUsagePayload('{"refresh":false}')).toMatchObject({
      reason: 'missing-execution-id',
    });
    for (const timestamp of [
      undefined,
      1_777_000_000,
      'yesterday',
      '2026-13-01T00:00:00Z',
      '2026-04-25T00:00:60Z',
      '2026-04-25 00:00:00',
    ]) {
      expect(normalize({ timestamp })).toMatchObject({
        kind: 'rejected',
        reason: 'invalid-timestamp',
      });
    }
  });

  test('a rejected object keeps only its allowlisted fields', () => {
    const result = normalize({ execution_id: '' });
    if (result.kind !== 'rejected' || !result.raw) throw new Error('expected a rejected object');
    for (const secret of Object.values(SECRET)) expect(result.raw.json).not.toContain(secret);
    expect(JSON.parse(result.raw.json).provider).toBe('claude');
  });
});

test('the normalizer, its types and the schema text never load SQLite', () => {
  for (const file of ['normalize.ts', 'types.ts', 'schema.ts']) {
    const source = readFileSync(new URL(`../server/usage/${file}`, import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]bun:sqlite['"]/);
    expect(source).not.toMatch(/from ['"]\.\/store['"]/);
  }
});
