import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { AccountExpandedDetails, AccountOverviewCard } from './MonitoringCenterPage';
import { buildEmptyMonitoringStatusData } from '@/features/monitoring/accountOverviewState';
import { buildRealtimeSourceDisplay } from '@/features/monitoring/realtimeSourceDisplay';

const t = ((key: string, options?: Record<string, unknown>) => {
  const copy: Record<string, string> = {
    'monitoring.account_overview_enable_all': 'Enable all',
    'monitoring.account_overview_disable_all': 'Disable all',
    'monitoring.restore_account_scope': 'Restore account scope',
    'monitoring.focus_account': 'Focus account',
    'monitoring.account_overview_enabled_label': 'Enabled',
    'monitoring.account_overview_enabled_label_short': 'Enabled',
    'auth_files.status_toggle_label': 'Enabled',
    'monitoring.account_overview_health_label': 'Health',
    'monitoring.account_overview_health_hint': 'Health hint',
    'monitoring.account_overview_scope_current_filters': 'Scope: current filters',
    'monitoring.account_overview_scope_range': 'Scope: {{range}}',
    'monitoring.account_overview_tokens_title': 'Tokens Usage',
    'monitoring.account_overview_token_structure': 'Token Structure',
    'monitoring.account_overview_models_top': 'Model Usage Top {{count}}',
    'monitoring.account_overview_models_all': 'Model Usage Details',
    'monitoring.account_overview_model_calls_short': 'Calls',
    'monitoring.account_overview_model_success_rate_short': 'Success',
    'monitoring.account_overview_model_input_tokens_short': 'Input',
    'monitoring.account_overview_model_output_tokens_short': 'Output',
    'monitoring.account_overview_model_cached_tokens_short': 'Cache',
    'monitoring.account_overview_model_total_tokens_short': 'Total Tokens',
    'monitoring.account_overview_model_total_cost_short': 'Total Cost',
    'monitoring.account_overview_view_all': 'View All',
    'monitoring.account_overview_collapse_models': 'Collapse',
    'monitoring.account_overview_no_models': 'No model details',
    'monitoring.total_calls': 'Total calls',
    'monitoring.calls': 'Calls',
    'stats.success': 'Success',
    'stats.failure': 'Failure',
    'monitoring.latest_request_time': 'Latest request',
    'monitoring.column_success_rate': 'Success rate',
    'monitoring.success_calls': 'Success calls',
    'monitoring.failure_calls': 'Failure calls',
    'monitoring.total_tokens': 'Total Tokens',
    'monitoring.input_tokens': 'Input Tokens',
    'monitoring.output_tokens': 'Output Tokens',
    'monitoring.cached_tokens': 'Cached Tokens',
    'monitoring.estimated_cost': 'Estimated Cost',
    'usage_stats.model_price_model': 'Model',
    'monitoring.last_sync': 'Last sync',
    'monitoring.account_quota_reset_at': 'Reset',
    'monitoring.account_quota_title': 'Account Quota',
    'monitoring.account_quota_loading': 'Loading quotas',
    'monitoring.account_quota_empty': 'No quota data',
    'monitoring.account_quota_idle': 'Click refresh quota',
    'monitoring.account_quota_load_failed': 'Failed to load quota: {{message}}',
    'monitoring.account_quota_refresh': 'Refresh',
    'monitoring.account_quota_retry': 'Retry',
    'monitoring.filter_provider': 'Provider',
    'monitoring.column_host': 'Host',
    'monitoring.source': 'Source',
    'status_bar.no_requests': 'No requests',
  };
  let value = copy[key] ?? key;
  Object.entries(options ?? {}).forEach(([name, replacement]) => {
    value = value.replace(`{{${name}}}`, String(replacement));
  });
  return value;
}) as TFunction;

