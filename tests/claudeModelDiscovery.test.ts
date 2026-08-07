import { afterEach, describe, expect, test } from 'bun:test';
import { buildClaudeMessagesEndpoint } from '../src/components/providers/utils';
import { apiCallApi } from '../src/services/api/apiCall';
import { modelsApi } from '../src/services/api/models';

const originalApiCallRequest = apiCallApi.request;

afterEach(() => {
  apiCallApi.request = originalApiCallRequest;
});

describe('Claude model discovery', () => {
  test('falls back from an Anthropic protocol prefix to the sibling models endpoint', async () => {
    const requestedUrls: string[] = [];
    apiCallApi.request = (async (payload) => {
      requestedUrls.push(payload.url);
      if (requestedUrls.length === 1) {
        return { statusCode: 404, header: {}, bodyText: 'Not Found', body: null };
      }
      return {
        statusCode: 200,
        header: {},
        bodyText: '',
        body: { data: [{ id: 'deepseek-v4-flash' }] },
      };
    }) as typeof apiCallApi.request;

    const models = await modelsApi.fetchClaudeModelsViaApiCall(
      'https://api.deepseek.com/anthropic',
      'test-key'
    );

    expect(requestedUrls).toEqual([
      'https://api.deepseek.com/anthropic/v1/models',
      'https://api.deepseek.com/v1/models',
    ]);
    expect(models).toEqual([{ name: 'deepseek-v4-flash' }]);
    expect(buildClaudeMessagesEndpoint('https://api.deepseek.com/anthropic')).toBe(
      'https://api.deepseek.com/anthropic/v1/messages'
    );
  });

  test('does not bypass the configured base path for non-404 failures', async () => {
    const requestedUrls: string[] = [];
    apiCallApi.request = (async (payload) => {
      requestedUrls.push(payload.url);
      return { statusCode: 401, header: {}, bodyText: '', body: null };
    }) as typeof apiCallApi.request;

    await expect(
      modelsApi.fetchClaudeModelsViaApiCall('https://gateway.example.com/anthropic', 'test-key')
    ).rejects.toThrow('HTTP 401');

    expect(requestedUrls).toEqual(['https://gateway.example.com/anthropic/v1/models']);
  });
});
