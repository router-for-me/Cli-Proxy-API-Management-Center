import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { CODEX_CONFIG } from '@/features/quota/providers/codex/data';
import { apiCallApi, authFilesApi, apiClient } from '@/services/api';
import { CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL, CODEX_USAGE_URL } from '@/utils/quota';

const t = ((key: string) => key) as TFunction;
const file = { name: 'codex-test.json', auth_index: 'test-index', type: 'codex' };
const response = (body: unknown, statusCode = 200) => ({
  statusCode,
  body,
  bodyText: JSON.stringify(body),
  header: {},
});
const reset = () => CODEX_CONFIG.resetQuota!(file, t);
const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const mock of mocks.splice(0)) mock.mockRestore();
});

function setup(body: unknown, statusCode = 200) {
  const calls: string[] = [];
  const request = spyOn(apiCallApi, 'request').mockImplementation(async (payload) => {
    if (payload.url === CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL) {
      calls.push('consume');
      return response(body, statusCode);
    }
    calls.push('read');
    return response({ credits: [] });
  });
  const clear = spyOn(authFilesApi, 'resetCooldown').mockImplementation(async () => {
    calls.push('clear');
    return { status: 'ok', auth_index: 'test-index', models: [] };
  });
  mocks.push(request, clear);
  return { calls, request, clear };
}

async function expectReadOnly(message: string) {
  const state = await reset();
  expect(state.status).toBe('error');
  expect(state.error).toBe(message);
  expect(CODEX_CONFIG.canResetQuota!(state)).toBeFalse();
}

describe('Codex reset gateway cooldown', () => {
  test.each(['reset', 'already_redeemed'])(
    'clears only after confirmed %s, before reads',
    async (code) => {
      const { calls, clear } = setup({ code, windows_reset: 0 });
      expect((await reset()).status).toBe('success');
      expect(calls.slice(0, 3)).toEqual(['consume', 'clear', 'read']);
      expect(clear).toHaveBeenCalledTimes(1);
      expect(clear).toHaveBeenCalledWith('test-index');
    }
  );

  test.each(['no_credit', 'nothing_to_reset', 'unknown'])('does not clear for %s', async (code) => {
    const { calls } = setup({ code });
    await expect(reset()).rejects.toThrow('codex_quota.reset_not_confirmed');
    expect(calls).toEqual(['consume']);
  });

  test('does not clear on HTTP failure', async () => {
    const { calls } = setup({ code: 'reset' }, 503);
    await expect(reset()).rejects.toThrow();
    expect(calls).toEqual(['consume']);
  });

  test('does not clear on transport failure', async () => {
    const { request, clear } = setup({});
    request.mockRejectedValue(new Error('timeout'));
    await expect(reset()).rejects.toThrow('timeout');
    expect(clear).not.toHaveBeenCalled();
  });

  test('directs cooldown failures to manual clearing, without another consume', async () => {
    const { request, clear } = setup({ code: 'reset' });
    clear.mockRejectedValue(new Error('offline'));
    await expectReadOnly('codex_quota.reset_cooldown_failed');
    expect(request).toHaveBeenCalledTimes(1);
  });

  test.each(['usage', 'credits'])(
    'requires a reread when %s GET fails after redemption',
    async (failed) => {
      const { request } = setup({});
      request.mockImplementation(async ({ method, url }) => {
        if (method === 'POST') return response({ code: 'already_redeemed' });
        if ((url === CODEX_USAGE_URL) === (failed === 'usage')) return response({}, 503);
        return response({ rate_limit_reset_credits: { available_count: 2 } });
      });
      await expectReadOnly('codex_quota.reset_refresh_failed');
      expect(request.mock.calls.filter(([payload]) => payload.method === 'POST')).toHaveLength(1);
    }
  );

  test('rejects mismatched cooldown acknowledgements', async () => {
    const { clear } = setup({ code: 'reset' });
    clear.mockResolvedValue({ status: 'ok', auth_index: 'other-index', models: [] });
    await expectReadOnly('codex_quota.reset_cooldown_failed');
  });

  test('does not clear after connection changes during redemption', async () => {
    const { clear } = setup({ code: 'reset' });
    const revision = spyOn(apiClient, 'getConnectionRevision')
      .mockReturnValueOnce(1)
      .mockReturnValue(2);
    mocks.push(revision);
    await expectReadOnly('codex_quota.reset_cooldown_failed');
    expect(clear).not.toHaveBeenCalled();
  });
});
