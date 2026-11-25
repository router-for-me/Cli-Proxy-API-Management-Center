import { describe, expect, test } from 'bun:test';
import { compareVersions } from '../src/utils/compareVersions';

describe('system update version comparison', () => {
  test.each([
    ['v8.1.3', 'v8.1.3-rc.1'],
    ['v8.1.3-rc.10', 'v8.1.3-rc.2'],
    ['v8.1.3-rc10', 'v8.1.3-rc2'],
    ['v8.1.3-rc.1', 'v8.1.3-beta.9'],
    ['v8.1.10-rc1', 'v8.1.9'],
    ['v6.9.4-2', 'v6.9.4-1'],
  ])('%s is newer than %s', (newer, older) => {
    expect(compareVersions(newer, older)).toBe(1);
    expect(compareVersions(older, newer)).toBe(-1);
  });

  test.each([
    [' V8.1 ', '8.1.0'],
    ['v8.1.3+build.100', '8.1.3'],
    ['v8.1.3-rc1+build.2', '8.1.3-rc.1+build.10'],
  ])('%s and %s have equal precedence', (a, b) => {
    expect(compareVersions(a, b)).toBe(0);
  });

  test.each([undefined, null, '', 'dev'])('cannot compare %p', (unknown) => {
    expect(compareVersions('v8.1.3', unknown)).toBeNull();
    expect(compareVersions(unknown, 'v8.1.3')).toBeNull();
  });
});
