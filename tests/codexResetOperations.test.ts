import { describe, expect, test } from 'bun:test';
import {
  CODEX_RESET_STORAGE_PREFIX,
  CodexResetStorageError,
  codexResetKey,
  createCodexResetStore,
  useCodexResetStore,
  type CodexResetOperation,
  type CodexResetPhase,
  type ResetLease,
} from '@/features/quota/providers/codex/resetOperations';
import { useQuotaStore } from '@/stores/useQuotaStore';
import { CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL } from '@/utils/quota';

class JournalStorage implements Storage {
  values = new Map<string, string>();
  failWrites = false;
  failRemovals = false;
  writes = 0;
  removals = 0;

  get length() {
    return this.values.size;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.writes += 1;
    if (this.failWrites) throw new Error('session storage full');
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.removals += 1;
    if (this.failRemovals) throw new Error('session storage inaccessible');
    this.values.delete(key);
  }

  clear() {
    this.values.clear();
  }
}

const operation = (patch: Partial<CodexResetOperation> = {}): CodexResetOperation => ({
  version: 1,
  scope: 'connection-scope-1',
  accountId: 'account-1',
  operationId: 'redeem-1',
  credential: { name: 'codex.json', authIndex: 'idx-1', accountId: 'account-1' },
  intent: {
    authIndex: 'idx-1',
    method: 'POST',
    url: CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
    header: { Authorization: 'Bearer $TOKEN$', 'Chatgpt-Account-Id': 'account-1' },
    data: JSON.stringify({ redeem_request_id: 'redeem-1' }),
  },
  phase: 'consume_pending',
  attemptId: 'original-attempt',
  createdAt: 1_000,
  lastAttemptAt: 1_100,
  ...patch,
});

const keyOf = (record: CodexResetOperation) => codexResetKey(record.scope, record.accountId);
const storageKeyOf = (record: CodexResetOperation) => CODEX_RESET_STORAGE_PREFIX + keyOf(record);

const persisted = (storage: JournalStorage, record: CodexResetOperation) => {
  const value = storage.getItem(storageKeyOf(record));
  return value === null ? undefined : (JSON.parse(value) as CodexResetOperation);
};

const seed = (storage: JournalStorage, record: CodexResetOperation) => {
  storage.setItem(storageKeyOf(record), JSON.stringify(record));
};

const running = (phase: CodexResetPhase = 'consume_pending') => {
  const storage = new JournalStorage();
  const store = createCodexResetStore(storage);
  const initial = operation({ phase });
  const key = keyOf(initial);
  const attemptId = store.getState().acquire(key)!;
  const record = { ...initial, attemptId };
  store.getState().createOperation(record, attemptId);
  const lease: ResetLease = { key, operationId: record.operationId, attemptId };
  return { storage, store, record, key, lease };
};

