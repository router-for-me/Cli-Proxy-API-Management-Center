import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { useNotificationStore } from '@/stores/useNotificationStore';
import { useQuotaActions } from '@/features/quota/hooks/useQuotaActions';
import { createCodexResetViewSelector } from '@/features/quota/hooks/useCodexResetView';
import { QUOTA_ADAPTERS } from '@/features/quota/providers';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { TFunction } from 'i18next';
import type { AuthFileItem } from '@/types';
import { apiClient } from '@/services/api/client';
import { authFilesApi } from '@/services/api/authFiles';
import { captureQuotaCacheGeneration, useQuotaStore } from '@/stores/useQuotaStore';
import { buildCodexResetConsumeIntent } from '@/features/quota/providers/codex/resetContract';
import { getCodexResetView } from '@/features/quota/providers/codex/reset';
import {
  codexResetKey,
  useCodexResetStore,
  type CodexResetOperation,
  type CodexResetPhase,
} from '@/features/quota/providers/codex/resetOperations';
import {
  canRunCodexResetAction,
  commitIfCodexResetCurrent,
  getCodexResetPresentation,
  isCodexResetActionCurrent,
  performCodexResetAction,
} from '@/features/quota/providers/codex/resetUi';

const t = ((key: string) => key) as TFunction;
const file: AuthFileItem = {
  name: 'recovery-ui.json',
  provider: 'codex',
  auth_index: 'ui-auth',
  id_token: { chatgpt_account_id: 'ui-account' },
};
const scope = 'ui-test-scope';
const key = codexResetKey(scope, 'ui-account');
const originalScope = apiClient.getConnectionScope;
const originalRevision = apiClient.getConnectionRevision;
const originalList = authFilesApi.list;
const originalCooldown = authFilesApi.resetCooldown;
const originalStoreState = useCodexResetStore.getState();
const originalNotificationState = useNotificationStore.getState();
let revision = 100;

function storage(): Storage {
  const values = new Map<string, string>();
  return {
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
  };
}
function operation(phase: CodexResetPhase = 'consume_unknown'): CodexResetOperation {
  return {
    version: 1,
    scope,
    accountId: 'ui-account',
    operationId: 'ui-operation',
    credential: { name: file.name, authIndex: 'ui-auth', accountId: 'ui-account' },
    intent: buildCodexResetConsumeIntent(file, t, 'ui-operation'),
    phase,
    attemptId: 'previous-attempt',
    createdAt: 1,
    lastAttemptAt: 1,
  };
}
function setOperation(value: CodexResetOperation) {
  useCodexResetStore.setState({ records: { [key]: value } });
}

beforeEach(() => {
  revision = 100;
  apiClient.getConnectionScope = () => scope;
  apiClient.getConnectionRevision = () => revision;
  useCodexResetStore.getState().initialize(storage());
  useQuotaStore.getState().clearQuotaCache();
});
afterEach(() => {
  apiClient.getConnectionScope = originalScope;
  apiClient.getConnectionRevision = originalRevision;
  authFilesApi.list = originalList;
  authFilesApi.resetCooldown = originalCooldown;
  useCodexResetStore.setState(originalStoreState);
  useNotificationStore.setState(originalNotificationState);
  useQuotaStore.getState().clearQuotaCache();
});

