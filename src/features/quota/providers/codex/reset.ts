import type { TFunction } from 'i18next';
import type { AuthFileItem } from '@/types';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient, RequestNotSentError } from '@/services/api/client';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent } from '@/stores/useQuotaStore';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isCodexFile } from '@/utils/quota';
import { notifyAuthFileCooldownReset } from '@/features/authFiles/authFilesEvents';
import {
  buildCodexResetConsumeIntent,
  createCodexResetRequestId,
  getCodexResetAccountId,
  type CodexResetConsumeIntent,
  type CodexResetConsumeResult,
} from './resetContract';
import {
  codexResetKey,
  CodexResetStorageError,
  useCodexResetStore,
  type CodexResetOperation,
  type CodexResetState,
  type ResetLease,
} from './resetOperations';

export const getCodexResetIdentity = (file: AuthFileItem): string =>
  JSON.stringify([
    file.name,
    normalizeAuthIndex(file.auth_index ?? file.authIndex),
    getCodexResetAccountId(file),
  ]);
const operationIdentity = (operation: CodexResetOperation): string =>
  JSON.stringify([operation.credential.name, operation.credential.authIndex, operation.accountId]);

export interface CodexResetView {
  operation?: CodexResetOperation;
  busy: boolean;
  blocked: boolean;
  paused: boolean;
  action: 'new' | 'retry' | 'cooldown' | 'refresh' | 'recheck' | 'cleanup';
  reason?: string;
  reasonParams?: { name: string };
}
export function getCodexResetView(
  file: AuthFileItem,
  state: CodexResetState = useCodexResetStore.getState()
): CodexResetView {
  const accountId = getCodexResetAccountId(file);
  const key = codexResetKey(apiClient.getConnectionScope(), accountId ?? '');
  const operation = state.records[key];
  const view: CodexResetView = {
    operation,
    busy: Boolean(state.busy[key]),
    blocked: false,
    paused: false,
    action: 'new',
  };
  if (!state.ready || state.blockedAll || state.blockedAccounts[key] || !accountId) {
    return {
      ...view,
      blocked: true,
      reason: !state.ready
        ? 'codex_quota.reset_loading_record'
        : !accountId
          ? 'codex_quota.reset_missing_account_id'
          : 'codex_quota.reset_corrupt_record',
    };
  }
  if (operation?.terminal)
    return { ...view, action: 'cleanup', reason: 'codex_quota.reset_local_cleanup_required' };
  if (operation && operation.credential.name !== file.name) {
    return {
      ...view,
      blocked: true,
      paused: true,
      action: 'recheck',
      reason: 'codex_quota.reset_other_credential',
      reasonParams: { name: operation.credential.name },
    };
  }
  if (
    operation?.pause ||
    state.storageErrors[key] ||
    (operation && operationIdentity(operation) !== getCodexResetIdentity(file))
  ) {
    return {
      ...view,
      paused: true,
      action: 'recheck',
      reason: state.storageErrors[key]
        ? 'codex_quota.reset_storage_error'
        : operation?.pause === 'stale_request'
          ? 'codex_quota.reset_stale_request'
          : 'codex_quota.reset_credential_changed',
    };
  }
  if (operation)
    view.action =
      operation.phase === 'cooldown_pending'
        ? 'cooldown'
        : operation.phase === 'refresh_pending'
          ? 'refresh'
          : 'retry';
  return view;
}
export const isCodexResetPending = (file: AuthFileItem): boolean =>
  Boolean(getCodexResetView(file).operation);