describe('Codex reset journal loading', () => {
  test('finishes loading synchronously and recovers interrupted consume with its full intent', () => {
    const storage = new JournalStorage();
    const record = operation({ pause: 'credential_changed' });
    seed(storage, record);
    storage.setItem('unrelated-preference', 'not JSON');

    const store = createCodexResetStore(storage);
    const loaded = store.getState();

    expect(loaded.ready).toBe(true);
    expect(loaded.blockedAll).toBe(false);
    expect(loaded.busy).toEqual({});
    expect(loaded.records[keyOf(record)]).toEqual({ ...record, phase: 'consume_unknown' });
    expect(persisted(storage, record)).toEqual({ ...record, phase: 'consume_unknown' });
  });

  test('does not acquire execution before storage has been initialized', () => {
    const store = createCodexResetStore();
    expect(store.getState().ready).toBe(false);
    expect(store.getState().acquire(keyOf(operation()))).toBeUndefined();
    store.getState().initialize(new JournalStorage());
    expect(store.getState().ready).toBe(true);
    expect(store.getState().acquire(keyOf(operation()))).toBeString();
  });

  test.each(['no_credit', 'nothing_to_reset', 'completed'] as const)(
    'reads the %s terminal marker before recovering an interrupted consume',
    (terminal) => {
      const storage = new JournalStorage();
      const record = operation({ terminal });
      seed(storage, record);
      const writes = storage.writes;

      const store = createCodexResetStore(storage);

      expect(store.getState().records[keyOf(record)]).toEqual(record);
      expect(storage.writes).toBe(writes);
      expect(store.getState().mergeSuccess(record)).toBe(false);
    }
  );

  test.each(['consume_unknown', 'cooldown_pending', 'refresh_pending'] as const)(
    'preserves a saved %s phase',
    (phase) => {
      const storage = new JournalStorage();
      const record = operation({ phase });
      seed(storage, record);
      expect(createCodexResetStore(storage).getState().records[keyOf(record)]).toEqual(record);
    }
  );

  test('keeps unknown recovery in memory when its hydration write fails', () => {
    const storage = new JournalStorage();
    const record = operation();
    seed(storage, record);
    storage.failWrites = true;

    const state = createCodexResetStore(storage).getState();

    expect(state.ready).toBe(true);
    expect(state.records[keyOf(record)]?.phase).toBe('consume_unknown');
    expect(state.storageErrors[keyOf(record)]).toBe(true);
    expect(persisted(storage, record)?.phase).toBe('consume_pending');
  });

  test.each([
    ['malformed JSON', '{'],
    ['unknown version', JSON.stringify(operation({ version: 2 as 1 }))],
    ['missing credential', JSON.stringify({ ...operation(), credential: undefined })],
    [
      'wrong request ID',
      JSON.stringify({
        ...operation(),
        intent: { ...operation().intent, data: '{"redeem_request_id":"different-id"}' },
      }),
    ],
  ])('blocks only the identifiable account for %s', (_label, value) => {
    const storage = new JournalStorage();
    const record = operation();
    storage.setItem(storageKeyOf(record), value);

    const state = createCodexResetStore(storage).getState();

    expect(state.ready).toBe(true);
    expect(state.blockedAll).toBe(false);
    expect(state.blockedAccounts).toEqual({ [keyOf(record)]: true });
    expect(state.acquire(keyOf(record))).toBeUndefined();
    expect(state.acquire(codexResetKey(record.scope, 'unaffected-account'))).toBeString();
  });

  test('blocks all resets if a damaged journal has no identifiable account', () => {
    const storage = new JournalStorage();
    storage.setItem(CODEX_RESET_STORAGE_PREFIX + 'broken-identity', '{');
    const state = createCodexResetStore(storage).getState();
    expect(state.ready).toBe(true);
    expect(state.blockedAll).toBe(true);
    expect(state.acquire(keyOf(operation()))).toBeUndefined();
  });

  test('identifies a damaged journal account from its payload when the storage key is corrupt', () => {
    const storage = new JournalStorage();
    const record = operation();
    storage.setItem(CODEX_RESET_STORAGE_PREFIX + 'broken-key', JSON.stringify(record));

    const state = createCodexResetStore(storage).getState();

    expect(state.blockedAll).toBe(false);
    expect(state.records).toEqual({});
    expect(state.blockedAccounts[keyOf(record)]).toBe(true);
    expect(state.acquire(keyOf(record))).toBeUndefined();
    expect(state.acquire(codexResetKey(record.scope, 'unaffected-account'))).toBeString();
  });

  test('blocks both candidate accounts when the journal key and payload identities conflict', () => {
    const storage = new JournalStorage();
    const record = operation();
    const otherKey = codexResetKey(record.scope, 'other-account');
    storage.setItem(CODEX_RESET_STORAGE_PREFIX + otherKey, JSON.stringify(record));

    const state = createCodexResetStore(storage).getState();

    expect(state.blockedAll).toBe(false);
    expect(state.records).toEqual({});
    expect(state.blockedAccounts).toEqual({ [keyOf(record)]: true, [otherKey]: true });
    expect(state.acquire(keyOf(record))).toBeUndefined();
    expect(state.acquire(otherKey)).toBeUndefined();
  });
});