describe('Codex reset actions on both quota hosts', () => {
  test.each([
    ['consume_pending', 'reset_retry_button'],
    ['consume_unknown', 'reset_retry_button'],
    ['cooldown_pending', 'reset_cooldown_button'],
    ['refresh_pending', 'reset_refresh_button'],
  ] as const)('keeps %s recovery available without loaded quota or credits', (phase, label) => {
    setOperation(operation(phase));
    const view = getCodexResetView(file);
    const ui = getCodexResetPresentation(view, false);
    expect(ui.show).toBe(true);
    expect(ui.disabled).toBe(false);
    expect(ui.buttonKey).toBe(`codex_quota.${label}`);
  });

  test('memory lock disables every recovery phase, including retries from unknown', () => {
    for (const phase of ['consume_unknown', 'cooldown_pending', 'refresh_pending'] as const) {
      setOperation(operation(phase));
      useCodexResetStore.setState({ busy: { [key]: 'current-attempt' } });
      const ui = getCodexResetPresentation(getCodexResetView(file), true);
      expect(ui.disabled).toBe(true);
      expect(ui.buttonKey).toBe('codex_quota.reset_busy_button');
    }
  });

  test('a new redemption is unavailable until records have loaded', () => {
    useCodexResetStore.setState({ ready: false });
    const ui = getCodexResetPresentation(getCodexResetView(file), true);
    expect(ui.disabled).toBe(true);
    expect(ui.reasonKey).toBe('codex_quota.reset_loading_record');
  });

  test('another credential for the account blocks recovery and names the original credential', () => {
    setOperation(operation());
    const alternate = { ...file, name: 'other.json', auth_index: 'other-auth' };
    const view = getCodexResetView(alternate);
    const ui = getCodexResetPresentation(view, true);
    expect(view.action).toBe('recheck');
    expect(ui.buttonKey).toBe('codex_quota.reset_recheck_button');
    expect(ui.disabled).toBe(true);
    expect(ui.reasonKey).toBe('codex_quota.reset_other_credential');
    expect(ui.reasonParams).toEqual({ name: file.name });
    expect(ui.descriptionKey).toBeUndefined();
  });

  test('a storage recheck remains visible even without an operation or quota', () => {
    useCodexResetStore.setState({ storageErrors: { [key]: true } });
    const ui = getCodexResetPresentation(getCodexResetView(file), false);
    expect(ui.show).toBe(true);
    expect(ui.disabled).toBe(false);
    expect(ui.buttonKey).toBe('codex_quota.reset_recheck_button');
  });

  test('recheck only reads and requires another explicit action to resume', async () => {
    setOperation({ ...operation(), pause: 'credential_changed' });
    const list = mock(async () => ({ files: [file] }));
    const cooldown = mock(async () => ({
      status: 'ok' as const,
      auth_index: 'ui-auth',
      models: [],
    }));
    authFilesApi.list = list;
    authFilesApi.resetCooldown = cooldown;
    const reset = mock(async () => ({ windows: [] }));
    const view = getCodexResetView(file);
    expect(await performCodexResetAction(view, file, t, reset)).toEqual({ kind: 'recheck' });
    expect(list).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
    expect(cooldown).not.toHaveBeenCalled();
    expect(getCodexResetView(file).action).toBe('retry');
    expect(isCodexResetActionCurrent(file, view)).toBe(false);
  });

  test.each(['no_credit', 'nothing_to_reset', 'completed'] as const)(
    'terminal %s can only remove its local record',
    async (terminal) => {
      setOperation({ ...operation('consume_pending'), terminal });
      const reset = mock(async () => ({ windows: [] }));
      const list = mock(async () => ({ files: [file] }));
      const cooldown = mock(async () => ({
        status: 'ok' as const,
        auth_index: 'ui-auth',
        models: [],
      }));
      authFilesApi.list = list;
      authFilesApi.resetCooldown = cooldown;
      const view = getCodexResetView(file);
      const ui = getCodexResetPresentation(view, false);
      expect(ui.buttonKey).toBe('codex_quota.reset_cleanup_button');
      if (terminal !== 'completed') expect(ui.reasonKey).toBe(`codex_quota.reset_${terminal}`);
      expect(await performCodexResetAction(view, file, t, reset)).toEqual({ kind: 'cleanup' });
      expect(reset).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
      expect(cooldown).not.toHaveBeenCalled();
      expect(getCodexResetView(file).operation).toBeUndefined();
    }
  );

  test('disabled credentials allow only recorded recheck or cleanup actions', async () => {
    const disabled = { ...file, disabled: true };
    const reset = mock(async () => ({ windows: [] }));
    expect(canRunCodexResetAction(disabled, getCodexResetView(disabled))).toBe(false);
    for (const phase of ['consume_unknown', 'cooldown_pending', 'refresh_pending'] as const) {
      setOperation(operation(phase));
      const view = getCodexResetView(disabled);
      expect(canRunCodexResetAction(disabled, view)).toBe(false);
      expect(await performCodexResetAction(view, disabled, t, reset)).toBeUndefined();
    }
    setOperation({ ...operation(), pause: 'credential_changed' });
    expect(canRunCodexResetAction(disabled, getCodexResetView(disabled))).toBe(true);
    setOperation({ ...operation(), terminal: 'no_credit' });
    const cleanupView = getCodexResetView(disabled);
    expect(canRunCodexResetAction(disabled, cleanupView)).toBe(true);
    expect(await performCodexResetAction(cleanupView, disabled, t, reset)).toEqual({
      kind: 'cleanup',
    });
    expect(reset).not.toHaveBeenCalled();
    expect(getCodexResetView(disabled).operation).toBeUndefined();
  });

  test('rechecking a disabled credential can inspect it without writing upstream', async () => {
    const disabled = { ...file, disabled: true };
    setOperation({ ...operation(), pause: 'credential_changed' });
    const list = mock(async () => ({ files: [disabled] }));
    authFilesApi.list = list;
    const reset = mock(async () => ({ windows: [] }));
    const cooldown = mock(async () => ({
      status: 'ok' as const,
      auth_index: 'ui-auth',
      models: [],
    }));
    authFilesApi.resetCooldown = cooldown;
    await expect(
      performCodexResetAction(getCodexResetView(disabled), disabled, t, reset)
    ).rejects.toThrow('credential_changed');
    expect(list).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
    expect(cooldown).not.toHaveBeenCalled();
    expect(getCodexResetView(disabled).action).toBe('recheck');
  });

  test('an old confirmation cannot authorize a replaced or completed operation', async () => {
    setOperation(operation());
    const view = getCodexResetView(file);
    const reset = mock(async () => ({ windows: [] }));
    setOperation({ ...operation(), operationId: 'replacement-operation' });
    expect(await performCodexResetAction(view, file, t, reset)).toBeUndefined();
    useCodexResetStore.setState({ records: {} });
    expect(await performCodexResetAction(view, file, t, reset)).toBeUndefined();
    expect(reset).not.toHaveBeenCalled();
  });

  test('a connection switch suppresses cache writes and notifications after await', async () => {
    const generation = captureQuotaCacheGeneration(file.name);
    const expectedRevision = revision;
    const writes: string[] = [];
    await Promise.resolve();
    revision += 1;
    expect(
      commitIfCodexResetCurrent(expectedRevision, generation, () => {
        writes.push('cache', 'notification');
      })
    ).toBe(false);
    expect(writes).toEqual([]);
  });

  // CSS-module hosts cannot be server rendered by Bun. Shared action behavior is tested
  // above; these small contracts ensure both actual hosts use it at every quota status.
  test.each([
    'features/quota/components/QuotaCard.tsx',
    'features/authFiles/components/AuthFileQuotaSection.tsx',
  ])('%s subscribes to recovery independently of quota success', (path) => {
    const source = readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
    expect(source).toContain("useCodexResetView(file, adapter.type === 'codex')");
    expect(source).not.toContain('useCodexResetStore()');
    expect(source).toContain('getCodexResetPresentation(');
    expect(source).toContain('resetUi.show');
    expect(source).toContain('resetUi.disabled');
    expect(source).toContain('canRunCodexResetAction(file, resetView)');
    expect(source).not.toContain('codexPendingResets');
    expect(source).toContain('t(resetUi.reasonKey, resetUi.reasonParams)');
  });

  test('a new redemption uses the confirmation label instead of the action label', () => {
    const ui = getCodexResetPresentation(getCodexResetView(file), true);
    expect(ui.buttonKey).toBe('codex_quota.reset_button');
    expect(ui.confirmButtonKey).toBe('codex_quota.reset_confirm_button');
  });

  test('account selectors ignore unrelated operation and busy updates', () => {
    setOperation(operation());
    const select = createCodexResetViewSelector(file, true);
    const first = select(useCodexResetStore.getState());
    const unrelated = codexResetKey(scope, 'other-account');
    useCodexResetStore.setState((state) => ({
      records: { ...state.records, [unrelated]: { ...operation(), accountId: 'other-account' } },
      busy: { ...state.busy, [unrelated]: 'other-attempt' },
      storageErrors: { [unrelated]: true },
      blockedAccounts: { [unrelated]: true },
    }));
    expect(select(useCodexResetStore.getState())).toBe(first);
    useCodexResetStore.setState({ busy: { [key]: 'my-attempt' } });
    const busy = select(useCodexResetStore.getState());
    expect(busy).not.toBe(first);
    expect(busy?.busy).toBe(true);
  });

  test('a non-Codex selector does not resolve account scope or read journal fields', () => {
    const scopeLookup = mock(() => scope);
    apiClient.getConnectionScope = scopeLookup;
    const select = createCodexResetViewSelector({ name: 'other-provider.json' }, false);
    expect(select(useCodexResetStore.getState())).toBeUndefined();
    useCodexResetStore.setState({ blockedAll: true });
    expect(select(useCodexResetStore.getState())).toBeUndefined();
    expect(scopeLookup).not.toHaveBeenCalled();
  });

  test('a future non-Codex reset adapter runs without Codex identity or journal checks', async () => {
    const otherFile: AuthFileItem = { name: 'other-provider.json', provider: 'xai' };
    const reset = mock(async () => ({ marker: 'provider-reset-result' }));
    const adapter = { ...QUOTA_ADAPTERS.xai, resetQuota: reset, canResetQuota: () => true };
    const cacheKey = getQuotaCacheKey(otherFile);
    useQuotaStore.getState().setXaiQuota({ [cacheKey]: { status: 'success', windows: [] } });
    useCodexResetStore.setState({ ready: false, blockedAll: true });
    const scopeLookup = mock(() => scope);
    apiClient.getConnectionScope = scopeLookup;
    let actions: ReturnType<typeof useQuotaActions> | undefined;
    function ActionHarness() {
      actions = useQuotaActions(false);
      return null;
    }
    renderToStaticMarkup(createElement(ActionHarness));
    actions!.resetQuota(otherFile, adapter);
    const confirmation = useNotificationStore.getState().confirmation.options;
    expect(confirmation).not.toBeNull();
    expect(confirmation!.confirmText).toBe(i18n.t('codex_quota.reset_confirm_button'));
    await confirmation!.onConfirm();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(scopeLookup).not.toHaveBeenCalled();
    expect(useCodexResetStore.getState().records).toEqual({});
  });

  test('all four locales distinguish unknown retries from confirmed recovery', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru']) {
      const { codex_quota: messages } = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      ) as { codex_quota: Record<string, string> };
      for (const action of ['retry', 'cooldown', 'refresh', 'recheck', 'cleanup']) {
        for (const suffix of ['button', 'title', 'message']) {
          expect(messages[`reset_${action}_${suffix}`]).toBeTruthy();
        }
      }
      expect(messages.reset_retry_message).toContain('ID');
      expect(messages.reset_retry_message).not.toBe(messages.reset_cooldown_message);
      expect(messages.reset_no_credit).not.toBe(messages.reset_success);
      expect(messages.reset_result_unknown).toContain('{{message}}');
      expect(messages.reset_other_credential).toContain('{{name}}');
      expect(messages.reset_corrupt_record).toBeTruthy();
    }
    const { codex_quota: en } = JSON.parse(
      readFileSync(new URL('../src/i18n/locales/en.json', import.meta.url), 'utf8')
    );
    expect(en.reset_retry_message).not.toContain('No additional reset credit will be used');
    expect(en.reset_retry_message).not.toContain('undocumented');
    expect(en.reset_retry_message).not.toContain('official');
    expect(en.reset_corrupt_record).toContain('Closing this tab');
    expect(en.reset_corrupt_record).toContain('protection against duplicate redemption');
    expect(en.reset_cooldown_message).toContain('No additional reset credit will be used');
  });
});
