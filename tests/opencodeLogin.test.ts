import { describe, expect, test } from 'bun:test';
import {
  buildOpencodeAuthFileName,
  buildOpencodeCredentialFile,
  opencodeKeyErrorKey,
  slugifyOpencodeLabel,
} from '@/features/authFiles/opencodeLogin';

describe('OpenCode account slug', () => {
  test('lowercases and joins words with a single dash', () => {
    expect(slugifyOpencodeLabel('  Go Principal ')).toBe('go-principal');
    expect(slugifyOpencodeLabel('cuenta   2')).toBe('cuenta-2');
  });

  test('reduces anything that could escape the auth dir to a plain slug', () => {
    expect(slugifyOpencodeLabel('../../etc/passwd')).toBe('etc-passwd');
    expect(slugifyOpencodeLabel('a/b\\c')).toBe('a-b-c');
  });

  test('has no name for a label that carries no usable characters', () => {
    expect(slugifyOpencodeLabel('///')).toBe('');
    expect(buildOpencodeAuthFileName('///')).toBeNull();
    expect(buildOpencodeAuthFileName('   ')).toBeNull();
  });
});

describe('OpenCode credential file', () => {
  test('writes the key where the api-call proxy looks for it', () => {
    const file = buildOpencodeCredentialFile('Go Principal', '  sk-abc123  ');
    expect(file?.name).toBe('opencode-go-principal.json');
    expect(JSON.parse(file!.content)).toEqual({
      type: 'opencode',
      access_token: 'sk-abc123',
      label: 'Go Principal',
    });
  });

  test('gives each account its own file, so several can coexist', () => {
    expect(buildOpencodeCredentialFile('personal', 'sk-1')?.name).toBe('opencode-personal.json');
    expect(buildOpencodeCredentialFile('trabajo', 'sk-2')?.name).toBe('opencode-trabajo.json');
  });

  test('refuses an empty key or an unusable label', () => {
    expect(buildOpencodeCredentialFile('personal', '   ')).toBeNull();
    expect(buildOpencodeCredentialFile('', 'sk-1')).toBeNull();
  });
});

describe('OpenCode key rejection', () => {
  test('separates a bad key from a key without the Go subscription', () => {
    expect(opencodeKeyErrorKey(401)).toBe('opencode_login.key_rejected');
    expect(opencodeKeyErrorKey(403)).toBe('opencode_login.no_subscription');
    expect(opencodeKeyErrorKey(500)).toBe('opencode_login.validate_failed');
  });
});
