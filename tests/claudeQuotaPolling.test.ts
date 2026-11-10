import { afterEach, expect, test } from 'bun:test';
import i18next from 'i18next';
import { apiCallApi, type ApiCallResult } from '../src/services/api/apiCall';
import { CLAUDE_CONFIG } from '../src/features/quota/providers/claude/data';
import {
  CLAUDE_USAGE_CACHE_MS,
  claudeUsageReader,
  createClaudeUsageReader,
} from '../src/services/api/claudeUsageReads';
import {
  claimClaudeResetGrant,
  readClaudeResetGrants,
  readClaudeResetGrantsForDisplay,
} from '../src/services/api/claudeResetGrants';

const originalRequest = apiCallApi.request;
afterEach(() => {
  apiCallApi.request = originalRequest;
  claudeUsageReader.clear();
});
const t = i18next.createInstance().t;
const response = (statusCode: number, body: unknown): ApiCallResult => ({
  statusCode,
  body,
  bodyText: JSON.stringify(body),
  header: { 'Retry-After': ['0'] },
});

test('repeated Claude quota refreshes reuse the same observation timestamp and usage read', async () => {
  let usageReads = 0;
  apiCallApi.request = async (request) => {
    if (!request.url.includes('/usage')) return response(200, {});
    usageReads += 1;
    return response(200, { seven_day: { utilization: 25, resets_at: null } });
  };
  const file = { name: 'cached.json', type: 'claude', authIndex: 'quota-cache-regression' };
  const first = await CLAUDE_CONFIG.fetchQuota(file, t);
  const second = await CLAUDE_CONFIG.fetchQuota(file, t);
  expect(second.observedAt).toBe(first.observedAt);
  expect(usageReads).toBe(1);
});

test('repeated refreshes after an upstream 429 do not make another usage request', async () => {
  let usageReads = 0;
  apiCallApi.request = async (request) => {
    if (!request.url.includes('/usage')) return response(200, {});
    usageReads += 1;
    return response(429, { error: { message: 'Rate limited. Please try again later.' } });
  };
  const file = { name: 'limited.json', type: 'claude', authIndex: 'quota-backoff-regression' };
  await expect(CLAUDE_CONFIG.fetchQuota(file, t)).rejects.toThrow('429');
  await expect(CLAUDE_CONFIG.fetchQuota(file, t)).rejects.toThrow('429');
  expect(usageReads).toBe(1);
});

function harness() {
  const state = { now: 0, revision: 1, response: response(200, {}) };
  const requests: Parameters<typeof apiCallApi.request>[0][] = [];
  const reader = createClaudeUsageReader({
    now: () => state.now,
    revision: () => state.revision,
    random: () => 0,
    request: async (request) => {
      requests.push(request);
      return state.response;
    },
  });
  return { state, requests, reader };
}

test('a quota 429 blocks reset-status reads for that account while another account proceeds', async () => {
  const { reader, state, requests } = harness();
  state.response = response(429, {});
  await reader.read('limited', 'quota');
  state.response = response(200, {});
  expect((await reader.read('limited', 'grants')).response.statusCode).toBe(429);
  expect((await reader.read('healthy', 'grants')).response.statusCode).toBe(200);
  expect(requests.map((request) => request.authIndex)).toEqual(['limited', 'healthy']);
});

test('zero Retry-After still waits five minutes; repeated 429 doubles the delay', async () => {
  const { reader, state, requests } = harness();
  state.response = response(429, {});
  await reader.read('a', 'quota');
  state.now = 60_000;
  await reader.read('a', 'grants');
  expect(requests).toHaveLength(1);
  state.now = CLAUDE_USAGE_CACHE_MS;
  await reader.read('a', 'quota');
  expect(requests).toHaveLength(2);
  state.now += CLAUDE_USAGE_CACHE_MS;
  await reader.read('a', 'quota');
  expect(requests).toHaveLength(2);
  state.now += CLAUDE_USAGE_CACHE_MS;
  state.response = response(200, {});
  await reader.read('a', 'quota');
  expect(requests).toHaveLength(3);
});

test('honors a longer Retry-After in seconds or HTTP-date form', async () => {
  for (const value of ['900', new Date(900_000).toUTCString()]) {
    const { reader, state, requests } = harness();
    state.response = { ...response(429, {}), header: { 'retry-after': [value] } };
    await reader.read('a', 'quota');
    state.now = 899_999;
    await reader.read('a', 'quota');
    expect(requests).toHaveLength(1);
    state.now = 900_000;
    await reader.read('a', 'quota');
    expect(requests).toHaveLength(2);
  }
});

