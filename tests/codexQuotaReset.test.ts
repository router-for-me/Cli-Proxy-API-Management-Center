import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  cleanupCodexReset,
  getCodexResetView,
  recheckCodexReset,
  runCodexQuotaReset,
} from '@/features/quota/providers/codex/reset';
import {
  useCodexResetStore,
  createCodexResetStore,
  codexResetKey,
} from '@/features/quota/providers/codex/resetOperations';
import type {
  CodexResetConsumeIntent,
  CodexResetConsumeResult,
} from '@/features/quota/providers/codex/resetContract';
import { CODEX_CONFIG } from '@/features/quota/providers/codex/data';
import { apiCallApi, type ApiCallResult } from '@/services/api/apiCall';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient, RequestNotSentError } from '@/services/api/client';
import { useQuotaStore } from '@/stores/useQuotaStore';
import type { AuthFileItem } from '@/types';
import {
  CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
  CODEX_RATE_LIMIT_RESET_CREDITS_URL,
  CODEX_SUBSCRIPTION_URL,
  CODEX_USAGE_URL,
} from '@/utils/quota';

const t = ((key: string) => key) as TFunction;
const originalList = authFilesApi.list;
const originalResetCooldown = authFilesApi.resetCooldown;
const originalRevision = apiClient.getConnectionRevision;
const originalScope = apiClient.getConnectionScope;
const originalRequest = apiCallApi.request;
let revision = 10;
let scope = 'connection-a';
class SessionStorage implements Storage {
  values = new Map<string, string>();
  failWrites = false;
  failRemovals = false;
  get length() {
    return this.values.size;
  }
  key(i: number) {
    return [...this.values.keys()][i] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw Error('full');
    this.values.set(key, value);
  }
  removeItem(key: string) {
    if (this.failRemovals) throw Error('locked');
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}
let storage: SessionStorage;
const file = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'codex.json',
  provider: 'codex',
  auth_index: 'idx',
  id_token: { chatgpt_account_id: 'account-1' },
  ...overrides,
});
const success: CodexResetConsumeResult = { outcome: 'success', code: 'reset' };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};
const harness = (target = file()) => {
  const events: string[] = [];
  const list = mock(async () => {
    events.push('list');
    return { files: [{ ...target }] };
  });
  const consume = mock(
    async (
      _intent: CodexResetConsumeIntent,
      _revision: number
    ): Promise<CodexResetConsumeResult> => {
      events.push('consume');
      return success;
    }
  );
  const clear = mock(async (authIndex: string) => {
    events.push('clear');
    return { status: 'ok' as const, auth_index: authIndex, models: [] };
  });
  const data = { windows: [], rateLimitResetCreditsAvailableCount: 0 };
  const refresh = mock(async (_revision: number) => {
    events.push('refresh');
    return data;
  });
  authFilesApi.list = list;
  authFilesApi.resetCooldown = clear;
  const key = codexResetKey(scope, 'account-1');
  return {
    target,
    events,
    list,
    consume,
    clear,
    refresh,
    data,
    key,
    record: () => useCodexResetStore.getState().records[key],
    run: () => runCodexQuotaReset(target, t, consume, refresh),
  };
};
beforeEach(() => {
  revision = 10;
  scope = 'connection-a';
  apiClient.getConnectionRevision = () => revision;
  apiClient.getConnectionScope = () => scope;
  storage = new SessionStorage();
  useCodexResetStore.getState().initialize(storage);
  useQuotaStore.getState().clearQuotaCache();
});
afterEach(() => {
  authFilesApi.list = originalList;
  authFilesApi.resetCooldown = originalResetCooldown;
  apiClient.getConnectionRevision = originalRevision;
  apiClient.getConnectionScope = originalScope;
  apiCallApi.request = originalRequest;
  useQuotaStore.getState().clearQuotaCache();
});

