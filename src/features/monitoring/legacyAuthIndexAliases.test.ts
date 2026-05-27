import { describe, expect, it } from 'vitest';
import { buildLegacyAuthIndexAliases, stableAuthIndexFromSeed } from './legacyAuthIndexAliases';

describe('legacy auth index aliases', () => {
  it('matches CPA stable auth index hashing', () => {
    expect(stableAuthIndexFromSeed('abc')).toBe('ba7816bf8f01cfea');
  });

  it('builds legacy file-based source aliases', () => {
    const aliases = buildLegacyAuthIndexAliases({
      name: 'alice.json',
      provider: 'codex',
      path: '/tmp/auths/alice.json',
      authIndex: 'current-auth-index',
      account: 'alice@example.com',
    });

    expect(aliases).toContain('6bf749cb7db0e15c');
    expect(aliases).toContain('b2035f866a8fdbf7');
  });
});
