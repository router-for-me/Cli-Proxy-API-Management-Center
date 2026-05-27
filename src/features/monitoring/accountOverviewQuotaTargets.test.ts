import { describe, expect, it } from 'vitest';
import type { MonitoringAccountRow } from './hooks/useMonitoringData';
import type { MonitoringAccountAuthState } from './accountOverviewState';
import { buildMonitoringAccountQuotaTargetsByAccount } from './accountOverviewQuotaTargets';

const createAccountRow = (overrides: Partial<MonitoringAccountRow> = {}): MonitoringAccountRow => ({
  id: overrides.id ?? 'account@example.com',
  account: overrides.account ?? 'account@example.com',
  displayAccount: overrides.displayAccount ?? overrides.account ?? 'account@example.com',
  accountMasked: overrides.accountMasked ?? 'acc***@example.com',
  authLabels: overrides.authLabels ?? [],
  authIndices: overrides.authIndices ?? [],
  channels: overrides.channels ?? [],
  totalCalls: overrides.totalCalls ?? 0,
  successCalls: overrides.successCalls ?? 0,
  failureCalls: overrides.failureCalls ?? 0,
  successRate: overrides.successRate ?? 1,
  inputTokens: overrides.inputTokens ?? 0,
  outputTokens: overrides.outputTokens ?? 0,
  cachedTokens: overrides.cachedTokens ?? 0,
  totalTokens: overrides.totalTokens ?? 0,
  totalCost: overrides.totalCost ?? 0,
  averageLatencyMs: overrides.averageLatencyMs ?? null,
  lastSeenAt: overrides.lastSeenAt ?? 0,
  recentPattern: overrides.recentPattern ?? [],
  models: overrides.models ?? [],
});

