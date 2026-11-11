import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { apiCallApi, type ApiCallRequest } from '@/services/api/apiCall';
import {
  resolveCodexAccountTarget,
  setCodexPersonalCredits,
} from '@/services/api/codexAccountSettings';

const originalRequest = apiCallApi.request;
const feature = 'can_consume_personal_credits_chatpass';
const target = { authIndex: 'credential-index', accountId: 'account-test' };
afterEach(() => {
  apiCallApi.request = originalRequest;
});

describe('Codex account credit settings', () => {
  test('resolves listing identity without downloading credential tokens', () => {
    expect(
      resolveCodexAccountTarget(
        JSON.stringify({
          name: 'codex.json',
          auth_index: target.authIndex,
          id_token: { chatgpt_account_id: target.accountId },
        })
      )
    ).toEqual(target);
    expect(
      resolveCodexAccountTarget(
        JSON.stringify({
          name: 'codex.json',
          authIndex: target.authIndex,
          chatgpt_account_id: target.accountId,
        })
      )
    ).toEqual(target);
    for (const value of ['invalid', 'null', '{}', '{"name":"codex.json"}']) {
      expect(resolveCodexAccountTarget(value)).toBeNull();
    }
  });

  for (const enabled of [true, false]) {
    test(`writes ${enabled} with server-side token substitution and no request body`, async () => {
      const calls: ApiCallRequest[] = [];
      apiCallApi.request = async (payload) => {
        calls.push(payload);
        return { statusCode: 200, header: {}, bodyText: '', body: { [feature]: enabled } };
      };
      await setCodexPersonalCredits(target, enabled);
      expect(calls).toEqual([
        {
          authIndex: target.authIndex,
          method: 'PATCH',
          url: `https://chatgpt.com/backend-api/settings/account_user_setting?feature=${feature}&value=${enabled}`,
          header: { Authorization: 'Bearer $TOKEN$', 'ChatGPT-Account-Id': target.accountId },
        },
      ]);
    });
  }

  test('rejects upstream errors and unconfirmed values', async () => {
    for (const [statusCode, body] of [
      [401, { error: 'rejected' }],
      [405, {}],
      [500, {}],
      [200, {}],
      [200, { [feature]: false }],
      [200, { [feature]: 'true' }],
    ] as const) {
      apiCallApi.request = async () => ({ statusCode, body, header: {}, bodyText: '' });
      await expect(setCodexPersonalCredits(target, true)).rejects.toThrow();
    }
  });

  test('missing identity does not send a request', async () => {
    let called = false;
    apiCallApi.request = async () => {
      called = true;
      throw new Error('unexpected');
    };
    await expect(setCodexPersonalCredits({ ...target, accountId: '' }, true)).rejects.toThrow();
    expect(called).toBe(false);
  });

  test('all locales explain unknown state and immediate account-wide changes', () => {
    const keys = [
      'title',
      'description',
      'unknown',
      'scope',
      'unavailable',
      'allow',
      'deny',
      'confirm',
      'success',
      'failed',
      'saving',
    ];
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr']) {
      const strings = JSON.parse(
        readFileSync(`src/i18n/locales/${locale}.json`, 'utf8')
      ).codex_account_settings;
      expect(Object.keys(strings).sort()).toEqual([...keys].sort());
      expect(strings.confirm).toContain('{{account}}');
      expect(strings.confirm).toContain('{{action}}');
    }
  });

  test('details entry is Codex-only and writes are confirmation/session guarded', () => {
    const sheet = readFileSync(
      'src/features/authFiles/components/AuthFileDetailsSheet.tsx',
      'utf8'
    );
    const component = readFileSync(
      'src/features/authFiles/components/CodexAccountSettings.tsx',
      'utf8'
    );
    expect(sheet).toContain("editor.providerKey === 'codex'");
    expect(component).toContain('showConfirmation({');
    expect(component).toContain(
      'if (!active.current || disabledRef.current || busy.current) return;'
    );
    expect(component).toContain('if (!commitIfQuotaCacheCurrent(generation, () => {})) return;');
    expect(component).not.toContain('localStorage');
    expect(component).toContain('styles.accountCard');
    expect(component).toContain('styles.accountStatus');
    expect(component).toContain("t('codex_account_settings.scope')");
    expect(component).not.toContain('aria-pressed');
    expect(component).not.toContain('role="switch"');
  });
});
