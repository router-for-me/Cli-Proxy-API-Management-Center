import { describe, expect, it } from 'vitest';
import { sha256Hex } from './apiKeyHash';

describe('sha256Hex', () => {
  it('matches standard SHA-256 hex output and trims input like Usage Service', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(sha256Hex('  abc  ')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(sha256Hex('')).toBe('');
  });
});
