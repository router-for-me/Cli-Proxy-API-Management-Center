import { describe, expect, it } from 'bun:test';
import { isFiveHourBucketIdle } from '@/features/quota/providers/antigravity/autoPing';
import type { AntigravityQuotaBucket } from '@/types';

describe('isFiveHourBucketIdle', () => {
  const now = 1700000000000;

  it('returns true when a 5h bucket is at 100% capacity with 5h remaining', () => {
    const bucket: AntigravityQuotaBucket = {
      id: 'gemini-5h',
      label: 'Five Hour Limit',
      window: '5h',
      remainingFraction: 1,
      resetTime: new Date(now + 5 * 3600 * 1000).toISOString(),
      description: 'Full quota available',
    };
    expect(isFiveHourBucketIdle(bucket, now)).toBe(true);
  });

  it('returns false when bucket is not a 5h window', () => {
    const bucket: AntigravityQuotaBucket = {
      id: 'gemini-weekly',
      label: 'Weekly Limit',
      window: '7d',
      remainingFraction: 1,
      resetTime: new Date(now + 7 * 24 * 3600 * 1000).toISOString(),
    };
    expect(isFiveHourBucketIdle(bucket, now)).toBe(false);
  });

  it('returns false when remainingFraction is less than 1', () => {
    const bucket: AntigravityQuotaBucket = {
      id: 'gemini-5h',
      label: 'Five Hour Limit',
      window: '5h',
      remainingFraction: 0.85,
      resetTime: new Date(now + 4 * 3600 * 1000).toISOString(),
    };
    expect(isFiveHourBucketIdle(bucket, now)).toBe(false);
  });

  it('returns false when reset countdown has already progressed significantly', () => {
    const bucket: AntigravityQuotaBucket = {
      id: 'gemini-5h',
      label: 'Five Hour Limit',
      window: '5h',
      remainingFraction: 1,
      resetTime: new Date(now + 3 * 3600 * 1000).toISOString(), // 3 hours left
    };
    expect(isFiveHourBucketIdle(bucket, now)).toBe(false);
  });

  it('returns false when description indicates 5-hour limit usage in progress', () => {
    const bucket: AntigravityQuotaBucket = {
      id: 'gemini-5h',
      label: 'Five Hour Limit',
      window: '5h',
      remainingFraction: 1,
      resetTime: new Date(now + 5 * 3600 * 1000).toISOString(),
      description: 'You have used some of your 5-hour limit, it will refresh soon',
    };
    expect(isFiveHourBucketIdle(bucket, now)).toBe(false);
  });
});