describe('accountOverviewQuotaTargets', () => {
  it('builds quota targets from the full account auth state instead of filtered row auth indices', () => {
    const authStateByRowId = new Map<string, MonitoringAccountAuthState>([
      [
        'account@example.com',
        {
          files: [
            {
              name: 'alpha.json',
              type: 'codex',
              authIndex: '1',
              label: 'Alpha',
              account: 'account@example.com',
            },
            {
              name: 'beta.json',
              type: 'codex',
              authIndex: '2',
              label: 'Beta',
              account: 'account@example.com',
            },
          ],
          toggleableFileNames: ['alpha.json', 'beta.json'],
          enabledState: 'enabled',
        },
      ],
    ]);

    const result = buildMonitoringAccountQuotaTargetsByAccount(
      [
        createAccountRow({
          id: 'account@example.com',
          account: 'account@example.com',
          authIndices: ['1'],
          authLabels: ['Alpha'],
        }),
      ],
      authStateByRowId
    );

    expect(result.get('account@example.com')).toMatchObject([
      { authIndex: '1', fileName: 'alpha.json', authLabel: 'Alpha', provider: 'codex' },
      { authIndex: '2', fileName: 'beta.json', authLabel: 'Beta', provider: 'codex' },
    ]);
  });

  it('keeps Codex quota targets when the account id is unavailable', () => {
    const authStateByRowId = new Map<string, MonitoringAccountAuthState>([
      [
        'account@example.com',
        {
          files: [
            {
              name: 'codex-without-account.json',
              type: 'codex',
              authIndex: '1',
              label: 'Codex',
              account: 'account@example.com',
            },
          ],
          toggleableFileNames: ['codex-without-account.json'],
          enabledState: 'enabled',
        },
      ],
    ]);

    const result = buildMonitoringAccountQuotaTargetsByAccount(
      [
        createAccountRow({
          id: 'account@example.com',
          account: 'account@example.com',
          authIndices: ['1'],
          authLabels: ['Codex'],
        }),
      ],
      authStateByRowId
    );

    expect(result.get('account@example.com')).toMatchObject([
      {
        authIndex: '1',
        fileName: 'codex-without-account.json',
        accountId: null,
        provider: 'codex',
      },
    ]);
  });

  it('builds targets for every supported provider including non-codex files', () => {
    const authStateByRowId = new Map<string, MonitoringAccountAuthState>([
      [
        'shared@example.com',
        {
          files: [
            {
              name: 'codex.json',
              type: 'codex',
              authIndex: '1',
              label: 'Codex',
              account: 'shared@example.com',
            },
            {
              name: 'claude.json',
              type: 'claude',
              authIndex: '2',
              label: 'Claude',
              account: 'shared@example.com',
            },
            {
              name: 'antigravity.json',
              type: 'antigravity',
              authIndex: '3',
              label: 'Antigravity',
              account: 'shared@example.com',
            },
            {
              name: 'gemini-cli.json',
              type: 'gemini-cli',
              authIndex: '4',
              label: 'Gemini',
              account: 'shared@example.com',
            },
            {
              name: 'kimi.json',
              type: 'kimi',
              authIndex: '5',
              label: 'Kimi',
              account: 'shared@example.com',
            },
            {
              name: 'xai.json',
              type: 'xai',
              authIndex: '6',
              label: 'Xai',
              account: 'shared@example.com',
            },
          ],
          toggleableFileNames: [
            'codex.json',
            'claude.json',
            'antigravity.json',
            'gemini-cli.json',
            'kimi.json',
            'xai.json',
          ],
          enabledState: 'enabled',
        },
      ],
    ]);

    const result = buildMonitoringAccountQuotaTargetsByAccount(
      [
        createAccountRow({
          id: 'shared@example.com',
          account: 'shared@example.com',
          authIndices: ['1', '2', '3', '4', '5', '6'],
          authLabels: ['Codex', 'Claude', 'Antigravity', 'Gemini', 'Kimi', 'Xai'],
        }),
      ],
      authStateByRowId
    );

    const providers = result.get('shared@example.com')?.map((target) => target.provider);
    expect(providers).toEqual(['antigravity', 'claude', 'codex', 'gemini-cli', 'kimi', 'xai']);
  });

  it('recognizes xAI files when stored under the x-ai or grok alias', () => {
    const authStateByRowId = new Map<string, MonitoringAccountAuthState>([
      [
        'grok@example.com',
        {
          files: [
            {
              name: 'grok-a.json',
              type: 'x-ai',
              authIndex: '1',
              label: 'GrokA',
              account: 'grok@example.com',
            },
            {
              name: 'grok-b.json',
              type: 'grok',
              authIndex: '2',
              label: 'GrokB',
              account: 'grok@example.com',
            },
          ],
          toggleableFileNames: ['grok-a.json', 'grok-b.json'],
          enabledState: 'enabled',
        },
      ],
    ]);

    const result = buildMonitoringAccountQuotaTargetsByAccount(
      [
        createAccountRow({
          id: 'grok@example.com',
          account: 'grok@example.com',
          authIndices: ['1', '2'],
          authLabels: ['GrokA', 'GrokB'],
        }),
      ],
      authStateByRowId
    );

    expect(result.get('grok@example.com')).toMatchObject([
      { provider: 'xai', fileName: 'grok-a.json' },
      { provider: 'xai', fileName: 'grok-b.json' },
    ]);
  });

  it('skips disabled and gemini-cli runtime-only files', () => {
    const authStateByRowId = new Map<string, MonitoringAccountAuthState>([
      [
        'mixed@example.com',
        {
          files: [
            {
              name: 'codex-disabled.json',
              type: 'codex',
              authIndex: '1',
              label: 'CodexDisabled',
              account: 'mixed@example.com',
              disabled: true,
            },
            {
              name: 'gemini-runtime.json',
              type: 'gemini-cli',
              authIndex: '2',
              label: 'GeminiRuntime',
              account: 'mixed@example.com',
              runtime_only: true,
            },
            {
              name: 'claude-active.json',
              type: 'claude',
              authIndex: '3',
              label: 'ClaudeActive',
              account: 'mixed@example.com',
            },
          ],
          toggleableFileNames: ['claude-active.json'],
          enabledState: 'enabled',
        },
      ],
    ]);

    const result = buildMonitoringAccountQuotaTargetsByAccount(
      [
        createAccountRow({
          id: 'mixed@example.com',
          account: 'mixed@example.com',
          authIndices: ['1', '2', '3'],
          authLabels: ['CodexDisabled', 'GeminiRuntime', 'ClaudeActive'],
        }),
      ],
      authStateByRowId
    );

    expect(result.get('mixed@example.com')).toMatchObject([
      { provider: 'claude', fileName: 'claude-active.json' },
    ]);
  });

  it('ignores files whose provider is unsupported', () => {
    const authStateByRowId = new Map<string, MonitoringAccountAuthState>([
      [
        'unsupported@example.com',
        {
          files: [
            {
              name: 'qwen.json',
              type: 'qwen',
              authIndex: '1',
              label: 'Qwen',
              account: 'unsupported@example.com',
            },
            {
              name: 'codex.json',
              type: 'codex',
              authIndex: '2',
              label: 'Codex',
              account: 'unsupported@example.com',
            },
          ],
          toggleableFileNames: ['qwen.json', 'codex.json'],
          enabledState: 'enabled',
        },
      ],
    ]);

    const result = buildMonitoringAccountQuotaTargetsByAccount(
      [
        createAccountRow({
          id: 'unsupported@example.com',
          account: 'unsupported@example.com',
          authIndices: ['1', '2'],
          authLabels: ['Qwen', 'Codex'],
        }),
      ],
      authStateByRowId
    );

    expect(result.get('unsupported@example.com')).toMatchObject([
      { provider: 'codex', fileName: 'codex.json' },
    ]);
  });

  it('excludes co-resident provider files the account never actually requested', () => {
    const authStateByRowId = new Map<string, MonitoringAccountAuthState>([
      [
        'dudufast91@gmail.com',
        {
          files: [
            {
              name: 'antigravity-dudu.json',
              type: 'antigravity',
              authIndex: '10',
              label: 'AntigravityDudu',
              account: 'dudufast91@gmail.com',
            },
            {
              name: 'codex-dudu.json',
              type: 'codex',
              authIndex: '11',
              label: 'CodexDudu',
              account: 'dudufast91@gmail.com',
            },
          ],
          toggleableFileNames: ['antigravity-dudu.json', 'codex-dudu.json'],
          enabledState: 'enabled',
        },
      ],
    ]);

    const result = buildMonitoringAccountQuotaTargetsByAccount(
      [
        createAccountRow({
          id: 'dudufast91@gmail.com',
          account: 'dudufast91@gmail.com',
          authIndices: ['10'],
          authLabels: ['AntigravityDudu'],
        }),
      ],
      authStateByRowId
    );

    expect(result.get('dudufast91@gmail.com')).toMatchObject([
      { provider: 'antigravity', fileName: 'antigravity-dudu.json' },
    ]);
  });

  it('still includes sibling files of the same provider that were not directly requested', () => {
    const authStateByRowId = new Map<string, MonitoringAccountAuthState>([
      [
        'team@example.com',
        {
          files: [
            {
              name: 'codex-primary.json',
              type: 'codex',
              authIndex: '20',
              label: 'CodexPrimary',
              account: 'team@example.com',
            },
            {
              name: 'codex-secondary.json',
              type: 'codex',
              authIndex: '21',
              label: 'CodexSecondary',
              account: 'team@example.com',
            },
            {
              name: 'claude-other.json',
              type: 'claude',
              authIndex: '22',
              label: 'ClaudeOther',
              account: 'team@example.com',
            },
          ],
          toggleableFileNames: ['codex-primary.json', 'codex-secondary.json', 'claude-other.json'],
          enabledState: 'enabled',
        },
      ],
    ]);

    const result = buildMonitoringAccountQuotaTargetsByAccount(
      [
        createAccountRow({
          id: 'team@example.com',
          account: 'team@example.com',
          authIndices: ['20'],
          authLabels: ['CodexPrimary'],
        }),
      ],
      authStateByRowId
    );

    expect(result.get('team@example.com')).toMatchObject([
      { provider: 'codex', fileName: 'codex-primary.json' },
      { provider: 'codex', fileName: 'codex-secondary.json' },
    ]);
  });

  it('returns no targets when the account row has no observed auth indices', () => {
    const authStateByRowId = new Map<string, MonitoringAccountAuthState>([
      [
        'empty@example.com',
        {
          files: [
            {
              name: 'codex.json',
              type: 'codex',
              authIndex: '30',
              label: 'Codex',
              account: 'empty@example.com',
            },
          ],
          toggleableFileNames: ['codex.json'],
          enabledState: 'enabled',
        },
      ],
    ]);

    const result = buildMonitoringAccountQuotaTargetsByAccount(
      [
        createAccountRow({
          id: 'empty@example.com',
          account: 'empty@example.com',
          authIndices: [],
          authLabels: [],
        }),
      ],
      authStateByRowId
    );

    expect(result.get('empty@example.com')).toEqual([]);
  });
});