describe('MonitoringCenterPage account card', () => {
  it('prefers readable channel names in realtime source cells', () => {
    const display = buildRealtimeSourceDisplay(
      {
        account: 'alice@example.com',
        accountMasked: 'ali***@example.com',
        authLabel: 'alice',
        channel: 'Claude Relay',
        channelHost: 'relay.example.com',
        provider: 'openai',
        sourceMasked: 'Team Key',
      },
      t
    );

    expect(display.primary).toBe('Claude Relay');
    expect(display.meta).toBe('Provider: openai');
  });

  it('shows one realtime source meta value by priority', () => {
    const baseRow = {
      account: 'alice@example.com',
      accountMasked: 'ali***@example.com',
      authLabel: 'alice',
      channel: '-',
      channelHost: 'relay.example.com',
      sourceMasked: 'Team Key',
    };

    expect(
      buildRealtimeSourceDisplay(
        {
          ...baseRow,
          provider: 'openai',
        },
        t
      ).primary
    ).toBe('openai');
    expect(
      buildRealtimeSourceDisplay(
        {
          ...baseRow,
          provider: 'openai',
        },
        t
      ).meta
    ).toBe('Host: relay.example.com');

    expect(
      buildRealtimeSourceDisplay(
        {
          ...baseRow,
          provider: '-',
        },
        t
      ).meta
    ).toBe('alice@example.com');
  });

  it('renders bulk action buttons for mixed account auth state', () => {
    const html = renderToStaticMarkup(
      <AccountOverviewCard
        row={{
          id: 'account@example.com',
          account: 'account@example.com',
          displayAccount: 'account@example.com',
          accountMasked: 'acc***@example.com',
          authLabels: ['alpha', 'beta'],
          authIndices: ['1', '2'],
          channels: ['default'],
          totalCalls: 10,
          successCalls: 8,
          failureCalls: 2,
          successRate: 0.8,
          inputTokens: 100,
          outputTokens: 50,
          cachedTokens: 10,
          totalTokens: 160,
          totalCost: 1.25,
          averageLatencyMs: 120,
          lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
          recentPattern: [true, false],
          models: [],
        }}
        authState={{
          files: [],
          toggleableFileNames: ['alpha.json', 'beta.json'],
          enabledState: 'mixed',
        }}
        hasPrices
        locale="en"
        t={t}
        isExpanded={false}
        isFocused={false}
        statusData={buildEmptyMonitoringStatusData({
          startMs: Date.UTC(2026, 4, 10, 0, 0, 0),
          endMs: Date.UTC(2026, 4, 10, 23, 59, 59),
        })}
        scopeText="Scope: 5/10 12:00 AM - 11:59 PM"
        statusUpdating={false}
        onToggle={() => {}}
        onFocus={() => {}}
        onToggleEnabled={() => {}}
        onRefreshQuota={() => {}}
      />
    );

    expect(html).toContain('Enable all');
    expect(html).toContain('Disable all');
    expect(html).not.toContain('type="checkbox"');
  });

  it('renders expanded card model usage as readable metadata instead of a table', () => {
    const html = renderToStaticMarkup(
      <AccountOverviewCard
        row={{
          id: 'account@example.com',
          account: 'account@example.com',
          displayAccount: 'account@example.com',
          accountMasked: 'acc***@example.com',
          authLabels: ['alpha'],
          authIndices: ['1'],
          channels: ['default'],
          totalCalls: 221,
          successCalls: 220,
          failureCalls: 1,
          successRate: 0.995,
          inputTokens: 35_000_000,
          outputTokens: 68_500,
          cachedTokens: 33_900_000,
          totalTokens: 35_068_500,
          totalCost: 23.04,
          averageLatencyMs: 120,
          lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
          recentPattern: [true, true],
          models: [
            {
              model: 'gpt-5.5',
              totalCalls: 196,
              successCalls: 195,
              failureCalls: 1,
              successRate: 0.995,
              inputTokens: 33_400_000,
              outputTokens: 66_600,
              cachedTokens: 32_500_000,
              totalTokens: 33_466_600,
              totalCost: 23.04,
              lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
            },
            {
              model: 'codex-auto-review',
              totalCalls: 25,
              successCalls: 24,
              failureCalls: 1,
              successRate: 0.96,
              inputTokens: 1_600_000,
              outputTokens: 1_900,
              cachedTokens: 1_400_000,
              totalTokens: 1_601_900,
              totalCost: 0,
              lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
            },
          ],
        }}
        authState={{
          files: [],
          toggleableFileNames: ['alpha.json'],
          enabledState: 'enabled',
        }}
        hasPrices
        locale="en"
        t={t}
        isExpanded
        isFocused={false}
        statusData={buildEmptyMonitoringStatusData({
          startMs: Date.UTC(2026, 4, 10, 0, 0, 0),
          endMs: Date.UTC(2026, 4, 10, 23, 59, 59),
        })}
        scopeText="Scope: 5/10 12:00 AM - 11:59 PM"
        statusUpdating={false}
        onToggle={() => {}}
        onFocus={() => {}}
        onToggleEnabled={() => {}}
        onRefreshQuota={() => {}}
      />
    );

    expect(html).toContain('gpt-5.5');
    expect(html).toContain('<small>Calls</small><strong>196</strong>');
    expect(html).toContain('<small>Success</small><strong class="_goodText');
    expect(html).toContain('<small>Total Tokens</small><strong>33.5M</strong>');
    expect(html).toContain('<small>Total Cost</small><strong>$23.04</strong>');
    expect(html).not.toContain('<table');
  });

  it('uses a static enabled label beside the account toggle', () => {
    const html = renderToStaticMarkup(
      <AccountOverviewCard
        row={{
          id: 'disabled@example.com',
          account: 'disabled@example.com',
          displayAccount: 'disabled@example.com',
          accountMasked: 'dis***@example.com',
          authLabels: ['alpha'],
          authIndices: ['1'],
          channels: ['default'],
          totalCalls: 0,
          successCalls: 0,
          failureCalls: 0,
          successRate: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          totalTokens: 0,
          totalCost: 0,
          averageLatencyMs: null,
          lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
          recentPattern: [],
          models: [],
        }}
        authState={{
          files: [],
          toggleableFileNames: ['alpha.json'],
          enabledState: 'disabled',
        }}
        hasPrices
        locale="en"
        t={t}
        isExpanded={false}
        isFocused={false}
        statusData={buildEmptyMonitoringStatusData({
          startMs: Date.UTC(2026, 4, 10, 0, 0, 0),
          endMs: Date.UTC(2026, 4, 10, 23, 59, 59),
        })}
        scopeText="Scope: 5/10 12:00 AM - 11:59 PM"
        statusUpdating={false}
        onToggle={() => {}}
        onFocus={() => {}}
        onToggleEnabled={() => {}}
        onRefreshQuota={() => {}}
      />
    );

    expect(html).toContain('Enabled');
    expect(html).not.toContain('monitoring.account_overview_enabled_label_short');
  });

  it('renders table expanded details with token cards and a nine-column top model table', () => {
    const row = {
      id: 'account@example.com',
      account: 'account@example.com',
      displayAccount: 'account@example.com',
      accountMasked: 'acc***@example.com',
      authLabels: ['alpha'],
      authIndices: ['1'],
      channels: ['default'],
      totalCalls: 221,
      successCalls: 220,
      failureCalls: 1,
      successRate: 0.995,
      inputTokens: 35_000_000,
      outputTokens: 68_500,
      cachedTokens: 33_900_000,
      totalTokens: 35_068_500,
      totalCost: 23.04,
      averageLatencyMs: 120,
      lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
      recentPattern: [true, true],
      models: [
        {
          model: 'gpt-5.5',
          totalCalls: 196,
          successCalls: 195,
          failureCalls: 1,
          successRate: 0.995,
          inputTokens: 33_400_000,
          outputTokens: 66_600,
          cachedTokens: 32_500_000,
          totalTokens: 33_466_600,
          totalCost: 23.04,
          lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
        },
        {
          model: 'codex-auto-review',
          totalCalls: 25,
          successCalls: 24,
          failureCalls: 1,
          successRate: 0.96,
          inputTokens: 1_600_000,
          outputTokens: 1_900,
          cachedTokens: 1_400_000,
          totalTokens: 1_601_900,
          totalCost: 0,
          lastSeenAt: Date.UTC(2026, 4, 10, 12, 1, 0),
        },
        {
          model: 'long-tail-model',
          totalCalls: 1,
          successCalls: 1,
          failureCalls: 0,
          successRate: 1,
          inputTokens: 100,
          outputTokens: 20,
          cachedTokens: 0,
          totalTokens: 120,
          totalCost: 0.01,
          lastSeenAt: Date.UTC(2026, 4, 10, 12, 2, 0),
        },
      ],
    };

    const html = renderToStaticMarkup(
      <AccountExpandedDetails
        row={row}
        hasPrices
        locale="en"
        t={t}
        summaryMetrics={[
          { key: 'total-tokens', label: 'Total Tokens', value: '35.1M' },
          { key: 'input-tokens', label: 'Input Tokens', value: '35.0M' },
          { key: 'output-tokens', label: 'Output Tokens', value: '68.5K' },
          { key: 'cached-tokens', label: 'Cached Tokens', value: '33.9M' },
        ]}
        onRefreshQuota={() => {}}
        variant="table"
      />
    );

    expect(html).toContain('Token Structure');
    expect(html).toContain('Input Tokens');
    expect(html).toContain('Output Tokens');
    expect(html).toContain('Cached Tokens');
    expect(html).toContain('Model Usage Top 2');
    expect(html).toContain('View All');
    expect(html).toContain('<th>Total Tokens</th>');
    expect(html).toContain('<th>Latest request</th>');
    expect(html).toContain('gpt-5.5');
    expect(html).toContain('codex-auto-review');
    expect(html).not.toContain('long-tail-model');
  });

  it('renders a retry button when account quota refresh failed', () => {
    const html = renderToStaticMarkup(
      <AccountExpandedDetails
        row={{
          id: 'account@example.com',
          account: 'account@example.com',
          displayAccount: 'account@example.com',
          accountMasked: 'acc***@example.com',
          authLabels: ['alpha'],
          authIndices: ['1'],
          channels: ['default'],
          totalCalls: 0,
          successCalls: 0,
          failureCalls: 0,
          successRate: 0,
          inputTokens: 0,
          outputTokens: 0,
          cachedTokens: 0,
          totalTokens: 0,
          totalCost: 0,
          averageLatencyMs: null,
          lastSeenAt: Date.UTC(2026, 4, 10, 12, 0, 0),
          recentPattern: [],
          models: [],
        }}
        hasPrices={false}
        locale="en"
        t={t}
        summaryMetrics={[
          { key: 'total-tokens', label: 'Total Tokens', value: '0' },
          { key: 'input-tokens', label: 'Input Tokens', value: '0' },
          { key: 'output-tokens', label: 'Output Tokens', value: '0' },
          { key: 'cached-tokens', label: 'Cached Tokens', value: '0' },
        ]}
        quotaState={{
          status: 'error',
          targetKey: 'account@example.com',
          entries: [],
          error: 'upstream timeout',
        }}
        onRefreshQuota={() => {}}
        variant="table"
      />
    );

    expect(html).toContain('Failed to load quota: upstream timeout');
    expect(html).toContain('Retry');
  });
});