describe('Codex reset durable workflow', () => {
  test('persists before consume, then clears target cooldown and refreshes with the captured revision', async () => {
    const h = harness();
    h.consume.mockImplementation(async () => {
      expect(h.record()?.phase).toBe('consume_pending');
      expect(storage.length).toBe(1);
      h.events.push('consume');
      return success;
    });
    expect(await h.run()).toBe(h.data);
    expect(h.events).toEqual(['list', 'consume', 'list', 'clear', 'refresh']);
    expect(h.clear).toHaveBeenCalledWith('idx', { expectedConnectionRevision: 10 });
    expect(h.refresh).toHaveBeenCalledWith(10);
    expect(h.record()).toBeUndefined();
    expect(storage.length).toBe(0);
  });
  test('retains cooldown failure and retries only cooldown plus refresh', async () => {
    const h = harness();
    h.clear.mockRejectedValueOnce(Error('clear failed'));
    await expect(h.run()).rejects.toThrow('clear failed');
    expect(h.record()?.phase).toBe('cooldown_pending');
    expect(getCodexResetView(h.target).action).toBe('cooldown');
    await h.run();
    expect(h.consume).toHaveBeenCalledTimes(1);
    expect(h.clear).toHaveBeenCalledTimes(2);
  });
  test('retains refresh failure and retries only quota reads', async () => {
    const h = harness();
    h.refresh.mockRejectedValueOnce(Error('read failed'));
    await expect(h.run()).rejects.toThrow();
    expect(h.record()?.phase).toBe('refresh_pending');
    await h.run();
    expect(h.consume).toHaveBeenCalledTimes(1);
    expect(h.clear).toHaveBeenCalledTimes(1);
  });
  test.each(['no_credit', 'nothing_to_reset'] as const)(
    '%s ends redemption without clearing cooldown',
    async (code) => {
      const h = harness();
      h.consume.mockResolvedValueOnce({ outcome: 'terminal', code });
      await expect(h.run()).rejects.toThrow(`reset_${code}`);
      expect(h.clear).not.toHaveBeenCalled();
      expect(h.refresh).not.toHaveBeenCalled();
      expect(h.record()).toBeUndefined();
    }
  );
  test('network ambiguity retains original complete intent for a manual retry', async () => {
    const h = harness();
    h.consume.mockRejectedValueOnce(Error('lost response'));
    await expect(h.run()).rejects.toThrow('reset_result_unknown');
    expect(h.record()?.phase).toBe('consume_unknown');
    expect(h.consume).toHaveBeenCalledTimes(1);
    await h.run();
    expect(h.consume.mock.calls[1][0]).toEqual(h.consume.mock.calls[0][0]);
    expect(h.clear).toHaveBeenCalledTimes(1);
  });
  test('rejects another credential for the same account without a new operation ID', async () => {
    const h = harness();
    h.consume.mockRejectedValueOnce(Error('unknown'));
    await expect(h.run()).rejects.toThrow();
    const id = h.record()!.operationId;
    const other = file({ name: 'alias.json', auth_index: 'alias' });
    await expect(runCodexQuotaReset(other, t, h.consume, h.refresh)).rejects.toThrow(
      'reset_other_credential'
    );
    expect(h.record()?.operationId).toBe(id);
    expect(h.record()?.pause).toBeUndefined();
    expect(getCodexResetView(other).blocked).toBe(true);
    expect(getCodexResetView(other).reasonParams).toEqual({ name: h.target.name });
    expect(getCodexResetView(h.target).action).toBe('retry');
    expect(h.consume).toHaveBeenCalledTimes(1);
    await recheckCodexReset(h.target, t);
    expect(h.record()?.pause).toBeUndefined();
    expect(h.consume).toHaveBeenCalledTimes(1);
    await h.run();
    expect(h.consume.mock.calls[1][0]).toEqual(h.consume.mock.calls[0][0]);
  });
  test('write failure before consume sends zero consume requests', async () => {
    const h = harness();
    storage.failWrites = true;
    await expect(h.run()).rejects.toThrow('reset_storage_error');
    expect(h.consume).not.toHaveBeenCalled();
    expect(h.record()).toBeUndefined();
    expect(getCodexResetView(h.target).action).toBe('recheck');
    storage.failWrites = false;
    await recheckCodexReset(h.target, t);
    await h.run();
    expect(h.consume).toHaveBeenCalledTimes(1);
  });
  test('success write failure preserves memory fact and blocks further consume', async () => {
    const h = harness();
    h.consume.mockImplementation(async () => {
      storage.failWrites = true;
      return success;
    });
    await expect(h.run()).rejects.toThrow('reset_storage_error');
    expect(h.record()?.phase).toBe('cooldown_pending');
    expect(h.clear).not.toHaveBeenCalled();
    await expect(h.run()).rejects.toThrow('reset_storage_error');
    expect(h.consume).toHaveBeenCalledTimes(1);
    storage.failWrites = false;
    await recheckCodexReset(h.target, t);
    await h.run();
    expect(h.consume).toHaveBeenCalledTimes(1);
  });
  test('new operation rejected before dispatch is removed and unlocks', async () => {
    const h = harness();
    h.consume.mockRejectedValueOnce(new RequestNotSentError());
    await expect(h.run()).rejects.toThrow();
    expect(h.record()).toBeUndefined();
    expect(useCodexResetStore.getState().busy[h.key]).toBeUndefined();
  });
  test('recovery rejected before dispatch preserves its original record exactly', async () => {
    const h = harness();
    h.consume.mockRejectedValueOnce(Error('unknown'));
    await expect(h.run()).rejects.toThrow();
    const previous = h.record();
    const serialized = [...storage.values.values()];
    h.consume.mockRejectedValueOnce(new RequestNotSentError());
    await expect(h.run()).rejects.toThrow();
    expect(h.record()).toBe(previous);
    expect([...storage.values.values()]).toEqual(serialized);
    expect(getCodexResetView(h.target).busy).toBe(false);
  });
  test('a locally refused new operation whose deletion fails is recoverable as unknown', async () => {
    const h = harness();
    h.consume.mockImplementation(async () => {
      storage.failRemovals = true;
      throw new RequestNotSentError();
    });
    await expect(h.run()).rejects.toThrow('reset_storage_error');
    expect(h.record()?.phase).toBe('consume_unknown');
    expect(getCodexResetView(h.target).busy).toBe(false);
  });
  test.each(['no_credit', 'nothing_to_reset'] as const)(
    'failed deletion of %s remains cleanup-only across reload',
    async (code) => {
      const h = harness();
      storage.failRemovals = true;
      h.consume.mockResolvedValueOnce({ outcome: 'terminal', code });
      await expect(h.run()).rejects.toThrow('reset_storage_error');
      useCodexResetStore.getState().initialize(storage);
      expect(getCodexResetView(h.target).action).toBe('cleanup');
      await expect(h.run()).rejects.toThrow('local_cleanup_required');
      expect(h.consume).toHaveBeenCalledTimes(1);
      storage.failRemovals = false;
      await cleanupCodexReset(h.target, t);
      expect(h.record()).toBeUndefined();
      expect(h.clear).not.toHaveBeenCalled();
    }
  );
  test('completed refresh with failed deletion also stays cleanup-only', async () => {
    const h = harness();
    storage.failRemovals = true;
    await expect(h.run()).rejects.toThrow('reset_storage_error');
    expect(h.record()?.terminal).toBe('completed');
    useCodexResetStore.getState().initialize(storage);
    storage.failRemovals = false;
    await cleanupCodexReset(h.target, t);
    expect(h.consume).toHaveBeenCalledTimes(1);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });
  test('reload during consume recovers unknown with the original ID', async () => {
    const h = harness();
    const started = deferred<void>();
    const result = deferred<CodexResetConsumeResult>();
    h.consume.mockImplementation(async () => {
      started.resolve();
      return result.promise;
    });
    const run = h.run();
    await started.promise;
    const reloaded = createCodexResetStore(storage);
    expect(reloaded.getState().records[h.key]?.phase).toBe('consume_unknown');
    expect(reloaded.getState().records[h.key]?.intent).toEqual(h.record()?.intent);
    result.resolve(success);
    await run;
  });
  test('account lock survives cache invalidation, alias credential and connection ABA until consume settles', async () => {
    const h = harness();
    const started = deferred<void>();
    const result = deferred<CodexResetConsumeResult>();
    h.consume.mockImplementation(async () => {
      started.resolve();
      return result.promise;
    });
    const run = h.run();
    await started.promise;
    useQuotaStore.getState().clearQuotaCache();
    revision += 2;
    await expect(
      runCodexQuotaReset(file({ name: 'alias.json' }), t, h.consume, h.refresh)
    ).rejects.toThrow('reset_in_progress');
    expect(getCodexResetView(h.target).busy).toBe(true);
    result.resolve(success);
    await expect(run).rejects.toThrow('stale_request');
    expect(h.record()?.phase).toBe('cooldown_pending');
    expect(getCodexResetView(h.target).busy).toBe(false);
    expect(h.consume).toHaveBeenCalledTimes(1);
  });
  test.each(['connection', 'session cache', 'credential cache'])(
    'keeps successful recovery but stops continuation after %s changes',
    async (change) => {
      const h = harness();
      h.consume.mockImplementation(async () => {
        if (change === 'connection') {
          revision += 1;
          scope = 'connection-b';
        } else
          useQuotaStore
            .getState()
            .clearQuotaCache(change === 'credential cache' ? [h.target.name] : undefined);
        return success;
      });
      await expect(h.run()).rejects.toThrow('stale_request');
      expect(h.record()?.phase).toBe('cooldown_pending');
      expect(h.record()?.pause).toBe('stale_request');
      expect(h.clear).not.toHaveBeenCalled();
      expect(h.refresh).not.toHaveBeenCalled();
    }
  );
  test('switching during credential lookup prevents consume', async () => {
    const h = harness();
    const lookup = deferred<{ files: AuthFileItem[] }>();
    h.list.mockReturnValueOnce(lookup.promise);
    const run = h.run();
    revision += 1;
    lookup.resolve({ files: [h.target] });
    await expect(run).rejects.toThrow();
    expect(h.consume).not.toHaveBeenCalled();
  });
  test('unrelated credential invalidation does not stop the operation', async () => {
    const h = harness();
    h.consume.mockImplementation(async () => {
      useQuotaStore.getState().clearQuotaCache(['other.json']);
      return success;
    });
    await h.run();
    expect(h.clear).toHaveBeenCalledTimes(1);
  });
  test.each(['clear', 'refresh'] as const)(
    'old %s completion does not advance or delete the saved operation',
    async (step) => {
      const h = harness();
      const started = deferred<void>();
      const finish = deferred<void>();
      if (step === 'clear')
        h.clear.mockImplementation(async () => {
          started.resolve();
          await finish.promise;
          return { status: 'ok', auth_index: 'idx', models: [] };
        });
      else
        h.refresh.mockImplementation(async () => {
          started.resolve();
          await finish.promise;
          return h.data;
        });
      const run = h.run();
      await started.promise;
      revision += 1;
      scope = 'connection-b';
      finish.resolve();
      await expect(run).rejects.toThrow('stale_request');
      expect(h.record()?.phase).toBe(step === 'clear' ? 'cooldown_pending' : 'refresh_pending');
      if (step === 'clear') expect(h.refresh).not.toHaveBeenCalled();
    }
  );
  test.each([
    ['missing', []],
    ['ambiguous', [file(), file()]],
    ['disabled', [file({ disabled: true })]],
    ['provider', [file({ provider: 'claude' })]],
    ['account', [file({ id_token: { chatgpt_account_id: 'another' } })]],
    ['index', [file({ auth_index: 'replacement' })]],
  ] as const)('rejects %s credentials before consuming', async (_label, files) => {
    const h = harness();
    h.list.mockResolvedValueOnce({ files: [...files] });
    await expect(h.run()).rejects.toThrow('credential_changed');
    expect(h.consume).not.toHaveBeenCalled();
  });
  test('missing account ID rejects resets even with email but ordinary quota query remains available', async () => {
    const h = harness(file({ id_token: undefined, email: 'user@example.test' }));
    await expect(h.run()).rejects.toThrow('missing_account_id');
    expect(h.consume).not.toHaveBeenCalled();
    apiCallApi.request = async () => result(200, { rate_limit: {} });
    await expect(CODEX_CONFIG.fetchQuota(h.target, t)).resolves.toBeDefined();
  });
  test('unloaded journal cannot start a redemption', async () => {
    const h = harness();
    useCodexResetStore.setState({ ready: false });
    await expect(h.run()).rejects.toThrow('loading_record');
    expect(h.consume).not.toHaveBeenCalled();
  });
});

