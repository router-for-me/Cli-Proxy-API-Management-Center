import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { TFunction } from 'i18next';
import {
  getCodexResetIdentity,
  isCodexResetPending,
  runCodexQuotaReset,
} from '@/features/quota/providers/codex/reset';
import { CODEX_CONFIG } from '@/features/quota/providers/codex/data';
import { apiCallApi, type ApiCallResult } from '@/services/api/apiCall';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
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
const originalGetConnectionRevision = apiClient.getConnectionRevision;
const originalApiCallRequest = apiCallApi.request;
let connectionRevision = 10;

const file = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: 'codex.json',
  provider: 'codex',
  auth_index: 'idx',
  id_token: { chatgpt_account_id: 'account-1' },
  ...overrides,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const createHarness = (target = file()) => {
  const events: string[] = [];
  const list = mock(async () => {
    events.push('list');
    return { files: [{ ...target }] };
  });
  const consume = mock(async () => {
    events.push('consume');
  });
  const resetCooldown = mock(async (authIndex: string) => {
    events.push(`cooldown:${authIndex}`);
    return { status: 'ok' as const, auth_index: authIndex, models: [] as string[] };
  });
  const refreshed = { windows: [], rateLimitResetCreditsAvailableCount: 0 };
  const refresh = mock(async () => {
    events.push('refresh');
    return refreshed;
  });
  authFilesApi.list = list;
  authFilesApi.resetCooldown = resetCooldown;
  return {
    target,
    events,
    list,
    consume,
    resetCooldown,
    refresh,
    refreshed,
    run: () => runCodexQuotaReset(target, t, consume, refresh),
  };
};

beforeEach(() => {
  connectionRevision = 10;
  apiClient.getConnectionRevision = () => connectionRevision;
  useQuotaStore.getState().clearQuotaCache();
});

afterEach(() => {
  authFilesApi.list = originalList;
  authFilesApi.resetCooldown = originalResetCooldown;
  apiClient.getConnectionRevision = originalGetConnectionRevision;
  apiCallApi.request = originalApiCallRequest;
  useQuotaStore.getState().clearQuotaCache();
});

