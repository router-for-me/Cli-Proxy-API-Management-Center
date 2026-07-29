import { describe, expect, test } from 'bun:test';
import { normalizeAuthFilesResponse } from '../src/services/api/authFiles';
import type { AuthFilesResponse } from '../src/types/authFile';

const responseWithRawFiles = (files: Array<Record<string, unknown>>): AuthFilesResponse =>
  ({ files }) as unknown as AuthFilesResponse;

describe('auth-files response normalization', () => {
  test('normalizes WRR weights while preserving zero and negative values', () => {
    const result = normalizeAuthFilesResponse(
      responseWithRawFiles([
        { name: 'positive.json', weight: 5 },
        { name: 'string.json', weight: '7' },
        { name: 'zero.json', weight: 0 },
        { name: 'negative.json', weight: -2 },
      ])
    );

    expect(result.files.map((file) => file.weight)).toEqual([-2, 5, 7, 0]);
  });

  test('omits missing, fractional, and unsafe WRR weights from the normalized field', () => {
    const result = normalizeAuthFilesResponse(
      responseWithRawFiles([
        { name: 'missing.json' },
        { name: 'fractional.json', weight: '1.5' },
        { name: 'unsafe.json', weight: Number.MAX_SAFE_INTEGER + 1 },
      ])
    );

    expect(result.files.map((file) => file.weight)).toEqual([undefined, undefined, undefined]);
  });

  test('applies the same safe-integer normalization to priority', () => {
    const result = normalizeAuthFilesResponse(
      responseWithRawFiles([
        { name: 'valid.json', priority: '-3' },
        { name: 'invalid.json', priority: '3.5' },
      ])
    );

    expect(result.files.map((file) => file.priority)).toEqual([undefined, -3]);
  });
});
