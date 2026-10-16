import { describe, expect, test } from 'bun:test';
import { ANTIGRAVITY_QUOTA_URLS } from '@/utils/quota/constants';

describe('ANTIGRAVITY_QUOTA_URLS', () => {
  test('prioritizes production endpoint over daily and sandbox fallbacks', () => {
    expect(ANTIGRAVITY_QUOTA_URLS[0]).toBe(
      'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary'
    );
    expect(ANTIGRAVITY_QUOTA_URLS).toEqual([
      'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
      'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
      'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary',
    ]);
  });
});
