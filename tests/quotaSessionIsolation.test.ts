import { beforeEach, describe, expect, test } from 'bun:test';
import { invalidateAuthFileDerivedCaches } from '../src/features/authFiles/cacheInvalidation';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '../src/stores/useQuotaStore';

describe('quota cache session isolation', () => {
  beforeEach(() => {
    useQuotaStore.getState().clearQuotaCache();
  });

  test('prevents an earlier connection from committing after the cache is cleared', () => {
    const previousConnection = captureQuotaCacheGeneration();
    let committed = false;

    useQuotaStore.getState().clearQuotaCache();

    expect(
      commitIfQuotaCacheCurrent(previousConnection, () => {
        committed = true;
      })
    ).toBe(false);
    expect(committed).toBe(false);
  });

  test('allows the current connection generation to commit', () => {
    const currentConnection = captureQuotaCacheGeneration();
    let committed = false;

    expect(
      commitIfQuotaCacheCurrent(currentConnection, () => {
        committed = true;
      })
    ).toBe(true);
    expect(committed).toBe(true);
  });

  test('clears same-name quota and rejects an in-flight commit after auth mutation', () => {
    const fileName = 'shared-codex.json';
    useQuotaStore.getState().setCodexQuota({
      [fileName]: {
        status: 'success',
        windows: [],
        planType: 'account-a',
      },
    });
    const accountARequest = captureQuotaCacheGeneration();
    let invalidatedNames: string[] | undefined;

    invalidateAuthFileDerivedCaches(
      (names) => {
        invalidatedNames = names;
      },
      [fileName]
    );

    expect(invalidatedNames).toEqual([fileName]);
    expect(useQuotaStore.getState().codexQuota[fileName]).toBeUndefined();

    let committed = false;
    expect(
      commitIfQuotaCacheCurrent(accountARequest, () => {
        committed = true;
      })
    ).toBe(false);
    expect(committed).toBe(false);
  });
});
