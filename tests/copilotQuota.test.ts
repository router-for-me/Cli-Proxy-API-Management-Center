import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { COPILOT_CONFIG, parseCopilotQuota } from '@/features/quota/providers/copilot/data';
import i18n from '@/i18n';
import { authFilesApi } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import { useQuotaStore } from '@/stores/useQuotaStore';

const file = { name: 'copilot-test.json', authIndex: 'test-index', type: 'copilot' };
const credential = JSON.stringify({
  type: 'copilot',
  refresh_token: 'test-oauth',
  access_token: 'test-inference',
});
const snapshot = {
  quota_remaining: 1150.9,
  remaining: 1150,
  entitlement: 20000,
  percent_remaining: 5.7,
};
const payload = (premium: unknown) => ({
  login: 'fixture-account',
  quota_snapshots: { premium_interactions: premium },
});

afterEach(() => mock.restore());

test('downloads the selected credential and passes only its GitHub token to the fixed quota endpoint', async () => {
  spyOn(apiClient, 'captureConnection').mockReturnValue(apiClient);
  const download = spyOn(authFilesApi, 'downloadText').mockResolvedValue(credential);
  const post = spyOn(apiClient, 'post').mockResolvedValue({
    status_code: 200,
    body: payload(snapshot),
  });
  const data = await COPILOT_CONFIG.fetchQuota(file, i18n.t);
  expect(download).toHaveBeenCalledWith(file.name);
  expect(post).toHaveBeenCalledWith(
    '/requests/api-call',
    {
      method: 'GET',
      authIndex: 'test-index',
      url: 'https://api.github.com/copilot_internal/user',
      header: {
        Authorization: 'Bearer test-oauth',
        'User-Agent': 'copilot/1.0.114',
        Accept: 'application/json',
      },
    },
    undefined
  );
  expect(COPILOT_CONFIG.buildSuccessState(data)).toEqual({
    status: 'success',
    data: { remaining: 1150.9, entitlement: 20000, percentRemaining: 5.7 },
  });
});

test('zero is valid but missing, unlimited and invalid windows are not exhausted quotas', () => {
  expect(
    parseCopilotQuota(payload({ ...snapshot, quota_remaining: 0, percent_remaining: 0 }))?.remaining
  ).toBe(0);
  for (const premium of [
    undefined,
    {},
    { ...snapshot, unlimited: true },
    { ...snapshot, percent_remaining: null },
  ]) {
    expect(parseCopilotQuota(payload(premium))).toBeNull();
  }
});

test('missing token or changed file/session never forwards the credential', async () => {
  spyOn(apiClient, 'captureConnection').mockReturnValue(apiClient);
  const post = spyOn(apiClient, 'post');
  const download = spyOn(authFilesApi, 'downloadText');
  for (const mode of ['missing', 'file', 'session']) {
    download.mockImplementation(async () => {
      if (mode === 'missing') return '{"type":"copilot","access_token":"test-inference"}';
      useQuotaStore.getState().clearQuotaCache(mode === 'file' ? [file.name] : undefined);
      return credential;
    });
    await expect(COPILOT_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow(
      i18n.t('copilot_quota.unavailable')
    );
  }
  expect(post).not.toHaveBeenCalled();
});

test('transport errors expose neither the token nor upstream response details', async () => {
  spyOn(apiClient, 'captureConnection').mockReturnValue(apiClient);
  spyOn(authFilesApi, 'downloadText').mockResolvedValue(credential);
  const post = spyOn(apiClient, 'post').mockResolvedValue({ status_code: 401, body: credential });
  const safeError = new Error(i18n.t('copilot_quota.unavailable'));
  await expect(COPILOT_CONFIG.fetchQuota(file, i18n.t)).rejects.toEqual(safeError);
  post.mockRejectedValue(new Error(credential));
  await expect(COPILOT_CONFIG.fetchQuota(file, i18n.t)).rejects.toEqual(safeError);
});
