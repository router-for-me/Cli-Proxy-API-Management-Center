import { describe, expect, it } from 'vitest';
import {
  buildAccountRows,
  buildApiKeyRows,
  buildApiKeyDisplayMap,
  buildMonitoringFilterFacetsFromSummary,
  buildRangeFilteredRows,
  buildMonitoringAuthMetaMap,
  type MonitoringEventRow,
} from './useMonitoringData';
import { sha256Hex } from '@/utils/apiKeyHash';
import type { AuthFileItem } from '@/types';

const createMonitoringEventRow = (
  overrides: Partial<MonitoringEventRow> = {}
): MonitoringEventRow => ({
  id: overrides.id ?? 'row-1',
  timestamp: overrides.timestamp ?? '2026-05-09T01:12:43.000Z',
  timestampMs: overrides.timestampMs ?? Date.parse('2026-05-09T01:12:43.000Z'),
  dayKey: overrides.dayKey ?? '2026-05-09',
  hourLabel: overrides.hourLabel ?? '01:00',
  model: overrides.model ?? 'gpt-4.1',
  endpoint: overrides.endpoint ?? '/v1/chat/completions',
  endpointMethod: overrides.endpointMethod ?? 'POST',
  endpointPath: overrides.endpointPath ?? '/v1/chat/completions',
  sourceKey: overrides.sourceKey ?? 'source:alpha',
  source: overrides.source ?? 'alpha.json',
  sourceMasked: overrides.sourceMasked ?? 'a***',
  account: overrides.account ?? 'amount-myth-resend@duck.com',
  accountMasked: overrides.accountMasked ?? 'amo***@duck.com',
  authIndex: overrides.authIndex ?? 'auth-123456',
  authIndexMasked: overrides.authIndexMasked ?? 'auth...3456',
  authLabel: overrides.authLabel ?? 'alpha.json',
  apiKeyHash: overrides.apiKeyHash ?? 'api-key-hash',
  apiKeyLabel: overrides.apiKeyLabel ?? 'ak********sh',
  apiKeyMasked: overrides.apiKeyMasked ?? 'ak********sh',
  provider: overrides.provider ?? 'codex',
  projectId: overrides.projectId ?? '',
  planType: overrides.planType ?? 'pro',
  channel: overrides.channel ?? 'codex',
  channelHost: overrides.channelHost ?? 'example.com',
  channelDisabled: overrides.channelDisabled ?? false,
  failed: overrides.failed ?? false,
  requestCount: overrides.requestCount ?? 1,
  successCalls: overrides.successCalls ?? (overrides.failed ? 0 : 1),
  failureCalls: overrides.failureCalls ?? (overrides.failed ? 1 : 0),
  statsIncluded: overrides.statsIncluded ?? true,
  latencyMs: overrides.latencyMs ?? 1200,
  latencySumMs: overrides.latencySumMs ?? overrides.latencyMs ?? 1200,
  latencyCount: overrides.latencyCount ?? 1,
  inputTokens: overrides.inputTokens ?? 10,
  outputTokens: overrides.outputTokens ?? 5,
  reasoningTokens: overrides.reasoningTokens ?? 0,
  cachedTokens: overrides.cachedTokens ?? 3,
  totalTokens: overrides.totalTokens ?? 18,
  totalCost: overrides.totalCost ?? 0.12,
  taskKey: overrides.taskKey ?? 'task-1',
  searchText: overrides.searchText ?? 'amount myth resend',
});

