import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useInstalledPlugins } from '@/features/plugins/hooks/useInstalledPlugins';
import { useQuotaActions } from '@/features/quota/hooks/useQuotaActions';
import { QUOTA_ADAPTERS } from '@/features/quota/providers';
import { apiClient, pluginsApi } from '@/services/api';
import { useNotificationStore } from '@/stores';

const initial = useNotificationStore.getState();
afterEach(() => {
  mock.restore();
  useNotificationStore.setState(initial);
});

function renderHook<T>(useHook: () => T): T {
  let result!: T;
  function Harness() {
    result = useHook();
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result;
}

const confirm = () => useNotificationStore.getState().confirmation.options!.onConfirm();

test.each([true, false])('plugin deletion with changed revision: %s', async (changed) => {
  const revision = spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);
  const remove = spyOn(pluginsApi, 'deletePlugin').mockRejectedValue(new Error('offline'));
  const actions = renderHook(() => useInstalledPlugins({ connected: true, onMutated: mock() }));
  actions.deletePlugin({
    id: 'test-plugin',
    path: '',
    configured: true,
    registered: true,
    enabled: true,
    effectiveEnabled: true,
    supportsOAuth: false,
    supportsQuota: false,
    logo: '',
    configFields: [],
    menus: [],
    metadata: null,
  });
  if (changed) revision.mockReturnValue(2);
  await confirm();
  expect(remove.mock.calls).toEqual(changed ? [] : [['test-plugin']]);
});

test.each([true, false])('quota redemption with changed revision: %s', async (changed) => {
  const revision = spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);
  const resetQuota = mock(async () => {
    throw new Error('offline');
  });
  const actions = renderHook(() => useQuotaActions(false));
  actions.resetQuota({ name: 'test.json' }, { ...QUOTA_ADAPTERS.codex, resetQuota });
  if (changed) revision.mockReturnValue(2);
  await confirm();
  expect(resetQuota).toHaveBeenCalledTimes(changed ? 0 : 1);
});