describe('Codex reset journal storage failures', () => {
  test('a failed storage probe cleanup cannot become a corrupt operation on reload', () => {
    const storage = new JournalStorage();
    const store = createCodexResetStore(storage);
    storage.failRemovals = true;

    expect(() => store.getState().flush(keyOf(operation()))).toThrow(CodexResetStorageError);
    expect(store.getState().storageErrors[keyOf(operation())]).toBe(true);

    const reloaded = createCodexResetStore(storage).getState();
    expect(reloaded.blockedAll).toBe(false);
    expect(reloaded.blockedAccounts).toEqual({});
    expect(reloaded.records).toEqual({});
  });

  test('a failed initial write never creates an operation', () => {
    const storage = new JournalStorage();
    const store = createCodexResetStore(storage);
    const record = operation();
    const key = keyOf(record);
    const attemptId = store.getState().acquire(key)!;
    storage.failWrites = true;

    expect(() => store.getState().createOperation({ ...record, attemptId }, attemptId)).toThrow(
      CodexResetStorageError
    );
    expect(store.getState().records[key]).toBeUndefined();
    expect(persisted(storage, record)).toBeUndefined();
    expect(store.getState().storageErrors[key]).toBe(true);
    // The caller keeps the execution lock until its operation's finally block.
    expect(store.getState().busy[key]).toBe(attemptId);
  });

  test('a failed success write preserves the success fact and prevents a replacement operation', () => {
    const { storage, store, record, key, lease } = running();
    storage.failWrites = true;

    expect(() => store.getState().mergeSuccess(record)).toThrow(CodexResetStorageError);
    expect(store.getState().records[key]?.phase).toBe('cooldown_pending');
    expect(store.getState().storageErrors[key]).toBe(true);
    expect(persisted(storage, record)?.phase).toBe('consume_pending');
    store.getState().release(key, lease.attemptId);
    const nextAttempt = store.getState().acquire(key)!;
    expect(() =>
      store.getState().createOperation(operation({ operationId: 'replacement' }), nextAttempt)
    ).toThrow();

    // After reload, only the last durable record survives, retaining the original request ID.
    const reloaded = createCodexResetStore(storage).getState();
    expect(reloaded.records[key]?.phase).toBe('consume_unknown');
    expect(reloaded.records[key]?.intent).toEqual(record.intent);

    storage.failWrites = false;
    store.getState().flush(key);
    expect(persisted(storage, record)?.phase).toBe('cooldown_pending');
    expect(store.getState().storageErrors[key]).toBeUndefined();
  });

  test.each(['no_credit', 'nothing_to_reset', 'completed'] as const)(
    'a failed %s deletion reloads a terminal record for local cleanup',
    (terminal) => {
      const phase = terminal === 'completed' ? 'refresh_pending' : 'consume_unknown';
      const { storage, store, record, key, lease } = running(phase);
      expect(store.getState().transition(lease, phase, { terminal })).toBe(true);
      storage.failRemovals = true;

      expect(() => store.getState().remove(lease, phase)).toThrow(CodexResetStorageError);
      expect(store.getState().records[key]?.terminal).toBe(terminal);
      const reloaded = createCodexResetStore(storage);
      expect(reloaded.getState().records[key]?.terminal).toBe(terminal);
      expect(reloaded.getState().mergeSuccess(record)).toBe(false);

      const attemptId = reloaded.getState().acquire(key)!;
      const cleanupLease = { key, operationId: record.operationId, attemptId };
      storage.failRemovals = false;
      expect(reloaded.getState().remove(cleanupLease, phase)).toBe(true);
      expect(reloaded.getState().records[key]).toBeUndefined();
      expect(persisted(storage, record)).toBeUndefined();
    }
  );
});