test('cache expiry makes a new observation and does not relabel a cached value as fresh', async () => {
  const { reader, state, requests } = harness();
  const first = await reader.read('a', 'quota');
  state.now = CLAUDE_USAGE_CACHE_MS - 1;
  expect(await reader.read('a', 'quota')).toBe(first);
  state.now += 1;
  const next = await reader.read('a', 'quota');
  expect(next.observedAt).not.toBe(first.observedAt);
  expect(requests).toHaveLength(2);
});

test('deduplicates in-flight reads and rejects old responses after a connection change', async () => {
  let revision = 1;
  const pending: ((value: ApiCallResult) => void)[] = [];
  const reader = createClaudeUsageReader({
    now: () => 0,
    revision: () => revision,
    random: () => 0,
    request: () => new Promise<ApiCallResult>((resolve) => pending.push(resolve)),
  });
  const old = reader.read('a', 'quota');
  expect(reader.read('a', 'quota')).toBe(old);
  revision = 2;
  const fresh = reader.read('a', 'quota');
  const oldResult = old.catch((error: unknown) => error);
  pending[0](response(429, {}));
  expect(await oldResult).toBeInstanceOf(Error);
  pending[1](response(200, {}));
  expect((await fresh).response.statusCode).toBe(200);
  expect((await reader.read('a', 'quota')).response.statusCode).toBe(200);
  expect(pending).toHaveLength(2);
});

test('a parallel successful grant response cannot erase quota backoff', async () => {
  const pending: ((value: ApiCallResult) => void)[] = [];
  const reader = createClaudeUsageReader({
    now: () => 0,
    revision: () => 1,
    random: () => 0,
    request: () => new Promise<ApiCallResult>((resolve) => pending.push(resolve)),
  });
  const quota = reader.read('a', 'quota');
  const grants = reader.read('a', 'grants');
  pending[0](response(429, {}));
  await quota;
  pending[1](response(200, {}));
  await grants;
  expect((await reader.read('a', 'quota')).response.statusCode).toBe(429);
  expect(pending).toHaveLength(2);
});

test('credential invalidation drops cached observations and rejects an older in-flight response', async () => {
  let resolve!: (value: ApiCallResult) => void;
  const reader = createClaudeUsageReader({
    now: () => 0,
    revision: () => 1,
    random: () => 0,
    request: () =>
      new Promise<ApiCallResult>((yes) => {
        resolve = yes;
      }),
  });
  const oldResult = reader.read('a', 'quota').catch((error: unknown) => error);
  reader.invalidate('a');
  resolve(response(200, {}));
  expect(await oldResult).toBeInstanceOf(Error);
});

test('a file mutation invalidates only its account while logout clears every observation', async () => {
  const { reader, requests } = harness();
  await reader.read('a', 'quota', 'a.json');
  await reader.read('b', 'quota', 'b.json');
  reader.clear(['a.json']);
  await reader.read('a', 'quota', 'a.json');
  await reader.read('b', 'quota', 'b.json');
  expect(requests.map((request) => request.authIndex)).toEqual(['a', 'b', 'a']);
  reader.clear();
  await reader.read('b', 'quota', 'b.json');
  expect(requests).toHaveLength(4);
});

test('reset spending gets a fresh grant read and invalidates display data even for an unknown outcome', async () => {
  let reads = 0;
  apiCallApi.request = async (request) => {
    if (request.method === 'POST') throw new Error('synthetic ambiguous claim');
    reads += 1;
    return response(200, { cedar_ember: { eligible: false, grants: [] } });
  };
  await readClaudeResetGrantsForDisplay('reset-preflight');
  await readClaudeResetGrantsForDisplay('reset-preflight');
  expect(reads).toBe(1);
  await readClaudeResetGrants('reset-preflight');
  expect(reads).toBe(2);
  await expect(
    claimClaudeResetGrant(
      'reset-preflight',
      '12345678-1234-1234-1234-123456789abc',
      'grant',
      'request'
    )
  ).rejects.toThrow('unknown');
  await readClaudeResetGrantsForDisplay('reset-preflight');
  expect(reads).toBe(3);
});
