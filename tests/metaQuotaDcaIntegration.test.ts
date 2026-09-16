import { afterEach, expect, spyOn, test } from 'bun:test';
import { META_CONFIG } from '@/features/quota/providers/meta/data';
import { authFilesApi } from '@/services/api/authFiles';
import { apiCallApi } from '@/services/api/apiCall';
import { useQuotaStore } from '@/stores/useQuotaStore';
import i18n from '@/i18n';

const file = { name: 'meta-fixture.json', type: 'meta', authIndex: 'fixture-index' };
afterEach(() => useQuotaStore.getState().clearQuotaCache());

for (const invalidation of ['session', 'file'] as const) {
  test(`Meta adapter blocks a DCA request after ${invalidation} invalidation`, async () => {
    const download = spyOn(authFilesApi, 'downloadText').mockImplementation(async () => {
      useQuotaStore.getState().clearQuotaCache(invalidation === 'file' ? [file.name] : undefined);
      return '{"dca_token":"dca:fixture-only"}';
    });
    const request = spyOn(apiCallApi, 'request');
    try {
      await expect(META_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow(
        i18n.t('meta_quota.stale_request')
      );
      expect(download).toHaveBeenCalledWith(file.name);
      expect(request).not.toHaveBeenCalled();
    } finally {
      download.mockRestore();
      request.mockRestore();
    }
  });
}

test('Meta adapter retains only sanitized quota data and tolerates unrelated file invalidation', async () => {
  const download = spyOn(authFilesApi, 'downloadText').mockImplementation(async () => {
    useQuotaStore.getState().clearQuotaCache(['unrelated.json']);
    return '{"dca_token":"dca:fixture-only"}';
  });
  const request = spyOn(apiCallApi, 'request').mockResolvedValue({
    statusCode: 200,
    header: {},
    bodyText: '',
    body: { api_key: 'LLM|fixture-secret', subs_usage: { weekly: { used_percent: 1 } } },
  });
  try {
    const data = await META_CONFIG.fetchQuota(file, i18n.t);
    expect(request.mock.calls[0][0].header?.Authorization).toBe('Bearer dca:fixture-only');
    const state = META_CONFIG.buildSuccessState(data);
    expect(state.data?.windows[1].usedPercent).toBe(1);
    expect(JSON.stringify(state)).not.toContain('fixture');
  } finally {
    download.mockRestore();
    request.mockRestore();
  }
});
