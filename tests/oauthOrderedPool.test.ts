import { describe, expect, test } from 'bun:test';
import { normalizeOauthModelAlias, serializeOauthModelAliases } from '../src/services/api/authFiles';

describe('OAuth ordered alias pools', () => {
  test('preserves repeated aliases with different upstreams in config order', () => {
    const normalized = normalizeOauthModelAlias({
      codex: [
        { name: 'gpt-5', alias: 'g5' },
        { name: 'gpt-5-mini', alias: 'g5' },
        { name: 'gpt-5', alias: 'g5' },
        { name: 'gpt-5-nano', alias: 'g5' },
      ],
    });

    expect(normalized.codex).toEqual([
      { name: 'gpt-5', alias: 'g5' },
      { name: 'gpt-5-mini', alias: 'g5' },
      { name: 'gpt-5-nano', alias: 'g5' },
    ]);
  });

  test('drops exact duplicate pairs without reordering the remaining pool', () => {
    const normalized = normalizeOauthModelAlias({
      codex: [
        { name: 'gpt-5', alias: 'g5', fork: true },
        { name: 'gpt-5', alias: 'g5', fork: false },
        { name: 'gpt-5-mini', alias: 'g5', 'force-mapping': true },
        { name: 'gpt-5', alias: 'g5', 'force-mapping': true },
      ],
    });

    expect(normalized.codex).toEqual([
      { name: 'gpt-5', alias: 'g5', fork: true },
      { name: 'gpt-5-mini', alias: 'g5', forceMapping: true },
    ]);
  });

  test('serializes the ordered pool without losing fork and force-mapping flags', () => {
    const serialized = serializeOauthModelAliases([
      { name: 'gpt-5', alias: 'g5', fork: true },
      { name: 'gpt-5-mini', alias: 'g5', forceMapping: true },
      { name: 'gpt-5-nano', alias: 'g5' },
    ]);

    expect(serialized).toEqual([
      { name: 'gpt-5', alias: 'g5', fork: true },
      { name: 'gpt-5-mini', alias: 'g5', 'force-mapping': true },
      { name: 'gpt-5-nano', alias: 'g5' },
    ]);
  });
});
