import type { TFunction } from 'i18next';
import type { AuthFileItem } from '@/types';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
  type CodexPendingReset,
} from '@/stores/useQuotaStore';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { isCodexFile, resolveCodexChatgptAccountId } from '@/utils/quota';
import { notifyAuthFileCooldownReset } from '@/features/authFiles/authFilesEvents';

export const getCodexResetIdentity = (file: AuthFileItem): string =>
  JSON.stringify([
    file.name,
    normalizeAuthIndex(file.auth_index ?? file.authIndex),
    resolveCodexChatgptAccountId(file) ?? file.email ?? null,
  ]);

export const isCodexResetPending = (
  file: AuthFileItem,
  pending: CodexPendingReset | undefined
): boolean =>
  Boolean(
    pending &&
    pending.connectionRevision === apiClient.getConnectionRevision() &&
    pending.identity === getCodexResetIdentity(file)
  );

// Locks span cards and route changes, but old sessions cannot block replacement credentials.
const busy = new Set<string>();

/** A confirmed redemption survives refresh failures without spending another credit.
 * This tab-memory journal is invalidated with its session or credential quota cache.
 */
export async function runCodexQuotaReset<T>(
  file: AuthFileItem,
  t: TFunction,
  consume: () => Promise<void>,
  refresh: () => Promise<T>
): Promise<T> {
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  if (!authIndex) throw new Error(t('codex_quota.missing_auth_index'));
  const identity = getCodexResetIdentity(file);
  const connectionRevision = apiClient.getConnectionRevision();
  const generation = captureQuotaCacheGeneration(file.name);
  const assertCurrent = () => {
    if (
      connectionRevision !== apiClient.getConnectionRevision() ||
      !commitIfQuotaCacheCurrent(generation, () => {})
    ) {
      throw new Error(t('codex_quota.reset_stale_request'));
    }
  };
  const verifyCredential = async () => {
    assertCurrent();
    const response = await authFilesApi.list({ name: file.name, authIndex });
    assertCurrent();
    const matches = response.files.filter((entry) => entry.name === file.name);
    if (
      matches.length !== 1 ||
      !isCodexFile(matches[0]) ||
      matches[0].disabled ||
      getCodexResetIdentity(matches[0]) !== identity
    ) {
      throw new Error(t('codex_quota.reset_credential_changed'));
    }
  };
  const key = JSON.stringify([
    connectionRevision,
    generation.cacheGeneration,
    generation.fileGenerations[file.name] ?? 0,
    identity,
  ]);
  if (busy.has(key)) throw new Error(t('codex_quota.reset_in_progress'));
  busy.add(key);
  try {
    const store = useQuotaStore.getState();
    let pending: CodexPendingReset | undefined = store.codexPendingResets[file.name];
    if (!isCodexResetPending(file, pending)) pending = undefined;

    await verifyCredential();
    if (!pending) {
      await consume();
      assertCurrent();
      pending = { identity, connectionRevision, phase: 'cooldown_pending' };
      store.setCodexPendingReset(file.name, pending);
    }

    if (pending.phase === 'cooldown_pending') {
      // The same file path/auth index may now hold a different account, including external edits.
      await verifyCredential();
      const response = await authFilesApi.resetCooldown(authIndex);
      assertCurrent();
      if (response.status !== 'ok' || response.auth_index !== authIndex) {
        throw new Error(t('codex_quota.reset_cooldown_failed'));
      }
      pending = { ...pending, phase: 'refresh_pending' };
      store.setCodexPendingReset(file.name, pending);
      notifyAuthFileCooldownReset();
    }

    assertCurrent();
    const result = await refresh();
    assertCurrent();
    store.setCodexPendingReset(file.name);
    return result;
  } finally {
    busy.delete(key);
  }
}