class ResetPausedError extends Error {
  constructor(
    readonly reason: 'stale_request' | 'credential_changed',
    t: TFunction
  ) {
    super(t(`codex_quota.reset_${reason}`));
  }
}
const localizeStorageError = (error: unknown, t: TFunction): never => {
  if (error instanceof CodexResetStorageError) throw new Error(t(error.message));
  if (error instanceof RequestNotSentError) throw new Error(t('codex_quota.reset_stale_request'));
  throw error;
};
const contextFor = (file: AuthFileItem, t: TFunction, readOnly = false) => {
  const accountId = getCodexResetAccountId(file);
  if (!accountId) throw new Error(t('codex_quota.reset_missing_account_id'));
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  if (!authIndex) throw new Error(t('codex_quota.missing_auth_index'));
  const name = file.name;
  const identity = JSON.stringify([name, authIndex, accountId]);
  const credentialSnapshot: AuthFileItem = Object.freeze({
    name,
    auth_index: authIndex,
    chatgpt_account_id: accountId,
  });
  const scope = apiClient.getConnectionScope();
  const key = codexResetKey(scope, accountId);
  const revision = apiClient.getConnectionRevision();
  const generation = captureQuotaCacheGeneration(name);
  const assertCurrent = () => {
    if (
      revision !== apiClient.getConnectionRevision() ||
      !commitIfQuotaCacheCurrent(generation, () => {})
    )
      throw new ResetPausedError('stale_request', t);
    if ((!readOnly && file.disabled) || getCodexResetIdentity(file) !== identity) {
      throw new ResetPausedError('credential_changed', t);
    }
  };
  const verify = async (operation?: CodexResetOperation) => {
    assertCurrent();
    if (operation && operationIdentity(operation) !== identity) {
      throw new ResetPausedError('credential_changed', t);
    }
    const response = await authFilesApi.list(
      { name, authIndex },
      { expectedConnectionRevision: revision }
    );
    assertCurrent();
    const matches = response.files.filter((entry) => entry.name === name);
    if (
      matches.length !== 1 ||
      !isCodexFile(matches[0]) ||
      matches[0].disabled ||
      getCodexResetIdentity(matches[0]) !== identity
    ) {
      throw new ResetPausedError('credential_changed', t);
    }
  };
  return {
    accountId,
    authIndex,
    name,
    credentialSnapshot,
    scope,
    key,
    revision,
    assertCurrent,
    verify,
  };
};
const lock = (file: AuthFileItem, key: string, t: TFunction): string => {
  const view = getCodexResetView(file);
  if (view.busy) throw new Error(t('codex_quota.reset_in_progress'));
  if (view.blocked) throw new Error(t(view.reason!, view.reasonParams));
  const attemptId = useCodexResetStore.getState().acquire(key);
  if (!attemptId) throw new Error(t('codex_quota.reset_in_progress'));
  return attemptId;
};

/** Rechecking never consumes or clears cooldown. Resuming is a separate user action. */
export async function recheckCodexReset(file: AuthFileItem, t: TFunction): Promise<void> {
  const context = contextFor(file, t, true);
  const attemptId = lock(file, context.key, t);
  const store = useCodexResetStore.getState();
  try {
    const operation = store.records[context.key];
    if (operation?.terminal) return;
    await context.verify(operation);
    context.assertCurrent();
    if (operation) {
      store.transition(
        { key: context.key, operationId: operation.operationId, attemptId },
        operation.phase,
        { pause: undefined }
      );
    } else store.flush(context.key);
  } catch (error) {
    localizeStorageError(error, t);
  } finally {
    store.release(context.key, attemptId);
  }
}

/** Tombstones may only be removed locally, even after a reload or credential replacement. */
export async function cleanupCodexReset(file: AuthFileItem, t: TFunction): Promise<void> {
  const accountId = getCodexResetAccountId(file);
  if (!accountId) throw new Error(t('codex_quota.reset_missing_account_id'));
  const key = codexResetKey(apiClient.getConnectionScope(), accountId);
  const attemptId = lock(file, key, t);
  const store = useCodexResetStore.getState();
  try {
    const operation = store.records[key];
    if (operation?.terminal) {
      // Local cleanup requires only the account/scope, never a live credential or auth index.
      store.flush(key);
      store.remove({ key, operationId: operation.operationId, attemptId }, operation.phase);
    }
  } catch (error) {
    localizeStorageError(error, t);
  } finally {
    store.release(key, attemptId);
  }
}

