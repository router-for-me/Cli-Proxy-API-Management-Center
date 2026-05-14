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
            {
              name: 'gamma.json',
              type: 'claude',
              authIndex: '3',
              label: 'Gamma',
              account: 'account@example.com',
            },
          ],
          toggleableFileNames: ['alpha.json', 'beta.json', 'gamma.json'],
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
      { authIndex: '1', fileName: 'alpha.json', authLabel: 'Alpha' },
      { authIndex: '2', fileName: 'beta.json', authLabel: 'Beta' },
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
      },
    ]);
  });
});
