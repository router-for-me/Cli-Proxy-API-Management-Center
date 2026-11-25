import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { createElement, type ChangeEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as events from '@/features/authFiles/authFilesEvents';
import { useAuthFilesData } from '@/features/authFiles/hooks/useAuthFilesData';
import { apiClient, authFilesApi } from '@/services/api';
import { useNotificationStore } from '@/stores/useNotificationStore';

const initialState = useNotificationStore.getState();
afterEach(() => {
  mock.restore();
  useNotificationStore.setState(initialState);
});

function setup() {
  const revision = spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);
  const changed = spyOn(events, 'notifyAuthFilesChanged').mockImplementation(() => {});
  const mutated = mock();
  let data!: ReturnType<typeof useAuthFilesData>;
  function Harness() {
    data = useAuthFilesData({ onFilesMutated: mutated });
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return {
    switchConnection: () => revision.mockReturnValue(2),
    deleteConfirmation: () => {
      data.handleDelete('a.json');
      return useNotificationStore.getState().confirmation.options!.onConfirm;
    },
    upload: (...names: string[]) =>
      data.handleFileChange({
        target: { files: names.map((name) => new File(['{}'], name)) },
      } as unknown as ChangeEvent<HTMLInputElement>),
    expectQuiet: () => {
      expect(changed).not.toHaveBeenCalled();
      expect(mutated).not.toHaveBeenCalled();
      expect(useNotificationStore.getState().notifications).toEqual(initialState.notifications);
    },
  };
}

test('switching before single-file confirmation sends no delete', async () => {
  const flow = setup();
  const del = spyOn(authFilesApi, 'deleteFile').mockRejectedValue(new Error('unexpected delete'));
  const confirm = flow.deleteConfirmation();
  flow.switchConnection();
  await confirm();
  expect(del).not.toHaveBeenCalled();
  flow.expectQuiet();
});

test.each(['success', 'failure'])('ignores stale single-file delete %s', async (outcome) => {
  const flow = setup();
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof authFilesApi.deleteFile>>>();
  const del = spyOn(authFilesApi, 'deleteFile').mockReturnValue(pending.promise);
  const done = flow.deleteConfirmation()();
  expect(del).toHaveBeenCalledWith('a.json');
  flow.switchConnection();
  if (outcome === 'success')
    pending.resolve({ status: 'ok', deleted: 1, files: ['a.json'], failed: [] });
  else pending.reject(new Error('delete failed'));
  await done;
  flow.expectQuiet();
});

test.each(['success', 'failure'])('ignores stale upload %s without reloading', async (outcome) => {
  const flow = setup();
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof authFilesApi.uploadFiles>>>();
  const upload = spyOn(authFilesApi, 'uploadFiles').mockReturnValue(pending.promise);
  const list = spyOn(authFilesApi, 'list').mockResolvedValue({ files: [] });
  const done = flow.upload('a.json');
  expect(upload).toHaveBeenCalledTimes(1);
  flow.switchConnection();
  if (outcome === 'success')
    pending.resolve({ status: 'ok', uploaded: 1, files: ['a.json'], failed: [] });
  else pending.reject(new Error('upload failed'));
  await done;
  expect(list).not.toHaveBeenCalled();
  flow.expectQuiet();
});

test('partial upload does not report failures after switching during its reload', async () => {
  const flow = setup();
  spyOn(authFilesApi, 'uploadFiles').mockResolvedValue({
    status: 'partial',
    uploaded: 1,
    files: ['a.json'],
    failed: [{ name: 'b.json', error: 'busy' }],
  });
  const started = Promise.withResolvers<void>();
  const pending = Promise.withResolvers<Awaited<ReturnType<typeof authFilesApi.list>>>();
  spyOn(authFilesApi, 'list').mockImplementation(() => {
    started.resolve();
    return pending.promise;
  });
  const done = flow.upload('a.json', 'b.json');
  await started.promise;
  const before = useNotificationStore.getState().notifications;
  expect(before.at(-1)?.type).toBe('warning');
  flow.switchConnection();
  pending.resolve({ files: [] });
  await done;
  expect(useNotificationStore.getState().notifications).toEqual(before);
});
