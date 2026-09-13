import { describe, expect, test } from 'bun:test';
import {
  createDevinQuotaFetcher,
  DevinQuotaError,
  type DevinRequestGeneration,
} from '@/features/quota/providers/devin/requests';
import type { AuthFileItem, DevinQuotaData } from '@/types';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const observedAt = (second: number) => `2026-05-01T00:00:${String(second).padStart(2, '0')}Z`;

const devinFile = (
  name: string,
  authIndex: string | number,
  second: number,
  extra: Record<string, unknown> = {}
): AuthFileItem => ({
  name,
  provider: 'devin',
  authIndex,
  quota: {
    observed_at: observedAt(second),
    signals: {
      daily_quota_remaining_percent: '40%',
      daily_quota_reset_at: '2026-05-02T00:00:00Z',
      weekly_quota_remaining_percent: 75,
      weekly_quota_reset_at: '2026-05-08T00:00:00Z',
      plan: 'pro',
    },
  },
  ...extra,
});

const expectCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    throw new Error('expected request to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(DevinQuotaError);
    expect((error as DevinQuotaError).code).toBe(code);
  }
};

const stableGeneration = (): DevinRequestGeneration => ({ session: 1, file: 1 });

describe('createDevinQuotaFetcher', () => {
  test('performs targeted POST then GET and returns only normalized quota data', async () => {
    const calls: Array<{ operation: string; target: unknown }> = [];
    const secret = 'raw-refresh-credential';
    const fetchQuota = createDevinQuotaFetcher({
      refresh: async (target) => {
        calls.push({ operation: 'refresh', target });
        // The credential-bearing response is deliberately unavailable at this boundary.
        return undefined;
      },
      list: async (target) => {
        calls.push({ operation: 'list', target });
        return {
          files: [
            devinFile(' account.json ', 'wrong', 2),
            devinFile('account.json', 7, 2, {
              access_token: secret,
              refresh_token: secret,
              account: secret,
              metadata: { api_key: secret },
            }),
          ],
        };
      },
      generation: stableGeneration,
    });

    const result = await fetchQuota(devinFile(' account.json ', ' 7 ', 1));

    expect(calls).toEqual([
      { operation: 'refresh', target: { name: 'account.json', authIndex: '7' } },
      { operation: 'list', target: { name: 'account.json', authIndex: '7' } },
    ]);
    expect(result).toEqual<DevinQuotaData>({
      windows: [
        {
          id: 'daily',
          remainingPercent: 40,
          resetAtMs: Date.parse('2026-05-02T00:00:00Z'),
          periodHours: 24,
        },
        {
          id: 'weekly',
          remainingPercent: 75,
          resetAtMs: Date.parse('2026-05-08T00:00:00Z'),
          periodHours: 168,
        },
      ],
      observedAtMs: Date.parse(observedAt(2)),
      plan: 'pro',
      planStartMs: null,
      planEndMs: null,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  test('requires a newer observation on repeated refreshes even with an old list entry', async () => {
    let calls = 0;
    let nextSecond = 2;
    let session = 1;
    const fetchQuota = createDevinQuotaFetcher({
      refresh: async () => {
        calls += 1;
      },
      list: async () => ({ files: [devinFile('account.json', '7', nextSecond)] }),
      generation: () => ({ session, file: 0 }),
    });
    const original = devinFile('account.json', '7', 1);
    await fetchQuota(original);
    // Start again immediately after awaiting: completed work must no longer be deduplicated.
    await expectCode(fetchQuota(original), 'refresh_unconfirmed');
    expect(calls).toBe(2);
    nextSecond = 3;
    await fetchQuota(original);
    session = 2;
    nextSecond = 2;
    await fetchQuota(original);
    expect(calls).toBe(4);
  });

  test('tracks observation freshness separately for same-name auth identities', async () => {
    const fetchQuota = createDevinQuotaFetcher({
      refresh: async () => {},
      list: async ({ authIndex }) => ({ files: [devinFile('shared.json', authIndex!, 2)] }),
      generation: stableGeneration,
    });
    const first = devinFile('shared.json', 'first', 1);
    const second = devinFile('shared.json', 'second', 1);
    await fetchQuota(first);
    await fetchQuota(second);
    await expectCode(fetchQuota(first), 'refresh_unconfirmed');
    await expectCode(fetchQuota(second), 'refresh_unconfirmed');
  });

  test('deduplicates the same target in the same generation', async () => {
    const refreshGate = deferred<void>();
    let refreshCalls = 0;
    let listCalls = 0;
    const fetchQuota = createDevinQuotaFetcher({
      refresh: () => {
        refreshCalls += 1;
        return refreshGate.promise;
      },
      list: async () => {
        listCalls += 1;
        return { files: [devinFile('same.json', '3', 2)] };
      },
      generation: stableGeneration,
    });
    const file = devinFile('same.json', 3, 1);

    const first = fetchQuota(file);
    const second = fetchQuota({ ...file });
    expect(second).toBe(first);
    expect(refreshCalls).toBe(1);

    refreshGate.resolve(undefined);
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(secondResult);
    expect(listCalls).toBe(1);
  });

  test('limits upstream workflows to three concurrent targets', async () => {
    const gates = Array.from({ length: 5 }, () => deferred<void>());
    let started = 0;
    const fetchQuota = createDevinQuotaFetcher({
      refresh: () => gates[started++]!.promise,
      list: async ({ name, authIndex }) => ({ files: [devinFile(name, authIndex!, 2)] }),
      generation: stableGeneration,
    });

    const requests = Array.from({ length: 5 }, (_, index) =>
      fetchQuota(devinFile(`file-${index}.json`, String(index), 1))
    );
    expect(started).toBe(3);

    gates[0]!.resolve(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toBe(4);

    gates[1]!.resolve(undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toBe(5);

    gates[2]!.resolve(undefined);
    gates[3]!.resolve(undefined);
    gates[4]!.resolve(undefined);
    await Promise.all(requests);
  });

  test('does not let requests from an old session block a new connection', async () => {
    const oldGates = Array.from({ length: 3 }, () => deferred<void>());
    const started: string[] = [];
    let oldIndex = 0;
    const fetchQuota = createDevinQuotaFetcher({
      refresh: ({ name }) => {
        started.push(name);
        return name.startsWith('old-') ? oldGates[oldIndex++]!.promise : Promise.resolve();
      },
      list: async ({ name, authIndex }) => ({ files: [devinFile(name, authIndex!, 2)] }),
      generation: (name) => ({ session: name.startsWith('old-') ? 1 : 2, file: 0 }),
    });

    const oldRequests = Array.from({ length: 3 }, (_, index) =>
      fetchQuota(devinFile(`old-${index}.json`, String(index), 1))
    );
    const currentRequest = fetchQuota(devinFile('current.json', 'current', 1));

    expect(started).toContain('current.json');
    await expect(currentRequest).resolves.toMatchObject({
      observedAtMs: Date.parse(observedAt(2)),
    });

    oldGates.forEach((gate) => gate.resolve(undefined));
    await Promise.all(oldRequests);
  });

  test('rejects a queued request whose file generation changed before it started', async () => {
    const blockers = Array.from({ length: 3 }, () => deferred<void>());
    const generations: Record<string, DevinRequestGeneration> = {};
    const refreshed: string[] = [];
    let blockerIndex = 0;
    const fetchQuota = createDevinQuotaFetcher({
      refresh: ({ name }) => {
        refreshed.push(name);
        return name.startsWith('block') ? blockers[blockerIndex++]!.promise : Promise.resolve();
      },
      list: async ({ name, authIndex }) => ({ files: [devinFile(name, authIndex!, 2)] }),
      generation: (name) => generations[name] ?? { session: 1, file: 1 },
    });

    const active = Array.from({ length: 3 }, (_, index) =>
      fetchQuota(devinFile(`block-${index}.json`, String(index), 1))
    );
    const queuedName = 'queued.json';
    const queued = fetchQuota(devinFile(queuedName, '9', 1));
    generations[queuedName] = { session: 1, file: 2 };
    blockers[0]!.resolve(undefined);

    await expectCode(queued, 'stale_request');
    expect(refreshed).not.toContain(queuedName);
    blockers[1]!.resolve(undefined);
    blockers[2]!.resolve(undefined);
    await Promise.all(active);
  });

  test('checks session generation after POST and file generation after GET', async () => {
    const postGate = deferred<void>();
    const afterPost = { session: 4, file: 8 };
    let listCalls = 0;
    const firstFetcher = createDevinQuotaFetcher({
      refresh: () => postGate.promise,
      list: async () => {
        listCalls += 1;
        return { files: [devinFile('post.json', '1', 2)] };
      },
      generation: () => ({ ...afterPost }),
    });
    const afterPostRequest = firstFetcher(devinFile('post.json', '1', 1));
    afterPost.session += 1;
    postGate.resolve(undefined);
    await expectCode(afterPostRequest, 'stale_request');
    expect(listCalls).toBe(0);

    const getGate = deferred<{ files: AuthFileItem[] }>();
    const afterGet = { session: 4, file: 8 };
    const secondFetcher = createDevinQuotaFetcher({
      refresh: async () => undefined,
      list: () => getGate.promise,
      generation: () => ({ ...afterGet }),
    });
    const afterGetRequest = secondFetcher(devinFile('get.json', '2', 1));
    afterGet.file += 1;
    getGate.resolve({ files: [devinFile('get.json', '2', 2)] });
    await expectCode(afterGetRequest, 'stale_request');
  });

  test('rejects missing identities and mismatched returned identity or provider', async () => {
    let refreshCalls = 0;
    const missingFetcher = createDevinQuotaFetcher({
      refresh: async () => {
        refreshCalls += 1;
      },
      list: async () => ({ files: [] }),
      generation: stableGeneration,
    });
    await expectCode(missingFetcher(devinFile(' ', '1', 1)), 'missing_identity');
    await expectCode(missingFetcher(devinFile('valid.json', ' ', 1)), 'missing_identity');
    expect(refreshCalls).toBe(0);

    const returnedFiles = [
      devinFile('other.json', '1', 2),
      devinFile('valid.json', '2', 2),
      { ...devinFile('valid.json', '1', 2), provider: 'codex' },
    ];
    const mismatchFetcher = createDevinQuotaFetcher({
      refresh: async () => undefined,
      list: async () => ({ files: returnedFiles }),
      generation: stableGeneration,
    });
    await expectCode(mismatchFetcher(devinFile('valid.json', '1', 1)), 'file_not_found');
  });

  test('rejects empty and stale timed observations but accepts issue 429 signals without time', async () => {
    const responses: AuthFileItem[][] = [
      [
        {
          name: 'empty.json',
          provider: 'devin',
          authIndex: '1',
          quota: { observed_at: observedAt(2), signals: {} },
        },
      ],
      [devinFile('old.json', '2', 1)],
      [
        {
          ...devinFile('missing-time.json', '3', 2),
          quota: {
            signals: { daily_quota_remaining_percent: 50 },
          },
        },
      ],
    ];
    let responseIndex = 0;
    const fetchQuota = createDevinQuotaFetcher({
      refresh: async () => undefined,
      list: async () => ({ files: responses[responseIndex++]! }),
      generation: stableGeneration,
    });

    await expectCode(fetchQuota(devinFile('empty.json', '1', 1)), 'empty_data');
    await expectCode(fetchQuota(devinFile('old.json', '2', 1)), 'refresh_unconfirmed');
    await expect(fetchQuota(devinFile('missing-time.json', '3', 1))).resolves.toMatchObject({
      observedAtMs: null,
      windows: [
        { id: 'daily', remainingPercent: 50 },
        { id: 'weekly', remainingPercent: null },
      ],
    });
  });

  test('propagates dependency failures and allows a failed target to retry', async () => {
    const failure = new Error('refresh exploded');
    let attempts = 0;
    const fetchQuota = createDevinQuotaFetcher({
      refresh: async () => {
        attempts += 1;
        if (attempts === 1) throw failure;
      },
      list: async ({ name, authIndex }) => ({ files: [devinFile(name, authIndex!, 2)] }),
      generation: stableGeneration,
    });
    const file = devinFile('retry.json', '1', 1);

    await expect(fetchQuota(file)).rejects.toBe(failure);
    await Promise.resolve();
    await expect(fetchQuota(file)).resolves.toMatchObject({
      observedAtMs: Date.parse(observedAt(2)),
    });
    expect(attempts).toBe(2);
  });

  test('ignores generation changes belonging to an unrelated file', async () => {
    const gate = deferred<void>();
    const generations: Record<string, DevinRequestGeneration> = {
      'target.json': { session: 3, file: 4 },
      'other.json': { session: 3, file: 7 },
    };
    const fetchQuota = createDevinQuotaFetcher({
      refresh: () => gate.promise,
      list: async ({ name, authIndex }) => ({ files: [devinFile(name, authIndex!, 2)] }),
      generation: (name) => generations[name]!,
    });

    const request = fetchQuota(devinFile('target.json', '5', 1));
    generations['other.json']!.file += 1;
    gate.resolve(undefined);

    await expect(request).resolves.toMatchObject({ observedAtMs: Date.parse(observedAt(2)) });
  });
});