/** Account lock spans the entire awaited consume, including a connection/cache switch. */
export async function runCodexQuotaReset<T>(
  file: AuthFileItem,
  t: TFunction,
  consume: (intent: CodexResetConsumeIntent, revision: number) => Promise<CodexResetConsumeResult>,
  refresh: (revision: number) => Promise<T>
): Promise<T> {
  const context = contextFor(file, t);
  const attemptId = lock(file, context.key, t);
  const store = useCodexResetStore.getState();
  let operation = store.records[context.key];
  let lease: ResetLease | undefined;
  const isNew = !operation;
  try {
    if (operation) lease = { key: context.key, operationId: operation.operationId, attemptId };
    if (operation?.terminal) throw new Error(t('codex_quota.reset_local_cleanup_required'));
    if (operation?.pause || store.storageErrors[context.key]) {
      throw new Error(t(getCodexResetView(file).reason ?? 'codex_quota.reset_storage_error'));
    }
    await context.verify(operation);
    context.assertCurrent();
    if (!operation) {
      const operationId = createCodexResetRequestId();
      operation = {
        version: 1,
        scope: context.scope,
        accountId: context.accountId,
        operationId,
        credential: {
          name: context.name,
          authIndex: context.authIndex,
          accountId: context.accountId,
        },
        intent: buildCodexResetConsumeIntent(context.credentialSnapshot, t, operationId),
        phase: 'consume_pending',
        attemptId,
        createdAt: Date.now(),
        lastAttemptAt: Date.now(),
      };
      lease = { key: context.key, operationId, attemptId };
      store.createOperation(operation, attemptId);
    }
    const currentLease = lease!;
    const assertOwns = (phase?: CodexResetOperation['phase']) => {
      context.assertCurrent();
      const current = useCodexResetStore.getState().records[context.key];
      if (
        !current ||
        !store.owns(currentLease, phase ?? current.phase) ||
        current.terminal ||
        current.pause
      ) {
        throw new ResetPausedError('stale_request', t);
      }
      return current;
    };
    // An old success may have merged while the credential lookup was awaiting.
    operation = assertOwns();
    if (operation.phase === 'consume_pending' || operation.phase === 'consume_unknown') {
      const phase = operation.phase;
      assertOwns(phase);
      let outcome: CodexResetConsumeResult;
      try {
        // Never race, cancel, or detach this promise: it owns the account lock until settlement.
        outcome = await consume(operation.intent, context.revision);
      } catch (error) {
        if (error instanceof RequestNotSentError) {
          if (isNew) {
            try {
              store.remove(currentLease, phase);
            } catch (storageError) {
              // The last persisted pending record is recoverable with its original ID.
              try {
                store.transition(currentLease, phase, { phase: 'consume_unknown' });
              } catch {
                /* Memory already contains the safe unknown phase. */
              }
              throw storageError;
            }
          }
          // A refused recovery does not change its original intent, phase or timestamps.
          throw error;
        }
        outcome = {
          outcome: 'unknown',
          message: error instanceof Error ? error.message : t('common.unknown_error'),
        };
      }
      if (outcome.outcome === 'success') {
        // Merge the irreversible fact before checking current execution authority.
        if (!store.mergeSuccess(operation)) throw new ResetPausedError('stale_request', t);
      } else if (outcome.outcome === 'terminal') {
        if (store.transition(currentLease, phase, { terminal: outcome.code })) {
          store.remove(currentLease, phase);
        }
        throw new Error(t(`codex_quota.reset_${outcome.code}`));
      } else {
        store.transition(currentLease, phase, { phase: 'consume_unknown' });
        throw new Error(t('codex_quota.reset_result_unknown', { message: outcome.message }));
      }
    }
    operation = assertOwns();
    if (operation.phase === 'cooldown_pending') {
      await context.verify(operation);
      assertOwns('cooldown_pending');
      const response = await authFilesApi.resetCooldown(context.authIndex, {
        expectedConnectionRevision: context.revision,
      });
      assertOwns();
      if (response.status !== 'ok' || response.auth_index !== context.authIndex) {
        throw new Error(t('codex_quota.reset_cooldown_failed'));
      }
      if (!store.transition(currentLease, 'cooldown_pending', { phase: 'refresh_pending' })) {
        throw new ResetPausedError('stale_request', t);
      }
      context.assertCurrent();
      notifyAuthFileCooldownReset();
    }
    assertOwns('refresh_pending');
    const result = await refresh(context.revision);
    assertOwns('refresh_pending');
    if (store.transition(currentLease, 'refresh_pending', { terminal: 'completed' })) {
      store.remove(currentLease, 'refresh_pending');
    }
    return result;
  } catch (error) {
    if (error instanceof ResetPausedError && lease) {
      const current = useCodexResetStore.getState().records[context.key];
      if (current && !current.terminal) {
        try {
          store.transition(lease, current.phase, { pause: error.reason });
        } catch (storageError) {
          localizeStorageError(storageError, t);
        }
      }
    }
    return localizeStorageError(error, t);
  } finally {
    store.release(context.key, attemptId);
  }
}
