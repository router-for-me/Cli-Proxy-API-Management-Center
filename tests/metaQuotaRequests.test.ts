import { describe, expect, test } from 'bun:test';
import { createMetaQuotaFetcher, MetaQuotaError } from '@/features/quota/providers/meta/requests';
import type { ApiCallRequest, ApiCallResult } from '@/services/api/apiCall';
import type { AuthFileItem } from '@/types';

const file = (authIndex: string | number | undefined): AuthFileItem => ({
  name: 'meta.json',
  provider: 'meta',
  authIndex,
});

const result = (statusCode: number, body: unknown): ApiCallResult => ({
  statusCode,
  header: {},
  bodyText: typeof body === 'string' ? body : JSON.stringify(body),
  body,
});

const expectMetaError = async (
  promise: Promise<unknown>,
  code: string,
  status?: number
): Promise<MetaQuotaError> => {
  try {
    await promise;
    throw new Error('expected request to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(MetaQuotaError);
    expect((error as MetaQuotaError).code).toBe(code);
    expect((error as MetaQuotaError).status).toBe(status);
    return error as MetaQuotaError;
  }
};

describe('Meta Muse quota request', () => {
  test('sends the exact api-call request with the backend token placeholder', async () => {
    const requests: ApiCallRequest[] = [];
    const fetchQuota = createMetaQuotaFetcher({
      request: async (request) => {
        requests.push(request);
        return result(200, {
          subs_tier_name: 'pro',
          is_subs_active: true,
          subs_usage: {
            window: { used_percent: 0, window_duration_mins: 300, resets_at: 1789485534 },
            weekly: { used_percent: 1, resets_at: 1789948800 },
          },
          api_key: 'must-not-propagate',
        });
      },
    });

    const quota = await fetchQuota(file(' 007 '));

    expect(requests).toEqual([
      {
        authIndex: '007',
        method: 'POST',
        url: 'https://api.meta.ai/muse-code/key',
        header: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer $TOKEN$',
          'x-api-version': '1.0.0',
        },
        data: '{}',
      },
    ]);
    expect(JSON.stringify(quota)).not.toContain('must-not-propagate');
  });

  test('rejects a missing auth index without making an upstream request', async () => {
    let calls = 0;
    const fetchQuota = createMetaQuotaFetcher({
      request: async () => {
        calls += 1;
        return result(200, {});
      },
    });

    await expectMetaError(fetchQuota(file(undefined)), 'missing_auth_index');
    await expectMetaError(fetchQuota(file(' ')), 'missing_auth_index');
    expect(calls).toBe(0);
  });

  test('uses a generic status error and never includes an error response secret', async () => {
    const secret = 'echoed-sensitive-api-key';
    const fetchQuota = createMetaQuotaFetcher({
      request: async () => result(429, { error: { message: secret }, api_key: secret }),
    });

    const error = await expectMetaError(fetchQuota(file(9)), 'request_failed', 429);
    expect(error.message).toBe('request_failed');
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  test('replaces management request failures instead of forwarding sensitive messages', async () => {
    const secret = 'sensitive-management-error';
    const fetchQuota = createMetaQuotaFetcher({
      request: async () => {
        const error = new Error(secret) as Error & { status?: number; details?: unknown };
        error.status = 502;
        error.details = { api_key: secret };
        throw error;
      },
    });

    const error = await expectMetaError(fetchQuota(file('2')), 'request_failed', 502);
    expect(error.message).toBe('request_failed');
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  test('rejects successful responses without any recognized quota fields', async () => {
    const fetchQuota = createMetaQuotaFetcher({
      request: async () => result(200, { api_key: 'only-a-secret', email: 'pii@example.test' }),
    });

    await expectMetaError(fetchQuota(file('3')), 'empty_data');
  });

  test('parses bodyText when api-call has no parsed body', async () => {
    const fetchQuota = createMetaQuotaFetcher({
      request: async () => ({
        statusCode: 200,
        header: {},
        body: null,
        bodyText: JSON.stringify({ subs_usage: { weekly: { used_percent: 12 } } }),
      }),
    });

    await expect(fetchQuota(file('4'))).resolves.toMatchObject({
      windows: [
        { id: 'window', usedPercent: null },
        { id: 'weekly', usedPercent: 12 },
      ],
    });
  });
});
