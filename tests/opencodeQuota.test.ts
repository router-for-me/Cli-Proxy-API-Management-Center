/**
 * OpenCode Go subscription quota: entries are synthesised from CLIProxyAPI's
 * /quota/opencode report (these legs have no auth file), usage percent maps
 * onto the shared remaining-meter direction, and the soonest sort / timeline
 * only treat used-up windows as recovery.
 */

import { describe, expect, test } from 'bun:test';
import type { AuthFileItem, OpenCodeQuotaState } from '@/types';
import {
  OPENCODE_CONFIG,
  buildOpenCodeDisplayName,
  buildOpenCodeQuotaFiles,
  emptyOpenCodeQuotaData,
  openCodeQuotaDataFromSubscription,
} from '@/features/quota/providers/opencode/data';
import type { OpenCodeUsageSubscription } from '@/services/api/opencodeQuota';
import { collectQuotaRowInstants, nextRecoveryMs } from '@/features/quota/resetSchedule';
import { buildTimelineLane } from '@/features/quota/quotaTimelineModel';
import { classifyQuotaFiles, resolveQuotaProviderType } from '@/features/quota/logic';

const subscription = (overrides: Partial<OpenCodeUsageSubscription> = {}): OpenCodeUsageSubscription => ({
  auth_id: 'openai-compatibility:opencode-go:382cb79f4bf7',
  label: 'opencode-go',
  state: 'ok',
  windows: [
    { name: 'weekly', status: 'ok', percent: 88, resets_at: '2026-11-16T00:00:00Z' },
    { name: 'rolling', status: 'ok', percent: 3, resets_at: '2026-11-13T14:39:05Z' },
    { name: 'monthly', status: 'rate-limited', percent: 94, resets_at: '2026-12-06T09:51:58Z' },
  ],
  fetched_at: '2026-11-13T13:21:34.6674939Z',
  ...overrides,
});

describe('OpenCode subscription entries', () => {
  test('names a subscription from its label and the auth id tail', () => {
    expect(buildOpenCodeDisplayName(subscription())).toBe('opencode-go (382cb79f4bf7)');
    expect(
      buildOpenCodeDisplayName(subscription({ label: undefined, auth_id: 'openai-compatibility:opencode-go:abc123' }))
    ).toBe('opencode-go (abc123)');
    // An id without a kind prefix still renders, never "undefined".
    expect(buildOpenCodeDisplayName(subscription({ label: ' ', auth_id: 'solo' }))).toBe('opencode-go (solo)');
  });

  test('maps a report onto quota-page entries carrying the auth id', () => {
    const files = buildOpenCodeQuotaFiles([
      subscription(),
      subscription({ auth_id: 'openai-compatibility:opencode-go:beef0001', disabled: true }),
    ]);
    expect(files).toHaveLength(2);
    expect(files[0].provider).toBe('opencode');
    expect(files[0].type).toBe('opencode');
    expect(files[0].auth_index).toBe('openai-compatibility:opencode-go:382cb79f4bf7');
    expect(files[0].disabled).toBe(false);
    expect(files[1].disabled).toBe(true);
    expect(files[0].name).not.toBe(files[1].name);
  });

  test('classifies enabled subscriptions as opencode cards and drops disabled ones', () => {
    const [enabled, disabled] = buildOpenCodeQuotaFiles([
      subscription(),
      subscription({ auth_id: 'openai-compatibility:opencode-go:dead0001', disabled: true }),
    ]);
    expect(resolveQuotaProviderType(enabled as AuthFileItem)).toBe('opencode');
    expect(resolveQuotaProviderType(disabled as AuthFileItem)).toBeNull();
    expect(classifyQuotaFiles([enabled as AuthFileItem, disabled as AuthFileItem]).map((e) => e.type)).toEqual([
      'opencode',
    ]);
    expect(OPENCODE_CONFIG.filterFn(enabled as AuthFileItem)).toBe(true);
    expect(OPENCODE_CONFIG.filterFn({ name: 'claude-x.json', provider: 'claude' } as AuthFileItem)).toBe(false);
  });
});

