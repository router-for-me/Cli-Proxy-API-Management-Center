import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useAuthFilesData } from '@/features/authFiles/hooks/useAuthFilesData';
import { getAuthFileListResults } from '@/features/authFiles/logic';
import * as authFilesEvents from '@/features/authFiles/authFilesEvents';
import { apiClient } from '@/services/api/client';
import { useNotificationStore } from '@/stores/useNotificationStore';

const { getState } = useNotificationStore;
const files = [
  { name: 'a.json', type: 'devin', email: 'team@example.test' },
  { name: 'b.json', type: 'devin', email: 'team@example.test' },
  { name: 'runtime', type: 'devin', email: 'team@example.test', runtimeOnly: true },
  { name: 'other.json', type: 'devin' },
];

const prepare = (search: string) => {
  const onFilesMutated = mock();
  const { selectableNames } = getAuthFileListResults(files, 'all', search, 'default');
  let batchDelete!: (names: string[]) => void;
  function Harness() {
    batchDelete = useAuthFilesData({ onFilesMutated }).batchDelete;
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  getState().hideConfirmation();
  batchDelete(selectableNames);
  selectableNames.push('arrived-after-confirmation.json');
  return { confirm: getState().confirmation.options?.onConfirm, onFilesMutated };
};

describe('auth file toolbar batch delete', () => {
  const initialState = getState();
  afterEach(() => useNotificationStore.setState(initialState));

  test('submits only matching selectable names from the confirmation snapshot', async () => {
    const changed = spyOn(authFilesEvents, 'notifyAuthFilesChanged').mockImplementation(() => {});
    const del = spyOn(apiClient, 'delete').mockResolvedValue({
      status: 'partial',
      deleted: 1,
      files: ['a.json'],
      failed: [{ name: 'b.json', error: 'busy' }],
    });
    try {
      const { confirm, onFilesMutated } = prepare('team@*');
      await confirm!();
      expect(del).toHaveBeenCalledWith('/credentials', { data: { names: ['a.json', 'b.json'] } });
      expect(onFilesMutated).toHaveBeenCalledWith(['a.json']);
      expect(getState().notifications.at(-1)?.type).toBe('warning');
    } finally {
      changed.mockRestore();
      del.mockRestore();
    }
  });

  test('a single-name ok confirms exactly the requested file', async () => {
    const changed = spyOn(authFilesEvents, 'notifyAuthFilesChanged').mockImplementation(() => {});
    const del = spyOn(apiClient, 'delete').mockResolvedValue({ status: 'ok' });
    try {
      const { confirm, onFilesMutated } = prepare('other.json');
      await confirm!();
      expect(del).toHaveBeenCalledWith('/credentials', { data: { names: ['other.json'] } });
      expect(onFilesMutated).toHaveBeenCalledWith(['other.json']);
      expect(getState().notifications.at(-1)?.type).toBe('success');
    } finally {
      changed.mockRestore();
      del.mockRestore();
    }
  });

  test.each([{ status: 'ok', deleted: 0 }, { status: 'ok' }, new Error('delete failed')])(
    'unfiltered failures neither mutate nor signal success: %j',
    async (response) => {
      const del = spyOn(apiClient, 'delete');
      if (response instanceof Error) del.mockRejectedValue(response);
      else del.mockResolvedValue(response);
      try {
        const { confirm, onFilesMutated } = prepare('');
        await confirm!();
        expect(del).toHaveBeenCalledWith('/credentials', {
          data: { names: ['a.json', 'b.json', 'other.json'] },
        });
        expect(onFilesMutated).not.toHaveBeenCalled();
        expect(getState().notifications.at(-1)?.type).toBe('error');
      } finally {
        del.mockRestore();
      }
    }
  );

  test('runtime-only and empty results have no confirmation or request', () => {
    const del = spyOn(apiClient, 'delete');
    try {
      expect(prepare('runtime').confirm).toBeUndefined();
      expect(prepare('no-match').confirm).toBeUndefined();
      expect(del).not.toHaveBeenCalled();
    } finally {
      del.mockRestore();
    }
  });
});