const result = (statusCode: number, body: unknown): ApiCallResult => ({
  statusCode,
  body,
  bodyText: JSON.stringify(body),
  header: {},
});
describe('provider simulated redemption contract', () => {
  test('two requests reuse one ID, spend one credit, and clear cooldown once after lost response', async () => {
    const h = harness();
    const requests: string[] = [];
    const redeemed = new Map<string, string>();
    let consumed = 0;
    apiCallApi.request = async (request) => {
      if (request.url === CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL) {
        const id = JSON.parse(request.data!).redeem_request_id as string;
        requests.push(id);
        const key = JSON.stringify([request.header!['Chatgpt-Account-Id'], id]);
        if (!redeemed.has(key)) {
          redeemed.set(key, 'reset');
          consumed += 1;
          throw Error('server committed; response lost');
        }
        return result(200, { code: 'already_redeemed', windows_reset: 0 });
      }
      if (request.url === CODEX_USAGE_URL)
        return result(200, { rate_limit: {}, rate_limit_reset_credits: { available_count: 0 } });
      if (request.url === CODEX_RATE_LIMIT_RESET_CREDITS_URL)
        return result(200, { available_count: 0, credits: [] });
      if (request.url.startsWith(CODEX_SUBSCRIPTION_URL)) return result(200, {});
      throw Error(`Unexpected ${request.url}`);
    };
    await expect(CODEX_CONFIG.resetQuota!(h.target, t)).rejects.toThrow('result_unknown');
    useCodexResetStore.getState().initialize(storage);
    const quota = await CODEX_CONFIG.resetQuota!(h.target, t);
    expect(quota.rateLimitResetCreditsAvailableCount).toBe(0);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe(requests[1]);
    expect(consumed).toBe(1);
    expect(h.clear).toHaveBeenCalledTimes(1);
  });
});

