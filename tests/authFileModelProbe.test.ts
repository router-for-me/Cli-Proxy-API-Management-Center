import { afterEach, expect, test } from 'bun:test';
import { authFilesApi } from '../src/services/api/authFiles';
import { apiClient } from '../src/services/api/client';

const originalPost = apiClient.post;
afterEach(() => {
  apiClient.post = originalPost;
});

test('model probe binds credential and disables the default short request timeout', async () => {
  let captured: unknown[] = [];
  apiClient.post = (async (...args: unknown[]) => {
    captured = args;
    return { success: true, model: 'gpt-image-2', kind: 'image', latency_ms: 3200, image_count: 1 };
  }) as typeof apiClient.post;
  const controller = new AbortController();
  const result = await authFilesApi.testModelForAuthFile(
    'account-index',
    'gpt-image-2',
    controller.signal
  );
  expect(captured).toEqual([
    '/auth-files/test-model',
    { auth_index: 'account-index', model: 'gpt-image-2' },
    { signal: controller.signal, timeout: 0 },
  ]);
  expect(result).toEqual({
    success: true,
    model: 'gpt-image-2',
    kind: 'image',
    latencyMs: 3200,
    imageCount: 1,
    message: undefined,
    error: undefined,
  });
});

test('upstream auth failures remain model test results', async () => {
  apiClient.post = (async () => ({
    success: false,
    model: 'gpt-5.5',
    kind: 'text',
    latency_ms: 10,
    error: { code: 'upstream_error', status_code: 401, message: 'Unauthorized' },
  })) as typeof apiClient.post;
  const result = await authFilesApi.testModelForAuthFile('account-index', 'gpt-5.5');
  expect(result.success).toBe(false);
  expect(result.error).toEqual({
    code: 'upstream_error',
    statusCode: 401,
    message: 'Unauthorized',
  });
});
