import { describe, expect, test } from 'bun:test';
import { getDashboardModelsStatValue } from '../src/utils/dashboard';

describe('dashboard model count', () => {
  test('distinguishes request failures from a successful empty model list', () => {
    expect(getDashboardModelsStatValue(0, false, null)).toBe(0);
    expect(getDashboardModelsStatValue(0, false, 'request failed')).toBe('-');
    expect(getDashboardModelsStatValue(3, true, null)).toBe('-');
  });
});
