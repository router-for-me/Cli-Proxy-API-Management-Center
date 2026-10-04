import { expect, test } from 'bun:test';
import { normalizeSharedApiKeyNames } from '../src/services/api/apiKeyNames';

test('accepts server tombstones and valid names but rejects malformed metadata', () => {
  const fingerprint = 'a'.repeat(64);
  expect(normalizeSharedApiKeyNames({ names: { [fingerprint]: '' } })).toEqual({
    [fingerprint]: '',
  });
  for (const payload of [
    null,
    {},
    { names: [] },
    { names: { token: 'Name' } },
    { names: { [fingerprint]: 1 } },
    { names: { [fingerprint]: 'a'.repeat(129) } },
    { names: { [fingerprint]: 'hidden\u200bname' } },
    { names: { [fingerprint]: 'line\nname' } },
  ]) {
    expect(() => normalizeSharedApiKeyNames(payload)).toThrow('Invalid key name metadata');
  }
});
