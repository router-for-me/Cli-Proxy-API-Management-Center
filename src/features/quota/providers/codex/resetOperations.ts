import { create } from 'zustand';
import { createCodexResetRequestId, type CodexResetConsumeIntent } from './resetContract';
import { CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL } from '@/utils/quota';

export type CodexResetPhase =
  'consume_pending' | 'consume_unknown' | 'cooldown_pending' | 'refresh_pending';
export type CodexResetPause = 'credential_changed' | 'stale_request';
export interface CodexResetOperation {
  version: 1;
  scope: string;
  accountId: string;
  operationId: string;
  credential: { name: string; authIndex: string; accountId: string };
  intent: CodexResetConsumeIntent;
  phase: CodexResetPhase;
  pause?: CodexResetPause;
  attemptId: string;
  createdAt: number;
  lastAttemptAt: number;
  terminal?: 'no_credit' | 'nothing_to_reset' | 'completed';
}
export interface ResetLease {
  key: string;
  operationId: string;
  attemptId: string;
}
export const CODEX_RESET_STORAGE_PREFIX = 'codex-reset-operation:v1:';
export const codexResetKey = (scope: string, accountId: string): string =>
  JSON.stringify([scope, accountId]);
export class CodexResetStorageError extends Error {
  constructor() {
    super('codex_quota.reset_storage_error');
    this.name = 'CodexResetStorageError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const parseKey = (key: string): [string, string] | null => {
  try {
    const value: unknown = JSON.parse(key);
    return Array.isArray(value) && value.length === 2 && value.every(nonempty)
      ? (value as [string, string])
      : null;
  } catch {
    return null;
  }
};
const validOperation = (value: unknown, key: string): value is CodexResetOperation => {
  if (!isRecord(value) || !isRecord(value.credential) || !isRecord(value.intent)) return false;
  const { credential, intent } = value;
  if (
    value.version !== 1 ||
    !nonempty(value.scope) ||
    !nonempty(value.accountId) ||
    !nonempty(value.operationId) ||
    key !== codexResetKey(value.scope, value.accountId) ||
    !nonempty(credential.name) ||
    !nonempty(credential.authIndex) ||
    credential.accountId !== value.accountId ||
    intent.authIndex !== credential.authIndex ||
    intent.method !== 'POST' ||
    intent.url !== CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL ||
    !isRecord(intent.header) ||
    intent.header['Chatgpt-Account-Id'] !== value.accountId ||
    intent.header.Authorization !== 'Bearer $TOKEN$' ||
    !Object.values(intent.header).every((entry) => typeof entry === 'string') ||
    typeof intent.data !== 'string' ||
    !['consume_pending', 'consume_unknown', 'cooldown_pending', 'refresh_pending'].includes(
      String(value.phase)
    ) ||
    !nonempty(value.attemptId) ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    typeof value.lastAttemptAt !== 'number' ||
    !Number.isFinite(value.lastAttemptAt) ||
    (value.pause !== undefined &&
      !['credential_changed', 'stale_request'].includes(String(value.pause))) ||
    (value.terminal !== undefined &&
      !['no_credit', 'nothing_to_reset', 'completed'].includes(String(value.terminal)))
  )
    return false;
  try {
    const body: unknown = JSON.parse(intent.data);
    return isRecord(body) && body.redeem_request_id === value.operationId;
  } catch {
    return false;
  }
};

export interface CodexResetState {
  ready: boolean;
  records: Record<string, CodexResetOperation>;
  busy: Record<string, string>;
  blockedAll: boolean;
  blockedAccounts: Record<string, boolean>;
  storageErrors: Record<string, boolean>;
  initialize: (storage?: Storage) => void;
  acquire: (key: string) => string | undefined;
  release: (key: string, attemptId: string) => void;
  createOperation: (operation: CodexResetOperation, attemptId: string) => void;
  owns: (lease: ResetLease, phase: CodexResetPhase) => boolean;
  transition: (
    lease: ResetLease,
    phase: CodexResetPhase,
    patch: Partial<Pick<CodexResetOperation, 'phase' | 'pause' | 'terminal'>>
  ) => boolean;
  mergeSuccess: (operation: CodexResetOperation) => boolean;
  remove: (lease: ResetLease, phase: CodexResetPhase) => boolean;
  flush: (key: string) => void;
}

/** The journal is independent of quota invalidation. Only this tab's page session owns it. */
export function createCodexResetStore(initialStorage?: Storage) {
  let storage: Storage | undefined;
  const store = create<CodexResetState>((set, get) => {
    const failed = (key: string): never => {
      set((state) => ({ storageErrors: { ...state.storageErrors, [key]: true } }));
      throw new CodexResetStorageError();
    };
    const clearError = (key: string) =>
      set((state) => {
        const storageErrors = { ...state.storageErrors };
        delete storageErrors[key];
        return { storageErrors };
      });
    const save = (key: string, operation: CodexResetOperation) => {
      try {
        if (!storage) throw new Error('Session storage unavailable');
        storage.setItem(CODEX_RESET_STORAGE_PREFIX + key, JSON.stringify(operation));
      } catch {
        failed(key);
      }
      clearError(key);
    };
    const remember = (key: string, operation: CodexResetOperation) => {
      // Keep confirmed facts in memory even if persistence fails.
      set((state) => ({ records: { ...state.records, [key]: operation } }));
      save(key, operation);
    };
    return {
      ready: false,
      records: {},
      busy: {},
      blockedAll: false,
      blockedAccounts: {},
      storageErrors: {},
      initialize: (providedStorage) => {
        const records: Record<string, CodexResetOperation> = {};
        const blockedAccounts: Record<string, boolean> = {};
        const storageErrors: Record<string, boolean> = {};
        let blockedAll = false;
        try {
          storage = providedStorage ?? globalThis.sessionStorage;
          if (!storage) throw new Error('Session storage unavailable');
          for (let index = 0; index < storage.length; index += 1) {
            const storageKey = storage.key(index);
            if (!storageKey?.startsWith(CODEX_RESET_STORAGE_PREFIX)) continue;
            const key = storageKey.slice(CODEX_RESET_STORAGE_PREFIX.length);
            const identity = parseKey(key);
            let value: unknown;
            try {
              value = JSON.parse(storage.getItem(storageKey) ?? 'null');
              if (!validOperation(value, key)) throw new Error('Invalid journal');
              // A tombstone takes precedence over recovery of an interrupted consume.
              const operation: CodexResetOperation =
                !value.terminal && value.phase === 'consume_pending'
                  ? { ...value, phase: 'consume_unknown' }
                  : value;
              records[key] = operation;
              if (operation !== value) {
                try {
                  storage.setItem(storageKey, JSON.stringify(operation));
                } catch {
                  storageErrors[key] = true;
                }
              }
            } catch {
              let identified = false;
              if (identity) {
                blockedAccounts[key] = true;
                identified = true;
              }
              if (isRecord(value) && nonempty(value.scope)) {
                const credential = isRecord(value.credential) ? value.credential : {};
                const intent = isRecord(value.intent) ? value.intent : {};
                const header = isRecord(intent.header) ? intent.header : {};
                for (const accountId of [
                  value.accountId,
                  credential.accountId,
                  header['Chatgpt-Account-Id'],
                ]) {
                  if (nonempty(accountId)) {
                    blockedAccounts[codexResetKey(value.scope, accountId)] = true;
                    identified = true;
                  }
                }
              }
              if (!identified) blockedAll = true;
            }
          }
        } catch {
          blockedAll = true;
        }
        set({ ready: true, records, busy: {}, blockedAll, blockedAccounts, storageErrors });
      },
      acquire: (key) => {
        const state = get();
        if (!state.ready || state.blockedAll || state.blockedAccounts[key] || state.busy[key])
          return;
        const attemptId = createCodexResetRequestId();
        set({ busy: { ...state.busy, [key]: attemptId } });
        return attemptId;
      },
      release: (key, attemptId) => {
        if (get().busy[key] !== attemptId) return;
        const busy = { ...get().busy };
        delete busy[key];
        set({ busy });
      },
      createOperation: (operation, attemptId) => {
        const key = codexResetKey(operation.scope, operation.accountId);
        if (get().records[key] || get().busy[key] !== attemptId)
          throw new Error('Reset already exists');
        // No consume may be dispatched before this synchronous write succeeds.
        save(key, operation);
        set((state) => ({ records: { ...state.records, [key]: operation } }));
      },
      owns: (lease, phase) => {
        const state = get();
        return (
          state.busy[lease.key] === lease.attemptId &&
          state.records[lease.key]?.operationId === lease.operationId &&
          state.records[lease.key]?.phase === phase
        );
      },
      transition: (lease, phase, patch) => {
        if (!get().owns(lease, phase)) return false;
        const current = get().records[lease.key];
        if (current.terminal) return false;
        const allowed: Record<CodexResetPhase, CodexResetPhase[]> = {
          consume_pending: ['consume_pending', 'consume_unknown'],
          consume_unknown: ['consume_unknown'],
          cooldown_pending: ['cooldown_pending', 'refresh_pending'],
          refresh_pending: ['refresh_pending'],
        };
        if (patch.phase && !allowed[current.phase].includes(patch.phase)) return false;
        remember(lease.key, {
          ...current,
          ...patch,
          attemptId: lease.attemptId,
          lastAttemptAt: Date.now(),
        });
        return true;
      },
      mergeSuccess: (operation) => {
        const key = codexResetKey(operation.scope, operation.accountId);
        const current = get().records[key];
        if (
          !current ||
          current.operationId !== operation.operationId ||
          current.terminal ||
          JSON.stringify(current.intent) !== JSON.stringify(operation.intent)
        )
          return false;
        if (current.phase === 'cooldown_pending' || current.phase === 'refresh_pending')
          return true;
        // Success is a monotonic fact, not a lease to execute the next step.
        remember(key, { ...current, phase: 'cooldown_pending' });
        return true;
      },
      remove: (lease, phase) => {
        if (!get().owns(lease, phase)) return false;
        try {
          if (!storage) throw new Error('Session storage unavailable');
          storage.removeItem(CODEX_RESET_STORAGE_PREFIX + lease.key);
        } catch {
          failed(lease.key);
        }
        const records = { ...get().records };
        delete records[lease.key];
        set({ records });
        clearError(lease.key);
        return true;
      },
      flush: (key) => {
        const record = get().records[key];
        if (record) save(key, record);
        else {
          // Verify storage is writable without discarding any recovery record.
          const probe = 'codex-reset-storage-probe';
          try {
            if (!storage) throw new Error('Session storage unavailable');
            storage.setItem(probe, '1');
            storage.removeItem(probe);
          } catch {
            failed(key);
          }
          clearError(key);
        }
      },
    };
  });
  // Hydrate synchronously before any reset action can be shown. SSR stays unready.
  if (initialStorage || typeof window !== 'undefined') store.getState().initialize(initialStorage);
  return store;
}
export const useCodexResetStore = createCodexResetStore();