describe('OpenCode quota data mapping', () => {
  test('sorts windows shortest-first and keeps percent used with its reset', () => {
    const data = openCodeQuotaDataFromSubscription(subscription());
    expect(data.state).toBe('ok');
    expect(data.windows.map((window) => window.id)).toEqual(['rolling', 'weekly', 'monthly']);
    const weekly = data.windows[1];
    expect(weekly.usedPercent).toBe(88);
    expect(weekly.resetAtMs).toBe(Date.parse('2026-11-16T00:00:00Z'));
    expect(weekly.periodHours).toBe(24 * 7);
    // The rolling period is not published upstream, so it never anchors a chart.
    expect(data.windows[0].periodHours).toBeNull();
    expect(data.fetchedAtMs).toBe(Date.parse('2026-11-13T13:21:34.6674939Z'));
    expect(data.lastError).toBeNull();
  });

  test('tolerates a pending subscription with no windows at all', () => {
    const data = openCodeQuotaDataFromSubscription(
      subscription({ state: 'pending', windows: undefined, fetched_at: undefined })
    );
    expect(data).toEqual({ ...emptyOpenCodeQuotaData(), state: 'pending' });
    expect(data.windows).toEqual([]);
    expect(data.fetchedAtMs).toBeNull();
  });

  test('keeps an unknown window name rather than dropping it', () => {
    const data = openCodeQuotaDataFromSubscription(
      subscription({ windows: [{ name: 'daily', percent: 10, resets_at: '2026-11-14T00:00:00Z' }] })
    );
    expect(data.windows).toHaveLength(1);
    expect(data.windows[0].id).toBe('daily');
    expect(data.windows[0].periodHours).toBeNull();
  });
});

describe('OpenCode recovery instants', () => {
  const successState = (windows: { id: string; usedPercent: number | null; resetAtMs: number | null }[]): OpenCodeQuotaState => ({
    status: 'success',
    ...emptyOpenCodeQuotaData(),
    windows: windows.map((window) => ({ ...window, periodHours: 168 })),
  });

  test('only used-up windows report recovery', () => {
    const quota = successState([
      { id: 'rolling', usedPercent: 0, resetAtMs: Date.parse('2026-11-13T14:39:05Z') },
      { id: 'weekly', usedPercent: 88, resetAtMs: Date.parse('2026-11-16T00:00:00Z') },
    ]);
    const instants = collectQuotaRowInstants('opencode', quota);
    expect(instants).toHaveLength(1);
    expect(instants[0].rowId).toBe('weekly');
    expect(nextRecoveryMs('opencode', quota, Date.now())).toBe(Date.parse('2026-11-16T00:00:00Z'));
  });

  test('an unloaded or failed card contributes nothing to the soonest sort', () => {
    expect(collectQuotaRowInstants('opencode', { status: 'loading' })).toEqual([]);
    expect(nextRecoveryMs('opencode', { status: 'error' }, Date.now())).toBeNull();
  });
});

describe('OpenCode timeline lane', () => {
  test('anchors on the longest period that fits, never on the rolling window', () => {
    const quota = {
      status: 'success',
      windows: [
        { id: 'rolling', usedPercent: 40, resetAtMs: Date.parse('2026-11-13T14:39:05Z'), periodHours: null },
        { id: 'weekly', usedPercent: 88, resetAtMs: Date.parse('2026-11-16T00:00:00Z'), periodHours: 168 },
      ],
    };
    const lane = buildTimelineLane({
      name: 'openai-compatibility:opencode-go:382cb79f4bf7',
      displayName: 'opencode-go (382cb79f4bf7)',
      provider: 'opencode',
      quota,
      maxPeriodHours: 168,
    });
    expect(lane.anchorMs).toBe(Date.parse('2026-11-16T00:00:00Z'));
    expect(lane.periodHours).toBe(168);
    // Meter direction is remaining, so 88% used renders as 12% left.
    expect(lane.remaining).toBe(12);
    expect(lane.limits.map((limit) => limit.label)).toEqual([
      'opencode_quota.window_rolling',
      'opencode_quota.window_weekly',
    ]);
  });

  test('a pending card renders as an explicitly empty row', () => {
    const lane = buildTimelineLane({
      name: 'openai-compatibility:opencode-go:382cb79f4bf7',
      displayName: 'opencode-go (382cb79f4bf7)',
      provider: 'opencode',
      quota: { status: 'success', windows: [] },
    });
    expect(lane.anchorMs).toBeNull();
    expect(lane.limits).toEqual([]);
  });
});
