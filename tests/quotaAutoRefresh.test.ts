import { describe, expect, test } from 'bun:test';
import { QUOTA_AUTO_REFRESH_INTERVAL_MS } from '@/features/quota/autoRefresh';

describe('quota auto refresh', () => {
  test('refreshes every five minutes', () => {
    expect(QUOTA_AUTO_REFRESH_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});
