import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import axios from 'axios';
import { apiClient } from '../src/services/api/client';
import { REQUEST_TIMEOUT_MS } from '../src/utils/constants';
import { modelsApi } from '../src/services/api/models';

const originalPost = apiClient.post;
afterEach(() => {
  apiClient.post = originalPost;
});
const response = { status_code: 200, body: { data: [{ id: 'test-model' }] } };

describe('public model list', () => {
  it('bounds the wait even when the public endpoint never completes the body', async () => {
    const get = spyOn(axios, 'get').mockResolvedValue({ data: { data: [] } });
    try {
      await modelsApi.fetchModels('https://proxy.invalid');
      expect(get).toHaveBeenCalledWith(
        'https://proxy.invalid/v1/models',
        expect.objectContaining({ timeout: REQUEST_TIMEOUT_MS })
      );
    } finally {
      get.mockRestore();
    }
  });
});

describe('model discovery explicit proxy', () => {
  for (const method of [
    'fetchV1ModelsViaApiCall',
    'fetchModelsViaApiCall',
    'fetchClaudeModelsViaApiCall',
    'fetchGeminiModelsViaApiCall',
  ] as const) {
    for (const proxy of ['  socks5://proxy.invalid:1080  ', ' direct ', '  ', undefined]) {
      it(`${method} normalizes proxy ${JSON.stringify(proxy)}`, async () => {
        const post = spyOn(apiClient, 'post').mockResolvedValue(response);
        const models = await modelsApi[method](
          'https://upstream.invalid',
          undefined,
          {},
          ' auth ',
          proxy
        );
        expect(models.map((model) => model.name)).toEqual(['test-model']);
        expect(post).toHaveBeenCalledTimes(1);
        expect(post.mock.calls[0][0]).toBe('/requests/api-call');
        expect(post.mock.calls[0][1]).toMatchObject({
          authIndex: 'auth',
          proxy_url: proxy?.trim() || undefined,
          method: 'GET',
        });
      });
    }
  }

  for (const method of ['fetchClaudeModelsViaApiCall', 'fetchGeminiModelsViaApiCall'] as const) {
    it(`${method} never reuses an old management connection's discovery`, async () => {
      let release!: (value: typeof response) => void;
      const post = spyOn(apiClient, 'post')
        .mockReturnValueOnce(
          new Promise<typeof response>((resolve) => {
            release = resolve;
          })
        )
        .mockResolvedValue(response);
      const old = modelsApi[method]('https://upstream.invalid');
      try {
        apiClient.setConfig({ apiBase: 'https://second.invalid', managementKey: 'fixture' });
        const current = modelsApi[method]('https://upstream.invalid');
        expect(post).toHaveBeenCalledTimes(2);
        await current;
      } finally {
        release(response);
        await old.catch(() => undefined);
        apiClient.setConfig({ apiBase: '', managementKey: '' });
      }
    });
  }

  it('stops Gemini pagination before sending upstream headers to a different backend', async () => {
    let release!: (value: unknown) => void;
    const post = spyOn(apiClient, 'post')
      .mockReturnValueOnce(
        new Promise((resolve) => {
          release = resolve;
        })
      )
      .mockResolvedValue(response);
    const pending = modelsApi.fetchGeminiModelsViaApiCall('https://upstream.invalid', 'fixture');
    apiClient.setConfig({ apiBase: 'https://second.invalid', managementKey: 'fixture' });
    try {
      release({ status_code: 200, body: { models: [], nextPageToken: 'more' } });
      await expect(pending).rejects.toHaveProperty('name', 'AbortError');
      expect(post).toHaveBeenCalledTimes(1);
    } finally {
      apiClient.setConfig({ apiBase: '', managementKey: '' });
    }
  });

  it('preserves proxy across Gemini pagination', async () => {
    const post = spyOn(apiClient, 'post')
      .mockResolvedValueOnce({
        status_code: 200,
        body: { models: [{ name: 'models/first' }], nextPageToken: 'next page' },
      })
      .mockResolvedValueOnce({ status_code: 200, body: { models: [{ name: 'models/second' }] } });
    const models = await modelsApi.fetchGeminiModelsViaApiCall(
      'https://upstream.invalid',
      undefined,
      {},
      'auth',
      ' http://proxy.invalid:8080 '
    );
    expect(models.map((model) => model.name)).toEqual(['first', 'second']);
    expect(post).toHaveBeenCalledTimes(2);
    for (const call of post.mock.calls) {
      expect(call[1]).toMatchObject({ proxy_url: 'http://proxy.invalid:8080', authIndex: 'auth' });
    }
    expect(post.mock.calls[1][1]).toMatchObject({
      url: 'https://upstream.invalid/v1beta/models?pageToken=next+page',
    });
  });

  for (const method of ['fetchClaudeModelsViaApiCall', 'fetchGeminiModelsViaApiCall'] as const) {
    it(`${method} isolates different proxies and deduplicates equivalent proxies`, async () => {
      let release!: (value: typeof response) => void;
      const pending = new Promise<typeof response>((resolve) => {
        release = resolve;
      });
      const post = spyOn(apiClient, 'post').mockReturnValue(pending);
      const requests = [
        modelsApi[method]('https://upstream.invalid', 'key', {}, 'auth', ' http://a.invalid '),
        modelsApi[method]('https://upstream.invalid', 'key', {}, 'auth', 'http://b.invalid'),
        modelsApi[method]('https://upstream.invalid', 'key', {}, 'auth', 'http://a.invalid'),
      ];
      try {
        expect(post).toHaveBeenCalledTimes(2);
        expect(post.mock.calls[0][1]).toMatchObject({ proxy_url: 'http://a.invalid' });
        expect(post.mock.calls[1][1]).toMatchObject({ proxy_url: 'http://b.invalid' });
      } finally {
        release(response);
        await Promise.all(requests);
      }
      await modelsApi[method]('https://upstream.invalid', 'key', {}, 'auth', 'http://a.invalid');
      expect(post).toHaveBeenCalledTimes(3);
    });
  }
});