describe('credential and recovery failure regressions', () => {
  test.each([
    { status: 'unexpected', auth_index: 'idx', models: [] },
    { status: 'ok', auth_index: 'another-index', models: [] },
  ])('does not accept an invalid cooldown response: %j', async (response) => {
    const h = harness();
    h.clear.mockResolvedValueOnce(response as Awaited<ReturnType<typeof h.clear>>);
    await expect(h.run()).rejects.toThrow('reset_cooldown_failed');
    expect(h.record()?.phase).toBe('cooldown_pending');
    expect(h.refresh).not.toHaveBeenCalled();
    await h.run();
    expect(h.consume).toHaveBeenCalledTimes(1);
  });
  test('credential replacement after consume pauses confirmed success before cooldown', async () => {
    const h = harness();
    h.list.mockResolvedValueOnce({ files: [h.target] });
    h.list.mockResolvedValueOnce({
      files: [file({ id_token: { chatgpt_account_id: 'replacement' } })],
    });
    await expect(h.run()).rejects.toThrow('credential_changed');
    expect(h.record()?.phase).toBe('cooldown_pending');
    expect(h.record()?.pause).toBe('credential_changed');
    expect(h.clear).not.toHaveBeenCalled();
    expect(h.refresh).not.toHaveBeenCalled();
  });
  test('failed post-consume credential read retains success and never consumes on recovery', async () => {
    const h = harness();
    h.list.mockResolvedValueOnce({ files: [h.target] });
    h.list.mockRejectedValueOnce(Error('lookup failed'));
    await expect(h.run()).rejects.toThrow('lookup failed');
    expect(h.record()?.phase).toBe('cooldown_pending');
    await h.run();
    expect(h.consume).toHaveBeenCalledTimes(1);
    expect(h.clear).toHaveBeenCalledTimes(1);
  });
  test('initial credential read failure cannot start consumption', async () => {
    const h = harness();
    h.list.mockRejectedValueOnce(Error('lookup failed'));
    await expect(h.run()).rejects.toThrow('lookup failed');
    expect(h.consume).not.toHaveBeenCalled();
    expect(h.record()).toBeUndefined();
  });
  test('missing auth index cannot make any reset API request', async () => {
    const h = harness(file({ auth_index: undefined }));
    await expect(h.run()).rejects.toThrow('missing_auth_index');
    expect(h.list).not.toHaveBeenCalled();
    expect(h.consume).not.toHaveBeenCalled();
  });
  test('terminal cleanup works through a same-account disabled credential lacking auth index', async () => {
    const h = harness();
    storage.failRemovals = true;
    h.consume.mockResolvedValueOnce({ outcome: 'terminal', code: 'no_credit' });
    await expect(h.run()).rejects.toThrow('storage_error');
    storage.failRemovals = false;
    const changed = file({ auth_index: undefined, disabled: true });
    expect(getCodexResetView(changed).action).toBe('cleanup');
    const before = h.list.mock.calls.length;
    await cleanupCodexReset(changed, t);
    expect(h.list.mock.calls.length).toBe(before);
    expect(h.consume).toHaveBeenCalledTimes(1);
    expect(h.record()).toBeUndefined();
  });
});

test('success merged during retry preflight skips consume and only resumes the confirmed recovery', async () => {
  const h = harness();
  h.consume.mockRejectedValueOnce(Error('lost response'));
  await expect(h.run()).rejects.toThrow();
  const original = h.record()!;
  h.list.mockImplementationOnce(async () => {
    useCodexResetStore.getState().mergeSuccess(original);
    return { files: [h.target] };
  });
  await h.run();
  expect(h.consume).toHaveBeenCalledTimes(1);
  expect(h.clear).toHaveBeenCalledTimes(1);
  expect(h.record()).toBeUndefined();
});
