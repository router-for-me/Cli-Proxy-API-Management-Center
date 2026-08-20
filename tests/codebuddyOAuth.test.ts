import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { oauthApi, type BuiltInOAuthProvider } from '../src/services/api/oauth';

const originalGet = apiClient.get;

afterEach(() => {
  apiClient.get = originalGet;
});

describe('CodeBuddy CN OAuth', () => {
  test('uses the backend device-flow management endpoint', async () => {
    const calls: Array<{ url: string; config?: unknown }> = [];
    apiClient.get = (async (url: string, config?: unknown) => {
      calls.push({ url, config });
      return {
        url: 'https://copilot.tencent.com/authorize',
        state: 'codebuddy-state',
      };
    }) as typeof apiClient.get;

    const provider: BuiltInOAuthProvider = 'codebuddy-cn';
    const response = await oauthApi.startAuth(provider);

    expect(response.state).toBe('codebuddy-state');
    expect(calls).toEqual([
      {
        url: '/codebuddy-cn-auth-url',
        config: { params: undefined },
      },
    ]);
  });
});