describe('Codex reset execution leases and monotonic success', () => {
  test.each([
    ['consume_unknown', 'consume_pending'],
    ['cooldown_pending', 'consume_pending'],
    ['cooldown_pending', 'consume_unknown'],
    ['refresh_pending', 'consume_pending'],
    ['refresh_pending', 'consume_unknown'],
    ['refresh_pending', 'cooldown_pending'],
  ] as const)('the current lease cannot regress %s to %s', (phase, earlierPhase) => {
    const { storage, store, record, key, lease } = running(phase);
    const writes = storage.writes;

    expect(store.getState().transition(lease, phase, { phase: earlierPhase })).toBe(false);
    expect(store.getState().records[key]).toEqual(record);
    expect(persisted(storage, record)).toEqual(record);
    expect(storage.writes).toBe(writes);
  });

  test.each(['no_credit', 'nothing_to_reset', 'completed'] as const)(
    'the current lease cannot erase or overwrite a %s terminal record',
    (terminal) => {
      const phase = terminal === 'completed' ? 'refresh_pending' : 'consume_unknown';
      const { storage, store, record, key, lease } = running(phase);
      expect(store.getState().transition(lease, phase, { terminal })).toBe(true);
      const tombstone = store.getState().records[key];
      const writes = storage.writes;

      expect(store.getState().transition(lease, phase, { terminal: undefined })).toBe(false);
      expect(store.getState().transition(lease, phase, { terminal: 'no_credit' })).toBe(false);
      expect(store.getState().transition(lease, phase, { phase: 'cooldown_pending' })).toBe(false);
      expect(store.getState().transition(lease, phase, { pause: 'stale_request' })).toBe(false);
      expect(store.getState().records[key]).toEqual(tombstone);
      expect(persisted(storage, record)).toEqual(tombstone);
      expect(storage.writes).toBe(writes);
    }
  );

  test('keys execution by connection and account and ignores a stale release', () => {
    const { store, record, key, lease } = running();
    expect(store.getState().acquire(key)).toBeUndefined();
    expect(
      store.getState().acquire(codexResetKey('other-connection', record.accountId))
    ).toBeString();
    store.getState().release(key, 'stale-attempt');
    expect(store.getState().busy[key]).toBe(lease.attemptId);
    store.getState().release(key, lease.attemptId);
    const newAttempt = store.getState().acquire(key)!;
    expect(newAttempt).not.toBe(lease.attemptId);
    store.getState().release(key, lease.attemptId);
    expect(store.getState().busy[key]).toBe(newAttempt);
  });

  test('a second credential for the same account cannot replace an unfinished operation', () => {
    const { store, record, key, lease } = running('consume_unknown');
    store.getState().release(key, lease.attemptId);
    const attemptId = store.getState().acquire(key)!;
    const otherCredential = operation({
      operationId: 'another-redemption',
      credential: { ...record.credential, name: 'other.json', authIndex: 'other-index' },
      attemptId,
    });
    expect(() => store.getState().createOperation(otherCredential, attemptId)).toThrow();
    expect(store.getState().records[key]).toEqual(record);
  });

  test.each(['operation', 'attempt', 'phase'] as const)(
    'rejects updates and deletion when the expected %s does not match',
    (mismatch) => {
      const { storage, store, record, key, lease } = running('consume_unknown');
      const candidate = {
        ...lease,
        ...(mismatch === 'operation' ? { operationId: 'other-operation' } : {}),
        ...(mismatch === 'attempt' ? { attemptId: 'other-attempt' } : {}),
      };
      const phase = mismatch === 'phase' ? 'cooldown_pending' : 'consume_unknown';
      const writes = storage.writes;

      expect(store.getState().owns(candidate, phase)).toBe(false);
      expect(store.getState().transition(candidate, phase, { pause: 'stale_request' })).toBe(false);
      expect(store.getState().remove(candidate, phase)).toBe(false);
      expect(store.getState().records[key]).toEqual(record);
      expect(storage.writes).toBe(writes);
      expect(storage.removals).toBe(0);
    }
  );

  test('old success can merge its fact but cannot acquire the newer attempt execution', () => {
    const { store, record, key, lease: oldLease } = running('consume_unknown');
    store.getState().release(key, oldLease.attemptId);
    const attemptId = store.getState().acquire(key)!;
    const lease = { ...oldLease, attemptId };
    expect(store.getState().transition(lease, 'consume_unknown', {})).toBe(true);

    expect(store.getState().mergeSuccess(record)).toBe(true);
    expect(store.getState().records[key]?.phase).toBe('cooldown_pending');
    expect(store.getState().records[key]?.attemptId).toBe(attemptId);
    expect(store.getState().busy[key]).toBe(attemptId);
    expect(store.getState().owns(oldLease, 'cooldown_pending')).toBe(false);
    expect(
      store.getState().transition(oldLease, 'cooldown_pending', { phase: 'refresh_pending' })
    ).toBe(false);
    expect(store.getState().remove(oldLease, 'cooldown_pending')).toBe(false);

    // An old failure cannot erase the fact, even if it guesses the current phase.
    expect(
      store.getState().transition(oldLease, 'cooldown_pending', { phase: 'consume_unknown' })
    ).toBe(false);
    expect(store.getState().records[key]?.phase).toBe('cooldown_pending');
    expect(store.getState().owns(lease, 'cooldown_pending')).toBe(true);
  });

  test('a repeated old success never downgrades refresh back to cooldown', () => {
    const { storage, store, record, key, lease } = running();
    expect(store.getState().mergeSuccess(record)).toBe(true);
    expect(
      store.getState().transition(lease, 'cooldown_pending', { phase: 'refresh_pending' })
    ).toBe(true);
    const writes = storage.writes;
    expect(store.getState().mergeSuccess(record)).toBe(true);
    expect(store.getState().records[key]?.phase).toBe('refresh_pending');
    expect(persisted(storage, record)?.phase).toBe('refresh_pending');
    expect(storage.writes).toBe(writes);
  });

  test('neither late success nor late failure resurrects a deleted operation', () => {
    const { storage, store, record, key, lease } = running('consume_unknown');
    expect(store.getState().remove(lease, 'consume_unknown')).toBe(true);
    expect(store.getState().mergeSuccess(record)).toBe(false);
    expect(store.getState().transition(lease, 'consume_unknown', { pause: 'stale_request' })).toBe(
      false
    );
    expect(store.getState().records[key]).toBeUndefined();
    expect(persisted(storage, record)).toBeUndefined();
  });

  test.each(['authIndex', 'url', 'header', 'data'] as const)(
    'rejects a success whose complete request intent has a different %s',
    (field) => {
      const { store, record, key } = running('consume_unknown');
      const changed = {
        authIndex: { ...record.intent, authIndex: 'replacement-index' },
        url: { ...record.intent, url: 'https://example.invalid/consume' },
        header: { ...record.intent, header: { ...record.intent.header, 'User-Agent': 'changed' } },
        data: {
          ...record.intent,
          data: JSON.stringify({
            redeem_request_id: record.operationId,
            credit_id: 'different-credit',
          }),
        },
      }[field];

      expect(store.getState().mergeSuccess({ ...record, intent: changed })).toBe(false);
      expect(store.getState().records[key]?.phase).toBe('consume_unknown');
    }
  );

  test('quota invalidation preserves both the journal and the active account lock', () => {
    const storage = new JournalStorage();
    useCodexResetStore.getState().initialize(storage);
    const record = operation({ phase: 'consume_unknown' });
    const key = keyOf(record);
    const attemptId = useCodexResetStore.getState().acquire(key)!;
    const active = { ...record, attemptId };
    useCodexResetStore.getState().createOperation(active, attemptId);

    try {
      useQuotaStore.getState().clearQuotaCache([record.credential.name]);
      useQuotaStore.getState().clearQuotaCache();
      expect(useCodexResetStore.getState().records[key]).toEqual(active);
      expect(useCodexResetStore.getState().busy[key]).toBe(attemptId);
      expect(persisted(storage, record)).toEqual(active);
    } finally {
      useCodexResetStore.getState().initialize(new JournalStorage());
    }
  });
});
