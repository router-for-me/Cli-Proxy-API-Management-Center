import { describe, expect, test } from 'bun:test';
import { locateProviderGroup, serializeGeminiGroup } from '@/services/api/providers';
import type { ProviderSource } from '@/types/provider';

const existingGroup: Record<string, unknown> = {
  name: 'team-a',
  'base-url': 'https://generativelanguage.googleapis.com',
  models: [{ name: 'gemini-2.5-flash' }],
  'excluded-models': ['veo*'],
  priority: 100,
  'connection-pool': { enabled: true },
  keys: [
    { 'api-key': 'key-1' },
    {
      'api-key': 'key-2',
      models: [{ name: 'gemini-2.5-pro' }],
      'connection-pool': { 'max-idle-conns-per-host': 2 },
      'auth-index': 'idx-2',
    },
  ],
};

const keysOf = (group: Record<string, unknown>) => group.keys as Record<string, unknown>[];

describe('serializeGeminiGroup', () => {
  test('writes shared attributes at group level and keeps keys inheriting', () => {
    const out = serializeGeminiGroup(
      {
        name: 'team-a',
        baseUrl: 'https://generativelanguage.googleapis.com',
        priority: 100,
        models: [{ name: 'gemini-2.5-flash' }],
        excludedModels: ['veo*'],
        keys: [
          { apiKey: 'key-1', raw: keysOf(existingGroup)[0] },
          { apiKey: 'key-2', raw: keysOf(existingGroup)[1] },
        ],
      },
      existingGroup
    );

    expect(out.name).toBe('team-a');
    expect(out['base-url']).toBe('https://generativelanguage.googleapis.com');
    expect(out.models).toEqual([{ name: 'gemini-2.5-flash' }]);
    expect(out['excluded-models']).toEqual(['veo*']);
    expect(out.priority).toBe(100);

    const keys = keysOf(out);
    expect(keys[0]).toEqual({ 'api-key': 'key-1' });
    expect(keys[1].models).toEqual([{ name: 'gemini-2.5-pro' }]);
    expect(keys[1]['connection-pool']).toEqual({ 'max-idle-conns-per-host': 2 });
    expect(keys[1]['auth-index']).toBeUndefined();
    expect(keys[1].auth_index).toBeUndefined();
  });

  test('preserves untouched group fields such as connection-pool', () => {
    const out = serializeGeminiGroup(
      { name: 'team-a', keys: [{ apiKey: 'key-1', raw: keysOf(existingGroup)[0] }] },
      existingGroup
    );
    expect(out['connection-pool']).toEqual({ enabled: true });
    expect(out.models).toEqual([{ name: 'gemini-2.5-flash' }]);
    expect(out['excluded-models']).toEqual(['veo*']);
  });

  test('distinguishes an explicit empty exclusion list from an absent one', () => {
    const cleared = serializeGeminiGroup(
      { name: 'team-a', excludedModels: [], keys: [{ apiKey: 'key-1' }] },
      existingGroup
    );
    expect(cleared['excluded-models']).toEqual([]);

    const untouched = serializeGeminiGroup(
      { name: 'team-a', keys: [{ apiKey: 'key-1' }] },
      existingGroup
    );
    expect(untouched['excluded-models']).toEqual(['veo*']);
  });

  test('creates keys with only the api-key when no override exists', () => {
    const out = serializeGeminiGroup({
      name: 'fresh',
      models: [{ name: 'gemini-4-carbon' }],
      keys: [{ apiKey: 'new-key', weight: 5 }],
    });
    expect(out.keys).toEqual([{ 'api-key': 'new-key', weight: 5 }]);
    expect(out['base-url']).toBeUndefined();
  });
});

describe('locateProviderGroup conflicts', () => {
  test('refuses to guess between two identical groups', () => {
    const duplicate = { name: 'dup', keys: [{ 'api-key': 'k' }] };
    const groups = [duplicate, duplicate];
    const source = {
      groups: [{ name: 'changed-elsewhere', keys: [{ 'api-key': 'k' }] }],
      groupIndex: 0,
      group: duplicate,
    } as unknown as ProviderSource;
    expect(() => locateProviderGroup(groups, source)).toThrow();
  });

  test('locates by snapshot when the stored array is unchanged', () => {
    const groups = [existingGroup];
    const source = { groups, groupIndex: 0, group: existingGroup } as unknown as ProviderSource;
    expect(locateProviderGroup(groups, source)).toBe(0);
  });
});
