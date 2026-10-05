import { useMemo, useSyncExternalStore } from 'react';
import type { AuthFileItem } from '@/types';
import { apiClient } from '@/services/api/client';
import { getCodexResetView, type CodexResetView } from '../providers/codex/reset';
import { getCodexResetAccountId } from '../providers/codex/resetContract';
import {
  codexResetKey,
  useCodexResetStore,
  type CodexResetState,
} from '../providers/codex/resetOperations';

const noView = () => undefined;
const noSubscription = () => () => {};

/** Ignore operations belonging to other accounts and preserve the selected view identity. */
export function createCodexResetViewSelector(
  file: AuthFileItem,
  enabled: boolean,
  scope = enabled ? apiClient.getConnectionScope() : ''
) {
  if (!enabled) return noView;
  const key = codexResetKey(scope, getCodexResetAccountId(file) ?? '');
  let previousInputs: unknown[] | undefined;
  let previousView: CodexResetView;
  return (state: CodexResetState): CodexResetView => {
    const inputs = [
      state.ready,
      state.blockedAll,
      state.blockedAccounts[key],
      state.storageErrors[key],
      state.busy[key],
      state.records[key],
    ];
    if (previousInputs?.every((value, index) => Object.is(value, inputs[index]))) {
      return previousView;
    }
    previousInputs = inputs;
    previousView = getCodexResetView(file, state);
    return previousView;
  };
}

/** Non-Codex cards do not subscribe to the recovery journal. */
export function useCodexResetView(file: AuthFileItem, enabled: boolean) {
  const scope = enabled ? apiClient.getConnectionScope() : '';
  const getSnapshot = useMemo(() => {
    if (!enabled) return noView;
    const select = createCodexResetViewSelector(file, enabled, scope);
    return () => select(useCodexResetStore.getState());
  }, [file, enabled, scope]);
  return useSyncExternalStore(
    enabled ? useCodexResetStore.subscribe : noSubscription,
    getSnapshot,
    getSnapshot
  );
}
