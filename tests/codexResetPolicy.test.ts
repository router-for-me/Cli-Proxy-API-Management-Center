import { afterEach, expect, spyOn, test } from 'bun:test';
import { apiClient } from '@/services/api/client';
import { codexResetPolicyApi } from '@/services/api/codexResetPolicy';
import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import vi from '@/i18n/locales/vi.json';
import ko from '@/i18n/locales/ko.json';
import tr from '@/i18n/locales/tr.json';

const policy = {
  account_key: `codex-reset:${'a'.repeat(64)}`,
  enabled: false,
  before_expiry_seconds: 3600,
  pending: false,
  result: 'disabled',
  last_checked_at: 0,
  last_reset_at: 0,
};
const mocks: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  for (const mock of mocks.splice(0)) mock.mockRestore();
});

test('reads the protected v8 policy with an encoded credential index', async () => {
  const get = spyOn(apiClient, 'get').mockResolvedValue(policy);
  mocks.push(get);
  expect(await codexResetPolicyApi.read('index/a')).toEqual(policy);
  expect(get).toHaveBeenCalledWith('/routing/codex-reset-policy?auth_index=index%2Fa');
});

test('explicit consent is bound to the immutable account returned by the backend', async () => {
  const put = spyOn(apiClient, 'put').mockResolvedValue({ ...policy, enabled: true });
  mocks.push(put);
  await codexResetPolicyApi.save('index', policy, 3600);
  expect(put).toHaveBeenCalledWith('/routing/codex-reset-policy?auth_index=index', {
    account_key: policy.account_key,
    enabled: true,
    before_expiry_seconds: 3600,
  });
});

test('disabling does not clear a pending redemption journal', async () => {
  const previous = { ...policy, enabled: true, pending: true, result: 'unknown' };
  const put = spyOn(apiClient, 'put').mockResolvedValue({ ...previous, enabled: false });
  mocks.push(put);
  expect((await codexResetPolicyApi.save('index', previous, 0)).pending).toBe(true);
  expect(put.mock.calls[0]?.[1]).toEqual({
    account_key: policy.account_key,
    enabled: false,
    before_expiry_seconds: 3600,
  });
});

test.each([-1, 1, 59, 86401, NaN, Infinity, 1.5])(
  'rejects invalid lead time %s without a write',
  async (seconds) => {
    const put = spyOn(apiClient, 'put');
    mocks.push(put);
    await expect(codexResetPolicyApi.save('index', policy, seconds)).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  }
);

test.each([
  {},
  { ...policy, enabled: 'true' },
  { ...policy, pending: undefined },
  { ...policy, account_key: '' },
  { ...policy, before_expiry_seconds: 0 },
])('fails closed on malformed policy responses', async (value) => {
  const get = spyOn(apiClient, 'get').mockResolvedValue(value);
  mocks.push(get);
  await expect(codexResetPolicyApi.read('index')).rejects.toThrow();
});

test('does not apply responses from a previous management connection', async () => {
  const get = spyOn(apiClient, 'get').mockResolvedValue(policy);
  const revision = spyOn(apiClient, 'getConnectionRevision')
    .mockReturnValueOnce(1)
    .mockReturnValue(2);
  mocks.push(get, revision);
  await expect(codexResetPolicyApi.read('index')).rejects.toThrow('connection changed');
});

test('rejects a different account after a save', async () => {
  const put = spyOn(apiClient, 'put').mockResolvedValue({
    ...policy,
    account_key: `codex-reset:${'b'.repeat(64)}`,
  });
  mocks.push(put);
  await expect(codexResetPolicyApi.save('index', policy, 900)).rejects.toThrow('identity changed');
});

test('all supported locales cover automatic reset controls and outcomes', () => {
  for (const locale of [ru, zhCN, zhTW, vi, ko, tr]) {
    expect(Object.keys(locale.codex_auto_reset).sort()).toEqual(
      Object.keys(en.codex_auto_reset).sort()
    );
    expect(Object.values(locale.codex_auto_reset).every((value) => value.trim())).toBe(true);
  }
});
