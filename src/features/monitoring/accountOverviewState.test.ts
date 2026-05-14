import { describe, expect, it } from 'vitest';
import type { MonitoringAccountRow, MonitoringEventRow } from './hooks/useMonitoringData';
import {
  ACCOUNT_OVERVIEW_CARD_PAGE_SIZE_OPTIONS,
  ACCOUNT_OVERVIEW_CARD_METRIC_KEYS,
  DEFAULT_ACCOUNT_SORT,
  buildEmptyMonitoringStatusData,
  buildMonitoringAccountAuthState,
  buildMonitoringAccountAuthStateMap,
  buildMonitoringAccountStatusDataMap,
  shouldClampAccountOverviewPage,
  shouldResetAccountOverviewPage,
  normalizeAccountOverviewPageSize,
  normalizeAccountOverviewMode,
  normalizeAccountOverviewUiState,
  normalizeAccountSortState,
  sortAccountRows,
} from './accountOverviewState';
import type { AuthFileItem } from '@/types';

const createAccountRow = (overrides: Partial<MonitoringAccountRow> = {}): MonitoringAccountRow => ({
  id: overrides.id ?? 'account',
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

const createEventRow = (overrides: Partial<MonitoringEventRow> = {}): MonitoringEventRow => ({
  id: overrides.id ?? 'row-1',
  timestamp: overrides.timestamp ?? '2026-05-10T00:00:00.000Z',
  timestampMs: overrides.timestampMs ?? Date.UTC(2026, 4, 10, 0, 0, 0),
  dayKey: overrides.dayKey ?? '2026-05-10',
  hourLabel: overrides.hourLabel ?? '00:00',
  model: overrides.model ?? 'gpt-4.1',
  endpoint: overrides.endpoint ?? '/v1/chat/completions',
  endpointMethod: overrides.endpointMethod ?? 'POST',
  endpointPath: overrides.endpointPath ?? '/v1/chat/completions',
  sourceKey: overrides.sourceKey ?? 'source-1',
  source: overrides.source ?? 'source-1',
  sourceMasked: overrides.sourceMasked ?? 'source-1',
  account: overrides.account ?? 'account@example.com',
  accountMasked: overrides.accountMasked ?? 'acc***@example.com',
  authIndex: overrides.authIndex ?? '1',
  authIndexMasked: overrides.authIndexMasked ?? '1',
  authLabel: overrides.authLabel ?? 'account@example.com',
  apiKeyHash: overrides.apiKeyHash ?? 'api-key-hash',
  apiKeyLabel: overrides.apiKeyLabel ?? 'ak********sh',
  apiKeyMasked: overrides.apiKeyMasked ?? 'ak********sh',
  provider: overrides.provider ?? 'codex',
  planType: overrides.planType ?? 'plus',
  channel: overrides.channel ?? 'default',
  channelHost: overrides.channelHost ?? 'localhost',
  channelDisabled: overrides.channelDisabled ?? false,
  failed: overrides.failed ?? false,
  statsIncluded: overrides.statsIncluded ?? true,
  latencyMs: overrides.latencyMs ?? 120,
  inputTokens: overrides.inputTokens ?? 10,
  outputTokens: overrides.outputTokens ?? 5,
  reasoningTokens: overrides.reasoningTokens ?? 0,
  cachedTokens: overrides.cachedTokens ?? 0,
  totalTokens: overrides.totalTokens ?? 15,
  totalCost: overrides.totalCost ?? 0.1,
  taskKey: overrides.taskKey ?? 'task-1',
  searchText: overrides.searchText ?? 'account@example.com codex gpt-4.1 default',
});

describe('accountOverviewState', () => {
  it('defaults invalid overview modes to table', () => {
    expect(normalizeAccountOverviewMode(undefined)).toBe('table');
    expect(normalizeAccountOverviewMode('grid')).toBe('table');
    expect(normalizeAccountOverviewMode('card')).toBe('card');
  });

  it('normalizes persisted overview ui state', () => {
    expect(
      normalizeAccountOverviewUiState({
        mode: 'card',
        sort: { key: 'totalCost', direction: 'asc' },
        cardPagination: { page: 3, pageSize: 18 },
      })
    ).toEqual({
      mode: 'card',
      sort: { key: 'totalCost', direction: 'asc' },
      cardPagination: { page: 3, pageSize: 18 },
    });

    expect(
      normalizeAccountOverviewUiState({
        mode: 'grid',
        sort: { key: 'bad' },
        cardPagination: { page: 0, pageSize: 11 },
      })
    ).toEqual({
      mode: 'table',
      sort: DEFAULT_ACCOUNT_SORT,
      cardPagination: { page: 1, pageSize: 12 },
    });
  });

  it('keeps the existing default account sort contract', () => {
    expect(DEFAULT_ACCOUNT_SORT).toEqual({ key: 'lastSeenAt', direction: 'desc' });
    expect(normalizeAccountSortState(undefined)).toEqual(DEFAULT_ACCOUNT_SORT);
  });

  it('sorts rows by the shared account sort state', () => {
    const slowAccount = createAccountRow({
      id: 'slow',
      account: 'slow@example.com',
      totalCalls: 4,
      totalCost: 3,
      lastSeenAt: 10,
    });
    const busyAccount = createAccountRow({
      id: 'busy',
      account: 'busy@example.com',
      totalCalls: 25,
      totalCost: 1,
      lastSeenAt: 2,
    });

    expect(
      sortAccountRows([slowAccount, busyAccount], { key: 'totalCalls', direction: 'desc' }).map(
        (row) => row.id
      )
    ).toEqual(['busy', 'slow']);

    expect(
      sortAccountRows([slowAccount, busyAccount], { key: 'lastSeenAt', direction: 'asc' }).map(
        (row) => row.id
      )
    ).toEqual(['busy', 'slow']);

    expect(
      sortAccountRows(
        [
          createAccountRow({ id: 'weak', account: 'weak@example.com', successRate: 0.75 }),
          createAccountRow({ id: 'strong', account: 'strong@example.com', successRate: 0.99 }),
        ],
        { key: 'successRate', direction: 'desc' }
      ).map((row) => row.id)
    ).toEqual(['strong', 'weak']);
  });

  it('exposes the requested metric keys for card mode', () => {
    expect(ACCOUNT_OVERVIEW_CARD_METRIC_KEYS).toEqual([
      'total-tokens',
      'input-tokens',
      'output-tokens',
      'cached-tokens',
    ]);
  });

  it('uses card-specific page sizes and normalizes invalid values', () => {
    expect(ACCOUNT_OVERVIEW_CARD_PAGE_SIZE_OPTIONS).toEqual([12, 18, 24, 36]);
    expect(normalizeAccountOverviewPageSize(10, 'card')).toBe(12);
    expect(normalizeAccountOverviewPageSize(18, 'card')).toBe(18);
    expect(normalizeAccountOverviewPageSize(12, 'table')).toBe(12);
    expect(normalizeAccountOverviewPageSize(10, 'table')).toBe(12);
    expect(normalizeAccountOverviewPageSize(20, 'table')).toBe(20);
  });

  it('does not reset persisted card pagination on first load or view-mode switch', () => {
    const baseState = {
      customEndInput: '',
      customStartInput: '',
      deferredSearch: '',
      selectedAccount: 'all',
      selectedChannel: 'all',
      selectedModel: 'all',
      selectedProvider: 'all',
      selectedStatus: 'all',
      timeRange: 'all' as const,
    };

    expect(shouldResetAccountOverviewPage(null, baseState)).toBe(false);
    expect(
      shouldResetAccountOverviewPage(baseState, {
        ...baseState,
      })
    ).toBe(false);
  });

  it('resets persisted card pagination when account filters actually change', () => {
    const previous = {
      customEndInput: '',
      customStartInput: '',
      deferredSearch: '',
      selectedAccount: 'all',
      selectedChannel: 'all',
      selectedModel: 'all',
      selectedProvider: 'all',
      selectedStatus: 'all',
      timeRange: 'all' as const,
    };

    expect(
      shouldResetAccountOverviewPage(previous, {
        ...previous,
        deferredSearch: 'abc',
      })
    ).toBe(true);
    expect(
      shouldResetAccountOverviewPage(previous, {
        ...previous,
        selectedStatus: 'failed',
      })
    ).toBe(true);
  });

  it('does not clamp restored card pagination while account data is still loading', () => {
    expect(shouldClampAccountOverviewPage(true, 3, 1)).toBe(false);
    expect(shouldClampAccountOverviewPage(false, 3, 1)).toBe(true);
    expect(shouldClampAccountOverviewPage(false, 3, 3)).toBe(false);
  });

  it('builds merged auth state for an account card', () => {
    const authFilesByIndex = new Map<string, AuthFileItem>([
      [
        '1',
        {
          name: 'alpha.json',
          authIndex: '1',
          disabled: false,
          recent_requests: [{ success: 2, failed: 1 }],
        },
      ],
      [
        '2',
        {
          name: 'beta.json',
          authIndex: '2',
          disabled: true,
          recent_requests: [{ success: 1, failed: 0 }],
        },
      ],
    ]);

    const result = buildMonitoringAccountAuthState(['1', '2'], authFilesByIndex);

    expect(result.enabledState).toBe('mixed');
    expect(result.files.map((file) => file.name)).toEqual(['alpha.json', 'beta.json']);
    expect(result.toggleableFileNames).toEqual(['alpha.json', 'beta.json']);
  });

  it('builds account auth state from all auth files that belong to the same account', () => {
    const authFilesByIndex = new Map<string, AuthFileItem>([
      [
        '1',
        {
          name: 'alpha.json',
          authIndex: '1',
          account: 'account@example.com',
          label: 'Alpha',
          disabled: false,
        },
      ],
      [
        '2',
        {
          name: 'beta.json',
          authIndex: '2',
          account: 'account@example.com',
          label: 'Beta',
          disabled: true,
        },
      ],
      [
        '3',
        {
          name: 'other.json',
          authIndex: '3',
          account: 'other@example.com',
          label: 'Other',
          disabled: false,
        },
      ],
    ]);

    const rows = [
      createAccountRow({
        id: 'account@example.com',
        account: 'account@example.com',
        authLabels: ['Alpha'],
        authIndices: ['1'],
      }),
    ];

    const result = buildMonitoringAccountAuthStateMap(rows, authFilesByIndex);
    const accountState = result.get('account@example.com');

    expect(accountState?.files.map((file) => file.name)).toEqual(['alpha.json', 'beta.json']);
    expect(accountState?.toggleableFileNames).toEqual(['alpha.json', 'beta.json']);
    expect(accountState?.enabledState).toBe('mixed');
  });

  it('does not merge auth files from a different account just because labels match', () => {
    const authFilesByIndex = new Map<string, AuthFileItem>([
      [
        '1',
        {
          name: 'alpha.json',
          authIndex: '1',
          account: 'primary@example.com',
          label: 'Shared Label',
          disabled: false,
        },
      ],
      [
        '2',
        {
          name: 'beta.json',
          authIndex: '2',
          account: 'secondary@example.com',
          label: 'Shared Label',
          disabled: false,
        },
      ],
    ]);

    const rows = [
      createAccountRow({
        id: 'primary@example.com',
        account: 'primary@example.com',
        authLabels: ['Shared Label'],
        authIndices: ['1'],
      }),
    ];

    const result = buildMonitoringAccountAuthStateMap(rows, authFilesByIndex);
    const accountState = result.get('primary@example.com');

    expect(accountState?.files.map((file) => file.name)).toEqual(['alpha.json']);
    expect(accountState?.toggleableFileNames).toEqual(['alpha.json']);
    expect(accountState?.enabledState).toBe('enabled');
  });

  it('builds account health status from filtered monitoring rows within the selected range', () => {
    const startMs = Date.UTC(2026, 4, 10, 0, 0, 0);
    const endMs = Date.UTC(2026, 4, 17, 0, 0, 0) - 1;
    const rows = [
      createEventRow({
        id: 'start-success',
        timestampMs: startMs,
        failed: false,
        authIndex: '1',
      }),
      createEventRow({
        id: 'late-failure',
        timestampMs: endMs,
        failed: true,
        authIndex: '1',
      }),
      createEventRow({
        id: 'out-of-range-success',
        timestampMs: startMs - 60_000,
        failed: false,
        authIndex: '1',
      }),
      createEventRow({
        id: 'other-account',
        timestampMs: startMs + 30 * 60_000,
        account: 'other@example.com',
        authLabel: 'other@example.com',
        authIndex: '2',
      }),
    ];

    const result = buildMonitoringAccountStatusDataMap(rows, { startMs, endMs });
    const accountStatus = result.get('account@example.com');
    const otherStatus = result.get('other@example.com');

    expect(accountStatus).toBeDefined();
    expect(accountStatus?.totalSuccess).toBe(1);
    expect(accountStatus?.totalFailure).toBe(1);
    expect(accountStatus?.blockDetails).toHaveLength(20);
    expect(accountStatus?.blockDetails[0]).toMatchObject({ success: 1, failure: 0 });
    expect(accountStatus?.blockDetails[19]).toMatchObject({ success: 0, failure: 1 });

    expect(otherStatus?.totalSuccess).toBe(1);
    expect(otherStatus?.totalFailure).toBe(0);
  });

  it('builds 20 idle buckets for empty account health fallback data', () => {
    const startMs = Date.UTC(2026, 4, 10, 0, 0, 0);
    const endMs = Date.UTC(2026, 4, 17, 0, 0, 0) - 1;

    const statusData = buildEmptyMonitoringStatusData({ startMs, endMs });

    expect(statusData.blocks).toHaveLength(20);
    expect(statusData.blocks.every((block) => block === 'idle')).toBe(true);
    expect(statusData.blockDetails).toHaveLength(20);
    expect(
      statusData.blockDetails.every(
        (detail) =>
          detail.success === 0 &&
          detail.failure === 0 &&
          detail.rate === -1 &&
          detail.startTime >= startMs &&
          detail.endTime <= endMs
      )
    ).toBe(true);
  });

  it('builds account health status for all range by resolving a finite start bound', () => {
    const startMs = Date.UTC(2026, 4, 10, 0, 0, 0);
    const endMs = Date.UTC(2026, 4, 17, 0, 0, 0) - 1;
    const rows = [
      createEventRow({
        id: 'start-success',
        timestampMs: startMs,
        failed: false,
        authIndex: '1',
      }),
      createEventRow({
        id: 'late-failure',
        timestampMs: endMs,
        failed: true,
        authIndex: '1',
      }),
    ];

    const result = buildMonitoringAccountStatusDataMap(rows, {
      startMs: Number.NEGATIVE_INFINITY,
      endMs,
    });
    const accountStatus = result.get('account@example.com');

    expect(accountStatus).toBeDefined();
    expect(accountStatus?.totalSuccess).toBe(1);
    expect(accountStatus?.totalFailure).toBe(1);
    expect(accountStatus?.blockDetails).toHaveLength(20);
    expect(accountStatus?.blockDetails[0]).toMatchObject({ success: 1, failure: 0 });
    expect(accountStatus?.blockDetails[19]).toMatchObject({ success: 0, failure: 1 });
  });
});
