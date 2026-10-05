import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { TFunction } from 'i18next';
import type { AuthFileItem } from '@/types';
import { runCodexQuotaReset } from '@/features/quota/providers/codex/reset';
import {
  codexResetKey,
  useCodexResetStore,
} from '@/features/quota/providers/codex/resetOperations';
import type {
  CodexResetConsumeIntent,
  CodexResetConsumeResult,
} from '@/features/quota/providers/codex/resetContract';
import { apiClient } from '@/services/api/client';
import { authFilesApi } from '@/services/api/authFiles';
import { useQuotaStore } from '@/stores/useQuotaStore';

const t = ((key: string) => key) as TFunction;
const originalList = authFilesApi.list;
const originalCooldown = authFilesApi.resetCooldown;
const originalRevision = apiClient.getConnectionRevision;
const originalScope = apiClient.getConnectionScope;
const scope = 'identity-mutation-fixture';
const accountId = 'original-account';
const key = codexResetKey(scope, accountId);
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  useCodexResetStore.getState().initialize({
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      values.set(name, value);
    },
    removeItem: (name) => {
      values.delete(name);
    },
    clear: () => values.clear(),
  });
  apiClient.getConnectionRevision = () => 89;
  apiClient.getConnectionScope = () => scope;
  useQuotaStore.getState().clearQuotaCache();
});

afterEach(() => {
  authFilesApi.list = originalList;
  authFilesApi.resetCooldown = originalCooldown;
  apiClient.getConnectionRevision = originalRevision;
  apiClient.getConnectionScope = originalScope;
  useQuotaStore.getState().clearQuotaCache();
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const success: CodexResetConsumeResult = { outcome: 'success', code: 'reset' };

describe('Codex reset captured credential identity', () => {
  test.each(['direct', 'nested'] as const)(
    'rejects a mutable %s account ID during the initial credential lookup',
    async (source) => {
      const token = { chatgpt_account_id: accountId };
      const file: AuthFileItem = {
        name: 'fixture.json',
        type: 'codex',
        auth_index: 'fixture-index',
        ...(source === 'direct' ? { chatgpt_account_id: accountId } : { id_token: token }),
      };
      const lookup = deferred<{ files: AuthFileItem[] }>();
      authFilesApi.list = () => lookup.promise;
      const consume = mock(async (_intent: CodexResetConsumeIntent) => success);
      const refresh = mock(async () => ({}));
      const pending = runCodexQuotaReset(file, t, consume, refresh);

      if (source === 'direct') file.chatgpt_account_id = 'replacement-account';
      else token.chatgpt_account_id = 'replacement-account';
      lookup.resolve({ files: [{ ...file }] });

      await expect(pending).rejects.toThrow('reset_credential_changed');
      expect(consume).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(values.size).toBe(0);
      expect(useCodexResetStore.getState().records[key]).toBeUndefined();
      expect(useCodexResetStore.getState().busy[key]).toBeUndefined();
    }
  );

  test.each(['account', 'disabled'] as const)(
    'records the original consume success but stops continuation after %s mutates',
    async (change) => {
      const token = { chatgpt_account_id: accountId };
      const file: AuthFileItem = {
        name: 'fixture.json',
        type: 'codex',
        auth_index: 'fixture-index',
        id_token: token,
      };
      authFilesApi.list = async () => ({ files: [{ ...file }] });
      const clear = mock(async (authIndex: string) => ({
        status: 'ok' as const,
        auth_index: authIndex,
        models: [],
      }));
      authFilesApi.resetCooldown = clear;
      const started = deferred<void>();
      const response = deferred<CodexResetConsumeResult>();
      const consume = mock(async (intent: CodexResetConsumeIntent) => {
        expect(intent.header['Chatgpt-Account-Id']).toBe(accountId);
        started.resolve();
        return response.promise;
      });
      const refresh = mock(async () => ({}));
      const pending = runCodexQuotaReset(file, t, consume, refresh);
      await started.promise;

      if (change === 'account') token.chatgpt_account_id = 'replacement-account';
      else file.disabled = true;
      expect(useCodexResetStore.getState().busy[key]).toBeString();
      response.resolve(success);

      await expect(pending).rejects.toThrow('reset_credential_changed');
      const record = useCodexResetStore.getState().records[key];
      expect(record?.accountId).toBe(accountId);
      expect(record?.intent.header['Chatgpt-Account-Id']).toBe(accountId);
      expect(record?.phase).toBe('cooldown_pending');
      expect(record?.pause).toBe('credential_changed');
      expect(useCodexResetStore.getState().busy[key]).toBeUndefined();
      expect(clear).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    }
  );
});
