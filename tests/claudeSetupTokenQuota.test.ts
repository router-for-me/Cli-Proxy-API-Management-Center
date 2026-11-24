import { afterEach, expect, spyOn, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { CLAUDE_CONFIG } from '@/features/quota/providers/claude/data';
import { apiCallApi } from '@/services/api';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';

const t = ((key: string) => key) as TFunction;
const credential = { name: 'claude-setup.json', authIndex: 'setup-index' };
const scopeError = {
  type: 'permission_error',
  message: 'OAuth token does not meet scope requirement user:profile',
};
const observedAt = '2026-11-20T07:00:00Z';

const mockScopeError = (error = scopeError) =>
  spyOn(apiCallApi, 'request').mockResolvedValue({
    statusCode: 403,
    header: {},
    bodyText: '',
    body: { error },
  });

const mockObservation = (data: unknown) => {
  const post = spyOn(apiClient, 'post').mockResolvedValue(data);
  spyOn(apiClient, 'captureConnection').mockReturnValue(apiClient);
  return post;
};

afterEach(() => {
  // Every spy is restored so concurrent quota provider suites retain the real client.
  for (const method of [apiClient.post, apiClient.captureConnection, apiCallApi.request]) {
    if ('mockRestore' in method && typeof method.mockRestore === 'function') method.mockRestore();
  }
});

test('manual refresh uses the observed windows when Claude denies the usage scope', async () => {
  mockScopeError();
  const post = mockObservation({
    quota: {
      observed_at: observedAt,
      signals: {
        'Anthropic-Ratelimit-Unified-7d-Utilization': '0.31',
        'anthropic-ratelimit-unified-7d-reset': '1795158000',
        'anthropic-ratelimit-unified-5h-status': 'allowed',
      },
    },
  });

  const result = await CLAUDE_CONFIG.refreshQuota!(credential, t);

  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith('/credentials/claude-quota', {
    auth_index: 'setup-index',
  });
  expect(result.observedAt).toBe(observedAt);
  expect(
    result.windows.map(({ id, usedPercent, resetAtMs }) => ({ id, usedPercent, resetAtMs }))
  ).toEqual([{ id: 'seven-day', usedPercent: 31, resetAtMs: 1795158000000 }]);
  expect(result.dollarWindows).toEqual([]);
});

test('background loads and unrelated permission errors do not trigger inference', async () => {
  const upstream = mockScopeError();
  const post = mockObservation({});
  await expect(CLAUDE_CONFIG.fetchQuota(credential, t)).rejects.toMatchObject({ status: 403 });

  upstream.mockResolvedValue({
    statusCode: 403,
    header: {},
    bodyText: '',
    body: { error: { type: 'permission_error', message: 'Organization is disabled' } },
  });
  await expect(CLAUDE_CONFIG.refreshQuota!(credential, t)).rejects.toMatchObject({ status: 403 });
  expect(post).not.toHaveBeenCalled();
});

test('a marked setup token refresh skips the OAuth endpoints entirely', async () => {
  const upstream = mockScopeError();
  const post = mockObservation({
    quota: {
      observed_at: observedAt,
      signals: { 'anthropic-ratelimit-unified-7d-utilization': '0.99' },
    },
  });
  const [file] = normalizeAuthFilesResponse({
    files: [{ ...credential, claude_setup_token: true }],
  }).files;

  const result = await CLAUDE_CONFIG.refreshQuota!(file, t);

  expect(result.windows[0]?.usedPercent).toBe(99);
  expect(post).toHaveBeenCalledTimes(1);
  expect(upstream).not.toHaveBeenCalled();
});

test('the existing usage endpoint still supplies the normal refresh result', async () => {
  spyOn(apiCallApi, 'request').mockResolvedValue({
    statusCode: 200,
    header: {},
    bodyText: '',
    body: { seven_day: { utilization: 24, resets_at: observedAt } },
  });
  const post = mockObservation({});

  const result = await CLAUDE_CONFIG.refreshQuota!(credential, t);

  expect(result.windows[0]?.usedPercent).toBe(24);
  expect(post).not.toHaveBeenCalled();
});

test('a response from a previous connection cannot start a quota probe', async () => {
  mockScopeError();
  const post = mockObservation({});
  const revision = spyOn(apiClient, 'getConnectionRevision')
    .mockReturnValueOnce(1)
    .mockReturnValue(2);
  try {
    await expect(CLAUDE_CONFIG.refreshQuota!(credential, t)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(post).not.toHaveBeenCalled();
  } finally {
    revision.mockRestore();
  }
});
