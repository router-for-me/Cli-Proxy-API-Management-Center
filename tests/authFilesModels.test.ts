import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useAuthFilesModels } from '@/features/authFiles/hooks/useAuthFilesModels';
import { authFilesApi } from '@/services/api';
import { useNotificationStore } from '@/stores/useNotificationStore';

const initialState = useNotificationStore.getState();
afterEach(() => {
  mock.restore();
  useNotificationStore.setState(initialState);
});

function renderModelsError(error: Error) {
  // Throw synchronously so the server renderer can observe the hook's error state on rerender.
  spyOn(authFilesApi, 'getModelsForAuthFile').mockImplementation(() => {
    throw error;
  });
  function Harness() {
    const { showModels, modelsError } = useAuthFilesModels();
    const [started, setStarted] = useState(false);
    if (!started) {
      setStarted(true);
      void showModels({ name: 'a.json' });
    }
    return modelsError;
  }
  return renderToStaticMarkup(createElement(Harness));
}

test('a 404 status selects unsupported regardless of message', () => {
  expect(renderModelsError(Object.assign(new Error('资源不可用'), { status: 404 }))).toBe(
    'unsupported'
  );
  expect(useNotificationStore.getState().notifications).toEqual(initialState.notifications);
});

test.each([new Error('Not Found'), Object.assign(new Error('upstream 404'), { status: 502 })])(
  '404-like text without a 404 status remains a load failure: %s',
  (error) => {
    expect(renderModelsError(error)).toBe('');
    const notification = useNotificationStore.getState().notifications.at(-1);
    expect(notification?.type).toBe('error');
    expect(notification?.message).toContain(error.message);
  }
);
