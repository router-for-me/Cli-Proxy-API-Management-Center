import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthFileItem } from '@/types';
import { authFilesApi } from '@/services/api/authFiles';
import {
  CODEX_INSPECTION_LAST_RUN_STORAGE_KEY,
  CODEX_INSPECTION_SETTINGS_STORAGE_KEY,
  createCodexInspectionConnectionFingerprint,
  executeCodexInspectionActions,
  hydrateCodexInspectionLastRun,
  loadCodexInspectionConfigurableSettings,
  loadCodexInspectionLastRun,
  resolveCodexInspectionAutoActionItems,
  saveCodexInspectionLastRun,
  type CodexInspectionAction,
  type CodexInspectionResultItem,
  type CodexInspectionRunResult,
} from './codexInspection';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    clear: vi.fn(() => {
      values.clear();
    }),
  } as unknown as Storage;
};

const createResultItem = (
  action: CodexInspectionAction,
  overrides: Partial<CodexInspectionResultItem> = {}
): CodexInspectionResultItem => ({
  key: overrides.key ?? `${action}.json::1`,
  fileName: overrides.fileName ?? `${action}.json`,
  displayAccount: overrides.displayAccount ?? `${action}@example.com`,
  authIndex: overrides.authIndex ?? '1',
  accountId: overrides.accountId ?? 'account-1',
  provider: overrides.provider ?? 'codex',
  disabled: overrides.disabled ?? false,
  status: overrides.status ?? '',
  state: overrides.state ?? '',
  raw:
    overrides.raw ??
    ({
      name: `${action}.json`,
      type: 'codex',
      access_token: 'raw-secret-token',
    } as AuthFileItem),
  action,
  actionReason: overrides.actionReason ?? 'reason',
  statusCode: overrides.statusCode ?? (action === 'delete' ? 401 : 200),
  usedPercent: overrides.usedPercent ?? null,
  isQuota: overrides.isQuota ?? false,
  error: overrides.error ?? '',
});

const createRunResult = (): CodexInspectionRunResult => {
  const results = [createResultItem('delete')];
  return {
    settings: {
      baseUrl: 'https://secret.example.test',
      token: 'management-secret-token',
      targetType: 'codex',
      workers: 2,
      deleteWorkers: 1,
      timeout: 1000,
      retries: 0,
      userAgent: 'test-agent',
      usedPercentThreshold: 90,
      sampleSize: 0,
    },
    files: [
      {
        name: 'delete.json',
        type: 'codex',
        access_token: 'file-secret-token',
      } as AuthFileItem,
    ],
    results,
    summary: {
      totalFiles: 1,
      probeSetCount: 1,
      sampledCount: 1,
      disabledCount: 0,
      enabledCount: 1,
      deleteCount: 1,
      disableCount: 0,
      enableCount: 0,
      keepCount: 0,
      usedPercentThreshold: 90,
      sampled: false,
      plannedActionPreview: ['delete@example.com -> delete'],
    },
    startedAt: 1000,
    finishedAt: 2000,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Codex inspection settings', () => {
  it('migrates legacy auto execute settings to auto disable', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem(CODEX_INSPECTION_SETTINGS_STORAGE_KEY, JSON.stringify({ autoExecuteActions: true }));

    expect(loadCodexInspectionConfigurableSettings(null).autoActionMode).toBe('disable');
  });
});

describe('resolveCodexInspectionAutoActionItems', () => {
  const deleteItem = createResultItem('delete');
  const disableItem = createResultItem('disable');
  const enableItem = createResultItem('enable');

  it('does nothing when automatic mode is none', () => {
    expect(resolveCodexInspectionAutoActionItems('none', [deleteItem, disableItem, enableItem])).toEqual([]);
  });

  it('turns delete suggestions into disable actions in auto disable mode', () => {
    const items = resolveCodexInspectionAutoActionItems('disable', [
      deleteItem,
      disableItem,
      enableItem,
    ]);

    expect(items.map((item) => [item.fileName, item.action])).toEqual([
      ['delete.json', 'disable'],
      ['disable.json', 'disable'],
    ]);
  });

  it('keeps delete and disable suggestions in auto delete mode', () => {
    const items = resolveCodexInspectionAutoActionItems('delete', [
      deleteItem,
      disableItem,
      enableItem,
    ]);

    expect(items.map((item) => [item.fileName, item.action])).toEqual([
      ['delete.json', 'delete'],
      ['disable.json', 'disable'],
    ]);
  });
});

