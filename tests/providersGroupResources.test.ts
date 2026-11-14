import { describe, expect, test } from 'bun:test';
import { geminiGroupToResource } from '@/features/providers/adapters';
import { buildProviderGroups } from '@/features/providers/useProviderWorkbench';
import type { Config } from '@/types';

const groups = [
  {
    name: 'team-a',
    'base-url': 'https://generativelanguage.googleapis.com',
    models: [
      { name: 'gemini-2.5-flash', alias: 'flash' },
      { name: 'gemini-2.5-pro' },
    ],
    'excluded-models': ['*pro*', 'veo*'],
    priority: 100,
    prefix: 'team',
    keys: [
      { 'api-key': 'AIza-key-1' },
      { 'api-key': 'AIza-key-2' },
      { 'api-key': 'AIza-key-3', weight: 5 },
    ],
  },
  {
    'excluded-models': ['*'],
    keys: [{ 'api-key': 'AIza-disabled-key' }],
    models: [{ name: 'gemini-4-carbon' }],
  },
];

const config = {
  providerGroups: { gemini: groups },
  geminiApiKeys: [
    { apiKey: 'AIza-key-1' },
    { apiKey: 'AIza-key-2' },
    { apiKey: 'AIza-key-3' },
    { apiKey: 'AIza-disabled-key' },
  ],
  claudeApiKeys: [{ apiKey: 'sk-ant-1' }],
} as unknown as Config;

describe('gemini group resources', () => {
  test('maps one group into one resource with key and model counts', () => {
    const resource = geminiGroupToResource(groups[0], 0, groups);
    expect(resource.kind).toBe('group');
    expect(resource.name).toBe('team-a');
    expect(resource.identifier).toBe('team-a');
    expect(resource.apiKeyEntryCount).toBe(3);
    expect(resource.modelCount).toBe(2);
    expect(resource.models).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
    expect(resource.baseUrl).toBe('https://generativelanguage.googleapis.com');
    expect(resource.prefix).toBe('team');
    expect(resource.priority).toBe(100);
    expect(resource.disabled).toBe(false);
    expect(resource.apiKey).toBeNull();
    expect(resource.apiKeyPreview).toBeTruthy();
    expect(resource.selector).toMatchObject({ kind: 'group', brand: 'gemini', groupIndex: 0 });
  });

  test('falls back to an index label and marks disabled groups', () => {
    const resource = geminiGroupToResource(groups[1], 1, groups);
    expect(resource.name).toBeNull();
    expect(resource.identifier).toBe('#2');
    expect(resource.disabled).toBe(true);
    expect(resource.modelCount).toBe(1);
  });

  test('a key-level exclusion list can keep a group effectively enabled', () => {
    const mixed = {
      name: 'mixed',
      'excluded-models': ['*'],
      keys: [{ 'api-key': 'k1' }, { 'api-key': 'k2', 'excluded-models': ['only-this'] }],
    };
    expect(geminiGroupToResource(mixed, 0, [mixed]).disabled).toBe(false);

    const allDisabled = {
      ...mixed,
      keys: [{ 'api-key': 'k1' }, { 'api-key': 'k2', 'excluded-models': ['own', '*'] }],
    };
    expect(geminiGroupToResource(allDisabled, 0, [allDisabled]).disabled).toBe(true);
  });

  test('group view exposes one row per group, flat view one row per key', () => {
    const groupRows = buildProviderGroups(config, 'group').find((group) => group.id === 'gemini');
    expect(groupRows?.resources).toHaveLength(2);
    expect(groupRows?.resources.map((row) => row.kind)).toEqual(['group', 'group']);

    const flatRows = buildProviderGroups(config, 'flat').find((group) => group.id === 'gemini');
    expect(flatRows?.resources).toHaveLength(4);
    expect(flatRows?.resources.every((row) => row.kind === 'key')).toBe(true);
  });

  test('sponsor-managed gemini groups stay out of the group view', () => {
    const sponsorConfig = {
      providerGroups: {
        gemini: [
          groups[0],
          { name: 'qiniu', 'base-url': 'https://api.qnaigc.com', keys: [{ 'api-key': 'q' }] },
        ],
      },
      geminiApiKeys: [{ apiKey: 'q' }],
    } as unknown as Config;
    const rows = buildProviderGroups(sponsorConfig, 'group').find((g) => g.id === 'gemini');
    expect(rows?.resources).toHaveLength(1);
    expect(rows?.resources[0].name).toBe('team-a');
  });

  test('other brands keep their resource count in both views', () => {
    const groupView = buildProviderGroups(config, 'group').find((group) => group.id === 'claude');
    const flatView = buildProviderGroups(config, 'flat').find((group) => group.id === 'claude');
    expect(groupView?.resources).toHaveLength(1);
    expect(flatView?.resources).toHaveLength(1);
  });
});
