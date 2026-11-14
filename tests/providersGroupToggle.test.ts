import { describe, expect, test } from 'bun:test';
import { buildGroupDisabledDraft } from '@/features/providers/useProviderWorkbench';
import { serializeGeminiGroup } from '@/services/api/providers';

const group: Record<string, unknown> = {
  name: 'team-a',
  models: [{ name: 'gemini-2.5-flash' }],
  keys: [
    { 'api-key': 'key-a' },
    { 'api-key': 'key-b', 'excluded-models': ['own-rule'], 'connection-pool': { enabled: true } },
  ],
};

const keysOf = (payload: Record<string, unknown>) => payload.keys as Record<string, unknown>[];

describe('gemini group disable toggle', () => {
  test('disabling reaches keys that carry their own exclusion list', () => {
    const draft = buildGroupDisabledDraft(group, true);
    const payload = serializeGeminiGroup(draft, group);
    expect(payload['excluded-models']).toEqual(['*']);

    const keys = keysOf(payload);
    expect(keys[0]['excluded-models']).toBeUndefined();
    expect(keys[1]['excluded-models']).toEqual(['own-rule', '*']);
    expect(keys[1]['connection-pool']).toEqual({ enabled: true });

    // What CLIProxyAPI will actually schedule: group list unless the key overrides it.
    const effective = keys.map((key) =>
      Array.isArray(key['excluded-models']) ? key['excluded-models'] : payload['excluded-models']
    );
    effective.forEach((list) => expect(list).toContain('*'));
  });

  test('enabling strips the disable rule but keeps key-level rules', () => {
    const disabled = serializeGeminiGroup(buildGroupDisabledDraft(group, true), group);
    const enabled = serializeGeminiGroup(buildGroupDisabledDraft(disabled, false), disabled);
    expect(enabled['excluded-models']).toEqual([]);
    const keys = keysOf(enabled);
    expect(keys[0]['excluded-models']).toBeUndefined();
    expect(keys[1]['excluded-models']).toEqual(['own-rule']);
  });
});