describe('buildAccountRows', () => {
  it('keeps raw auth indices for account-level auth file linking', () => {
    const rows = buildAccountRows([
      createMonitoringEventRow(),
      createMonitoringEventRow({
        id: 'row-2',
        timestampMs: Date.parse('2026-05-09T02:12:43.000Z'),
        authIndex: 'auth-999999',
        authIndexMasked: 'auth...9999',
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].authIndices).toEqual(['auth-123456', 'auth-999999']);
  });
});

describe('buildApiKeyRows', () => {
  it('groups rows by api key and prefers alias labels in the summary row', () => {
    const rows = buildApiKeyRows([
      createMonitoringEventRow({
        apiKeyHash: 'hash-1',
        apiKeyLabel: 'sk-***-1',
        apiKeyMasked: 'sk-***-1',
        model: 'gpt-5',
        totalCost: 0.25,
      }),
      createMonitoringEventRow({
        id: 'row-2',
        timestampMs: Date.parse('2026-05-09T03:12:43.000Z'),
        apiKeyHash: 'hash-1',
        apiKeyLabel: 'Team Alpha',
        apiKeyMasked: 'sk-***-1',
        model: 'gpt-4.1',
        failed: true,
        totalCost: 0.4,
        inputTokens: 30,
        outputTokens: 12,
        cachedTokens: 5,
        totalTokens: 47,
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].apiKeyLabel).toBe('Team Alpha');
    expect(rows[0].apiKeyMasked).toBe('sk-***-1');
    expect(rows[0].totalCalls).toBe(2);
    expect(rows[0].successCalls).toBe(1);
    expect(rows[0].failureCalls).toBe(1);
    expect(rows[0].totalCost).toBeCloseTo(0.65);
    expect(rows[0].successRate).toBe(0.5);
    expect(rows[0].lastSeenAt).toBe(Date.parse('2026-05-09T03:12:43.000Z'));
    expect(rows[0].models.map((model) => model.model)).toEqual(['gpt-4.1', 'gpt-5']);
  });

  it('uses stable fallback groups for unknown client api keys', () => {
    const rows = buildApiKeyRows([
      createMonitoringEventRow({
        sourceKey: 'source:alpha',
        authIndex: 'auth-a',
        authLabel: 'alpha',
        apiKeyHash: '',
        apiKeyLabel: '',
        apiKeyMasked: '',
      }),
      createMonitoringEventRow({
        id: 'row-2',
        sourceKey: 'source:beta',
        authIndex: 'auth-b',
        authLabel: 'beta',
        apiKeyHash: '',
        apiKeyLabel: '',
        apiKeyMasked: '',
        model: 'gpt-5.5',
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.isUnknown)).toBe(true);
    expect(rows[0].authLabels.length).toBeGreaterThan(0);
    expect(rows[0].id).not.toBe(rows[1].id);
  });
});

describe('buildRangeFilteredRows', () => {
  it('applies api key hash filtering even when the search query is empty', () => {
    const rows = buildRangeFilteredRows(
      [
        createMonitoringEventRow({ apiKeyHash: 'hash-a' }),
        createMonitoringEventRow({ id: 'row-2', apiKeyHash: 'hash-b' }),
      ],
      'all',
      null,
      '',
      'hash-b'
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].apiKeyHash).toBe('hash-b');
  });

  it('matches text search when the derived api key hash does not match', () => {
    const rows = buildRangeFilteredRows(
      [
        createMonitoringEventRow({ apiKeyHash: 'hash-a', searchText: 'kongwenpeng codex' }),
        createMonitoringEventRow({ id: 'row-2', apiKeyHash: 'hash-b', searchText: 'other alias' }),
      ],
      'all',
      null,
      'KongWenpeng',
      sha256Hex('KongWenpeng')
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].apiKeyHash).toBe('hash-a');
  });
});

describe('buildMonitoringAuthMetaMap', () => {
  it('maps legacy auth indices to current auth metadata', () => {
    const authFiles: AuthFileItem[] = [
      {
        name: 'alice.json',
        provider: 'codex',
        authIndex: 'current-auth-index',
        path: '/tmp/auths/alice.json',
        account: 'alice@example.com',
      },
    ];

    const map = buildMonitoringAuthMetaMap(authFiles);

    expect(map.get('current-auth-index')?.account).toBe('alice@example.com');
    expect(map.get('6bf749cb7db0e15c')?.account).toBe('alice@example.com');
  });
});

describe('buildApiKeyDisplayMap', () => {
  it('prefers stored aliases while preserving masked configured keys', () => {
    const apiKey = 'sk-alias-test-key';
    const apiKeyHash = sha256Hex(apiKey);
    const map = buildApiKeyDisplayMap([apiKey], [{ apiKeyHash, alias: 'Team A', updatedAtMs: 1 }]);

    expect(map.get(apiKeyHash)?.label).toBe('Team A');
    expect(map.get(apiKeyHash)?.masked).toMatch(/^sk/);
  });

  it('masks aliases that look like full secrets before showing them in the ui', () => {
    const apiKey = 'sk-live-real-key';
    const apiKeyHash = sha256Hex(apiKey);
    const map = buildApiKeyDisplayMap(
      [apiKey],
      [{ apiKeyHash, alias: 'ghp_1234567890abcdef', updatedAtMs: 1 }]
    );

    expect(map.get(apiKeyHash)?.label).toContain('*');
    expect(map.get(apiKeyHash)?.label).not.toContain('ghp_1234567890abcdef');
  });
});

describe('buildMonitoringFilterFacetsFromSummary', () => {
  it('reads summary facets without requiring detail rows', () => {
    const facets = buildMonitoringFilterFacetsFromSummary({
      apis: {},
      facets: {
        providers: ['codex'],
        accounts: [{ value: 'alice@example.com', label: 'Alice' }],
        models: ['gpt-5'],
        channels: ['codex'],
        api_keys: [{ value: 'hash-a', label: 'Team A' }],
      },
    });

    expect(facets.providers).toEqual(['codex']);
    expect(facets.accounts).toEqual([{ value: 'alice@example.com', label: 'Alice' }]);
    expect(facets.models).toEqual(['gpt-5']);
    expect(facets.channels).toEqual(['codex']);
    expect(facets.apiKeys).toEqual([{ value: 'hash-a', label: 'Team A' }]);
  });
});
