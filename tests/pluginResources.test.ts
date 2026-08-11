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
          scheduler_mode: 'serial',
          runtime_generation: 63,
          warmup_candidates: 0,
          warmup_enabled: true,
          warmups: [{ id: 'first' }, { id: 'second' }],
          fresh_snapshots: 5,
        },
        { bans: [{ id: 'a' }, { id: 'b' }], total_429s: 4 }
      )
    ).toMatchObject({
      enabled: true,
      generationActive: true,
      generationManaged: true,
      serialActive: true,
      schedulerMode: 'serial',
      runtimeGeneration: 63,
      warmupCandidates: 0,
      warmupEnabled: true,
      warmups: 2,
      freshSnapshots: 5,
      activeBans: 2,
      total429s: 4,
    });
  });
});