describe('executeCodexInspectionActions', () => {
  it('uses action concurrency for disable and enable operations', async () => {
    let activeStatusUpdates = 0;
    let maxStatusUpdates = 0;

    vi.spyOn(authFilesApi, 'setStatusWithFallback').mockImplementation(async () => {
      activeStatusUpdates += 1;
      maxStatusUpdates = Math.max(maxStatusUpdates, activeStatusUpdates);
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      activeStatusUpdates -= 1;
      return {} as Awaited<ReturnType<typeof authFilesApi.setStatusWithFallback>>;
    });
    vi.spyOn(authFilesApi, 'list').mockResolvedValue({ files: [] });

    const execution = await executeCodexInspectionActions({
      settings: {
        ...createRunResult().settings,
        workers: 10,
        deleteWorkers: 1,
      },
      items: [
        createResultItem('disable', { fileName: 'disable-a.json' }),
        createResultItem('disable', { fileName: 'disable-b.json' }),
        createResultItem('enable', { fileName: 'enable-a.json' }),
      ],
      previousFiles: [],
    });

    expect(execution.outcomes).toHaveLength(3);
    expect(maxStatusUpdates).toBe(1);
  });
});

describe('Codex inspection last-run cache', () => {
  it('creates stable connection fingerprints without storing raw inputs', () => {
    const fingerprint = createCodexInspectionConnectionFingerprint(
      'https://cpa.example.test/',
      'management-secret-token'
    );

    expect(fingerprint).toBe(
      createCodexInspectionConnectionFingerprint('https://cpa.example.test', 'management-secret-token')
    );
    expect(fingerprint).not.toContain('management-secret-token');
    expect(fingerprint).not.toContain('cpa.example.test');
    expect(fingerprint).not.toBe(
      createCodexInspectionConnectionFingerprint('https://cpa.example.test', 'other-token')
    );
  });

  it('sanitizes raw auth data before saving browser cache', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);

    const restored = saveCodexInspectionLastRun({
      result: createRunResult(),
      logs: [{ id: 'log-1', level: 'info', message: 'done', timestamp: 2000 }],
      logsCollapsed: true,
      actionFilter: 'delete',
    });

    const raw = storage.getItem(CODEX_INSPECTION_LAST_RUN_STORAGE_KEY);
    expect(raw).toBeTypeOf('string');
    expect(raw).not.toContain('management-secret-token');
    expect(raw).not.toContain('file-secret-token');
    expect(raw).not.toContain('raw-secret-token');
    expect(raw).not.toContain('https://secret.example.test');
    expect(restored?.result.files).toEqual([]);
    expect(restored?.result.results[0].raw).toEqual({
      name: 'delete.json',
      type: 'codex',
      authIndex: '1',
      disabled: false,
    });
  });

  it('ignores incompatible cached payloads', () => {
    expect(hydrateCodexInspectionLastRun({ version: 999 })).toBeNull();
  });

  it('ignores cached payloads that do not match the active connection', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    const expectedFingerprint = createCodexInspectionConnectionFingerprint(
      'https://cpa-a.example.test',
      'token-a'
    );
    const otherFingerprint = createCodexInspectionConnectionFingerprint(
      'https://cpa-b.example.test',
      'token-b'
    );

    saveCodexInspectionLastRun({
      result: createRunResult(),
      connectionFingerprint: expectedFingerprint,
    });

    expect(loadCodexInspectionLastRun(expectedFingerprint)?.result.results).toHaveLength(1);
    expect(loadCodexInspectionLastRun(otherFingerprint)).toBeNull();
  });

  it('does not restore legacy cached payloads when an active connection is provided', () => {
    const restored = hydrateCodexInspectionLastRun(
      {
        version: 1,
        savedAt: 2000,
        result: {
          settings: createRunResult().settings,
          results: [createResultItem('delete')],
          summary: createRunResult().summary,
          startedAt: 1000,
          finishedAt: 2000,
        },
        logs: [],
      },
      { expectedConnectionFingerprint: 'v1:active-connection' }
    );

    expect(restored).toBeNull();
  });

  it('restores completed runs that have no result rows', () => {
    const restored = hydrateCodexInspectionLastRun({
      version: 1,
      savedAt: 2000,
      result: {
        settings: {
          targetType: 'codex',
          workers: 2,
          deleteWorkers: 1,
          timeout: 1000,
          retries: 0,
          userAgent: 'test-agent',
          usedPercentThreshold: 90,
          sampleSize: 0,
        },
        results: [],
        summary: {
          totalFiles: 0,
          probeSetCount: 0,
          sampledCount: 0,
          sampled: false,
          usedPercentThreshold: 90,
        },
        startedAt: 1000,
        finishedAt: 2000,
      },
      logs: [],
    });

    expect(restored?.result.results).toEqual([]);
    expect(restored?.result.summary.sampledCount).toBe(0);
  });

  it('loads sanitized last-run records from storage', () => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    saveCodexInspectionLastRun({
      result: createRunResult(),
      logs: [{ id: 'log-1', level: 'success', message: 'done', timestamp: 2000 }],
      actionFilter: 'delete',
    });

    const loaded = loadCodexInspectionLastRun();

    expect(loaded?.actionFilter).toBe('delete');
    expect(loaded?.logs).toHaveLength(1);
    expect(loaded?.result.summary.deleteCount).toBe(1);
  });
});