describe('Codex reset recovery', () => {
  test('consumes once, clears only the target cooldown, then refreshes quota', async () => {
    const harness = createHarness();
    harness.resetCooldown.mockImplementation(async (authIndex) => {
      harness.events.push(`cooldown:${authIndex}`);
      expect(useQuotaStore.getState().codexPendingResets[harness.target.name]?.phase).toBe(
        'cooldown_pending'
      );
      return { status: 'ok', auth_index: authIndex, models: [] };
    });

    expect(await harness.run()).toBe(harness.refreshed);
    expect(harness.events.filter((event) => event !== 'list')).toEqual([
      'consume',
      'cooldown:idx',
      'refresh',
    ]);
    expect(harness.list.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(harness.consume).toHaveBeenCalledTimes(1);
    expect(harness.resetCooldown).toHaveBeenCalledWith('idx');
    expect(useQuotaStore.getState().codexPendingResets[harness.target.name]).toBeUndefined();
  });

  test('retains a failed cooldown clear and retries it without consuming another card', async () => {
    const harness = createHarness();
    harness.resetCooldown.mockRejectedValueOnce(new Error('cooldown unavailable'));

    await expect(harness.run()).rejects.toThrow();
    const pending = useQuotaStore.getState().codexPendingResets[harness.target.name];
    expect(pending?.phase).toBe('cooldown_pending');
    expect(isCodexResetPending(harness.target, pending)).toBe(true);
    expect(harness.refresh).not.toHaveBeenCalled();

    expect(await harness.run()).toBe(harness.refreshed);
    expect(harness.consume).toHaveBeenCalledTimes(1);
    expect(harness.resetCooldown).toHaveBeenCalledTimes(2);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    expect(useQuotaStore.getState().codexPendingResets[harness.target.name]).toBeUndefined();
  });

  test('retries a failed quota refresh without repeating either successful mutation', async () => {
    const harness = createHarness();
    harness.refresh.mockRejectedValueOnce(new Error('usage unavailable'));

    await expect(harness.run()).rejects.toThrow();
    expect(useQuotaStore.getState().codexPendingResets[harness.target.name]?.phase).toBe(
      'refresh_pending'
    );

    expect(await harness.run()).toBe(harness.refreshed);
    expect(harness.consume).toHaveBeenCalledTimes(1);
    expect(harness.resetCooldown).toHaveBeenCalledTimes(1);
    expect(harness.refresh).toHaveBeenCalledTimes(2);
    expect(useQuotaStore.getState().codexPendingResets[harness.target.name]).toBeUndefined();
  });

  test('does not clear cooldown or create recovery state when consume fails', async () => {
    const harness = createHarness();
    harness.consume.mockRejectedValueOnce(new Error('consume rejected'));

    await expect(harness.run()).rejects.toThrow();
    expect(harness.resetCooldown).not.toHaveBeenCalled();
    expect(harness.refresh).not.toHaveBeenCalled();
    expect(useQuotaStore.getState().codexPendingResets[harness.target.name]).toBeUndefined();
  });

  test.each([
    { status: 'error', auth_index: 'idx', models: [] },
    { status: 'ok', auth_index: 'another-index', models: [] },
  ])('does not acknowledge an invalid cooldown response: %j', async (response) => {
    const harness = createHarness();
    harness.resetCooldown.mockResolvedValueOnce(
      response as Awaited<ReturnType<typeof authFilesApi.resetCooldown>>
    );

    await expect(harness.run()).rejects.toThrow();
    expect(harness.refresh).not.toHaveBeenCalled();
    expect(useQuotaStore.getState().codexPendingResets[harness.target.name]?.phase).toBe(
      'cooldown_pending'
    );

    await harness.run();
    expect(harness.consume).toHaveBeenCalledTimes(1);
    expect(harness.resetCooldown).toHaveBeenCalledTimes(2);
  });

  test('does not consume when the initial credential check fails', async () => {
    const harness = createHarness();
    harness.list.mockRejectedValueOnce(new Error('credentials unavailable'));

    await expect(harness.run()).rejects.toThrow();
    expect(harness.consume).not.toHaveBeenCalled();
    expect(harness.resetCooldown).not.toHaveBeenCalled();
    expect(harness.refresh).not.toHaveBeenCalled();
  });

  test('keeps cooldown recovery when the post-consume identity lookup fails', async () => {
    const harness = createHarness();
    harness.list
      .mockResolvedValueOnce({ files: [harness.target] })
      .mockRejectedValueOnce(new Error('credentials unavailable'));

    await expect(harness.run()).rejects.toThrow();
    expect(harness.consume).toHaveBeenCalledTimes(1);
    expect(harness.resetCooldown).not.toHaveBeenCalled();
    expect(useQuotaStore.getState().codexPendingResets[harness.target.name]?.phase).toBe(
      'cooldown_pending'
    );

    await harness.run();
    expect(harness.consume).toHaveBeenCalledTimes(1);
    expect(harness.resetCooldown).toHaveBeenCalledTimes(1);
  });

  test('blocks concurrent operations for the same credential', async () => {
    const harness = createHarness();
    const consuming = deferred<void>();
    const entered = deferred<void>();
    harness.consume.mockImplementation(async () => {
      entered.resolve();
      await consuming.promise;
    });
    const first = harness.run();
    await entered.promise;

    await expect(harness.run()).rejects.toThrow();
    expect(harness.consume).toHaveBeenCalledTimes(1);

    consuming.resolve();
    await first;
    expect(harness.resetCooldown).toHaveBeenCalledTimes(1);
  });
});

describe('Codex reset credential identity', () => {
  test('rejects a missing auth index before any API request or mutation', async () => {
    const harness = createHarness(file({ auth_index: undefined }));

    await expect(harness.run()).rejects.toThrow('codex_quota.missing_auth_index');
    expect(harness.list).not.toHaveBeenCalled();
    expect(harness.consume).not.toHaveBeenCalled();
    expect(harness.resetCooldown).not.toHaveBeenCalled();
  });

  test('identity distinguishes filename, auth index, and ChatGPT account', () => {
    const baseline = getCodexResetIdentity(file());
    expect(getCodexResetIdentity(file({ name: 'other.json' }))).not.toBe(baseline);
    expect(getCodexResetIdentity(file({ auth_index: 'other-index' }))).not.toBe(baseline);
    expect(
      getCodexResetIdentity(file({ id_token: { chatgpt_account_id: 'other-account' } }))
    ).not.toBe(baseline);
  });

  test.each([
    ['missing', []],
    ['disabled', [file({ disabled: true })]],
    ['different provider', [file({ provider: 'claude' })]],
    ['different auth index', [file({ auth_index: 'replacement-index' })]],
    ['different account', [file({ id_token: { chatgpt_account_id: 'replacement-account' } })]],
    ['duplicate identity', [file(), file()]],
  ])('does not consume for a %s current credential', async (_label, currentFiles) => {
    const harness = createHarness();
    harness.list.mockResolvedValue({ files: currentFiles });

    await expect(harness.run()).rejects.toThrow();
    expect(harness.consume).not.toHaveBeenCalled();
    expect(harness.resetCooldown).not.toHaveBeenCalled();
  });

  test('does not clear a replacement credential after consuming for the original', async () => {
    const harness = createHarness();
    harness.list.mockResolvedValueOnce({ files: [harness.target] }).mockResolvedValueOnce({
      files: [file({ id_token: { chatgpt_account_id: 'replacement-account' } })],
    });

    await expect(harness.run()).rejects.toThrow();
    expect(harness.consume).toHaveBeenCalledTimes(1);
    expect(harness.resetCooldown).not.toHaveBeenCalled();
    expect(harness.refresh).not.toHaveBeenCalled();
  });

  test('does not transfer pending recovery to another account or connection', async () => {
    const harness = createHarness();
    harness.resetCooldown.mockRejectedValueOnce(new Error('cooldown unavailable'));
    await expect(harness.run()).rejects.toThrow();
    const pending = useQuotaStore.getState().codexPendingResets[harness.target.name];

    expect(isCodexResetPending(harness.target, pending)).toBe(true);
    expect(isCodexResetPending(file({ auth_index: 'replacement-index' }), pending)).toBe(false);
    expect(
      isCodexResetPending(
        file({ id_token: { chatgpt_account_id: 'replacement-account' } }),
        pending
      )
    ).toBe(false);
    connectionRevision += 1;
    expect(isCodexResetPending(harness.target, pending)).toBe(false);
  });
});

describe('Codex reset provider integration', () => {
  const result = (statusCode: number, body: unknown = {}): ApiCallResult => ({
    statusCode,
    header: {},
    bodyText: JSON.stringify(body),
    body,
  });

  test('runs the real provider consume request before cooldown and preserves zero-card retry', async () => {
    const harness = createHarness();
    const urls: string[] = [];
    apiCallApi.request = async (request) => {
      urls.push(request.url);
      if (request.url === CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL) {
        harness.events.push('consume');
        expect(request.method).toBe('POST');
        expect(request.authIndex).toBe('idx');
        expect(request.header?.['Chatgpt-Account-Id']).toBe('account-1');
        expect(JSON.parse(request.data!).redeem_request_id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        );
        return result(200);
      }
      if (request.url === CODEX_USAGE_URL) {
        harness.events.push('usage');
        return result(200, {
          plan_type: 'pro',
          rate_limit: { allowed: true, limit_reached: false },
          rate_limit_reset_credits: { available_count: 0, applicable_available_count: 0 },
        });
      }
      if (request.url === CODEX_RATE_LIMIT_RESET_CREDITS_URL) {
        return result(200, { available_count: 0, credits: [] });
      }
      if (request.url.startsWith(CODEX_SUBSCRIPTION_URL)) return result(200);
      throw new Error(`Unexpected API call: ${request.url}`);
    };
    harness.resetCooldown.mockRejectedValueOnce(new Error('cooldown unavailable'));
    await expect(CODEX_CONFIG.resetQuota!(harness.target, t)).rejects.toThrow();

    // An ordinary refresh may now report no cards; the successful redemption still needs recovery.
    const refreshed = await CODEX_CONFIG.fetchQuota(harness.target, t);
    expect(refreshed.rateLimitResetCreditsAvailableCount).toBe(0);
    expect(
      isCodexResetPending(
        harness.target,
        useQuotaStore.getState().codexPendingResets[harness.target.name]
      )
    ).toBe(true);
    const recovered = await CODEX_CONFIG.resetQuota!(harness.target, t);

    expect(recovered.rateLimitResetCreditsAvailableCount).toBe(0);
    expect(urls.filter((url) => url === CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL)).toHaveLength(
      1
    );
    expect(harness.resetCooldown).toHaveBeenCalledTimes(2);
    expect(harness.events.lastIndexOf('cooldown:idx')).toBeLessThan(
      harness.events.lastIndexOf('usage')
    );
    expect(useQuotaStore.getState().codexPendingResets[harness.target.name]).toBeUndefined();
  });

  test('does not clear cooldown when the forwarded consume request is rejected', async () => {
    const harness = createHarness();
    apiCallApi.request = async (request) => {
      expect(request.url).toBe(CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL);
      return result(409, { error: { message: 'No applicable reset credits' } });
    };

    await expect(CODEX_CONFIG.resetQuota!(harness.target, t)).rejects.toThrow();
    expect(harness.resetCooldown).not.toHaveBeenCalled();
    expect(useQuotaStore.getState().codexPendingResets[harness.target.name]).toBeUndefined();
  });
});

describe('Codex reset session isolation', () => {
  test.each(['connection', 'session cache', 'credential cache'])(
    'stops before cooldown when the %s changes during consume',
    async (changed) => {
      const harness = createHarness();
      const consuming = deferred<void>();
      const entered = deferred<void>();
      harness.consume.mockImplementation(async () => {
        entered.resolve();
        await consuming.promise;
      });
      const operation = harness.run();
      await entered.promise;

      if (changed === 'connection') connectionRevision += 1;
      else if (changed === 'session cache') useQuotaStore.getState().clearQuotaCache();
      else useQuotaStore.getState().clearQuotaCache([harness.target.name]);
      consuming.resolve();

      await expect(operation).rejects.toThrow();
      expect(harness.resetCooldown).not.toHaveBeenCalled();
      expect(harness.refresh).not.toHaveBeenCalled();
      expect(useQuotaStore.getState().codexPendingResets[harness.target.name]).toBeUndefined();
    }
  );

  test('stops before consume if the connection changes during credential lookup', async () => {
    const harness = createHarness();
    const lookup = deferred<{ files: AuthFileItem[] }>();
    harness.list.mockReturnValueOnce(lookup.promise);
    const operation = harness.run();
    connectionRevision += 1;
    lookup.resolve({ files: [harness.target] });

    await expect(operation).rejects.toThrow();
    expect(harness.consume).not.toHaveBeenCalled();
    expect(harness.resetCooldown).not.toHaveBeenCalled();
  });

  test('allows a reset to finish after an unrelated credential is invalidated', async () => {
    const harness = createHarness();
    harness.consume.mockImplementation(async () => {
      useQuotaStore.getState().clearQuotaCache(['unrelated.json']);
    });

    expect(await harness.run()).toBe(harness.refreshed);
    expect(harness.resetCooldown).toHaveBeenCalledTimes(1);
  });

  test('does not refresh or overwrite new-session pending state after an old cooldown completes', async () => {
    const harness = createHarness();
    const clearing = deferred<{ status: 'ok'; auth_index: string; models: string[] }>();
    const entered = deferred<void>();
    harness.resetCooldown.mockImplementation(async () => {
      entered.resolve();
      return clearing.promise;
    });
    const operation = harness.run();
    await entered.promise;
    useQuotaStore.getState().clearQuotaCache();
    connectionRevision += 1;
    const newPending = {
      identity: getCodexResetIdentity(harness.target),
      connectionRevision,
      phase: 'cooldown_pending' as const,
    };
    useQuotaStore.setState({ codexPendingResets: { [harness.target.name]: newPending } });
    clearing.resolve({ status: 'ok', auth_index: 'idx', models: [] });

    await expect(operation).rejects.toThrow();
    expect(harness.refresh).not.toHaveBeenCalled();
    expect(useQuotaStore.getState().codexPendingResets[harness.target.name]).toBe(newPending);
  });

  test('does not remove new-session pending state when an old refresh completes', async () => {
    const harness = createHarness();
    const refreshing = deferred<typeof harness.refreshed>();
    const entered = deferred<void>();
    harness.refresh.mockImplementation(async () => {
      entered.resolve();
      return refreshing.promise;
    });
    const operation = harness.run();
    await entered.promise;
    useQuotaStore.getState().clearQuotaCache();
    connectionRevision += 1;
    const newPending = {
      identity: getCodexResetIdentity(harness.target),
      connectionRevision,
      phase: 'cooldown_pending' as const,
    };
    useQuotaStore.setState({ codexPendingResets: { [harness.target.name]: newPending } });
    refreshing.resolve(harness.refreshed);

    await expect(operation).rejects.toThrow();
    expect(useQuotaStore.getState().codexPendingResets[harness.target.name]).toBe(newPending);
  });

  test('clears only the invalidated credential recovery, then clears all on logout', async () => {
    const harness = createHarness();
    harness.resetCooldown.mockRejectedValueOnce(new Error('cooldown unavailable'));
    await expect(harness.run()).rejects.toThrow();
    const pending = useQuotaStore.getState().codexPendingResets[harness.target.name]!;
    const otherFile = file({ name: 'other.json', auth_index: 'other-index' });
    const otherPending = { ...pending, identity: getCodexResetIdentity(otherFile) };
    useQuotaStore.setState({
      codexPendingResets: { [harness.target.name]: pending, [otherFile.name]: otherPending },
    });

    useQuotaStore.getState().clearQuotaCache([harness.target.name]);
    expect(useQuotaStore.getState().codexPendingResets).toEqual({
      [otherFile.name]: otherPending,
    });
    useQuotaStore.getState().clearQuotaCache();
    expect(useQuotaStore.getState().codexPendingResets).toEqual({});
  });
});
