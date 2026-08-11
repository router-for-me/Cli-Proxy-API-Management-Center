import { describe, expect, test } from 'bun:test';
import type { PluginListEntry } from '../src/types';
import { normalizeQuotaSchedulerStatus } from '../src/features/plugins/quotaSchedulerManagement';
import {
  collectPluginResourceEntries,
  QUOTA_SCHEDULER_PLUGIN_ID,
} from '../src/features/plugins/pluginResources';

const plugin = (overrides: Partial<PluginListEntry> = {}): PluginListEntry => ({
  id: 'example',
  path: '',
  configured: true,
  registered: true,
  enabled: true,
  effectiveEnabled: true,
  supportsOAuth: false,
  logo: '',
  configFields: [],
  menus: [],
  metadata: null,
  ...overrides,
});

describe('plugin resource entries', () => {
  test('adds authenticated management entries for the two menu-less integrations', () => {
    const entries = collectPluginResourceEntries([
      plugin({ id: 'codex-agent-identity' }),
      plugin({ id: QUOTA_SCHEDULER_PLUGIN_ID }),
    ]);

    expect(entries.map((entry) => [entry.pluginID, entry.kind])).toEqual([
      ['codex-agent-identity', 'agentIdentityManagement'],
      ['codex-quota-scheduler', 'quotaSchedulerManagement'],
    ]);
  });

  test('does not duplicate a plugin that declares a real static resource menu', () => {
    const entries = collectPluginResourceEntries([
      plugin({
        id: QUOTA_SCHEDULER_PLUGIN_ID,
        menus: [
          {
            path: '/v0/resource/plugins/scheduler/index.html',
            menu: 'Status',
            description: '',
          },
        ],
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('resource');
    expect(entries[0]?.menu.path).toBe('/v0/resource/plugins/scheduler/index.html');
  });

  test('does not expose disabled or unrelated menu-less plugins', () => {
    expect(
      collectPluginResourceEntries([
        plugin({ id: 'codex-agent-identity', effectiveEnabled: false }),
        plugin({ id: 'unrelated-plugin' }),
      ])
    ).toEqual([]);
  });

  test('normalizes the read-only scheduler Management status', () => {
    expect(
      normalizeQuotaSchedulerStatus(
        {
          enabled: true,
          generation_active: true,
          generation_managed: true,
          serial_active_auth_id: 'redacted-active-auth',
          serial_selected_at: '2026-08-11T10:00:00Z',
          serial_switches: 7,
          serial_last_switch_at: '2026-08-11T09:00:00Z',
          serial_last_switch_reason: 'quota_threshold_reached',
          serial_switch_percent: 98,
          scheduler_mode: 'serial',
          config_generation: 62,
          runtime_generation: 63,
          warmup_candidates: 0,
          warmup_enabled: true,
          warmups: [
            {
              auth_id: 'first',
              state: 'confirmed',
              window: 'weekly',
              activated_at: '2026-08-11T08:00:00Z',
            },
            {
              auth_id: 'second',
              state: 'pending_confirmation',
              window: '5h',
              completed_at: '2026-08-11T08:30:00Z',
            },
          ],
          fresh_snapshots: 5,
          snapshots: [
            {
              auth_id: 'redacted-active-auth',
              auth_index: 'codex-team-alpha.json',
              eligible: true,
            },
            { auth_id: 'standby-auth', eligible: false },
          ],
        },
        { bans: [{ id: 'a' }, { id: 'b' }], total_429s: 4 },
        {
          files: [
            {
              auth_index: 'codex-team-alpha.json',
              email: 'member@example.test',
              account_type: 'team',
              name: 'codex-team-alpha.json',
            },
          ],
        }
      )
    ).toMatchObject({
      enabled: true,
      generationActive: true,
      generationManaged: true,
      serialActive: true,
      activeAuthId: 'redacted-active-auth',
      activeAuthLabel: 'member@example.test · Team',
      serialSelectedAt: '2026-08-11T10:00:00Z',
      serialSwitches: 7,
      serialLastSwitchAt: '2026-08-11T09:00:00Z',
      serialSwitchReason: 'quota_threshold_reached',
      serialSwitchPercent: 98,
      schedulerMode: 'serial',
      configGeneration: 62,
      runtimeGeneration: 63,
      warmupCandidates: 0,
      warmupEnabled: true,
      warmups: 2,
      warmupSummary: {
        confirmed: 1,
        pending: 1,
        failed: 0,
        blocked: 0,
        attempted: 0,
        latestState: 'pending_confirmation',
        latestAt: '2026-08-11T08:30:00Z',
        latestWindow: '5h',
      },
      freshSnapshots: 5,
      snapshotCount: 2,
      eligibleSnapshots: 1,
      activeBans: 2,
      total429s: 4,
      lastError: '',
    });
  });

  test('falls back safely when scheduler account metadata is partial or unavailable', () => {
    const quota = {
      serial_active_auth_id: 'active-auth',
      snapshots: [{ auth_id: 'active-auth', auth_index: 'opaque-index' }],
    };

    expect(
      normalizeQuotaSchedulerStatus(
        quota,
        {},
        {
          files: [{ authIndex: 'opaque-index', name: 'friendly-account.json' }],
        }
      ).activeAuthLabel
    ).toBe('friendly-account');
    expect(normalizeQuotaSchedulerStatus(quota, {}).activeAuthLabel).toBe('opaque-index');
    expect(
      normalizeQuotaSchedulerStatus(
        { serial_active_auth_id: 'active-auth', snapshots: [] },
        {},
        { files: [] }
      ).activeAuthLabel
    ).toBe('active-auth');
  });
});
