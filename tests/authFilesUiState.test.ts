import { describe, expect, test } from 'bun:test';

import { resolveAuthFilesSortMode } from '@/features/authFiles/uiState';

describe('resolveAuthFilesSortMode', () => {
  test('uses priority for a fresh browser', () => {
    expect(resolveAuthFilesSortMode(undefined)).toBe('priority');
  });

  test('migrates the former implicit default to priority', () => {
    expect(resolveAuthFilesSortMode('default')).toBe('priority');
  });

  test('keeps explicit A-Z and priority choices', () => {
    expect(resolveAuthFilesSortMode('az')).toBe('az');
    expect(resolveAuthFilesSortMode('priority')).toBe('priority');
  });
});