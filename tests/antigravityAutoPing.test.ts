import { beforeEach, describe, expect, it } from 'bun:test';
import {
  AUTO_PING_COOLDOWN_MS,
  inFlightPings,
  isFiveHourBucket,
  isFiveHourBucketIdle,
  lastPingAtMap,
} from '@/features/quota/providers/antigravity/autoPing';
import type { AntigravityQuotaBucket } from '@/types';

describe('antigravityAutoPing', () => {
  const now = 1700000000000;

  beforeEach(() => {
    lastPingAtMap.clear();
    inFlightPings.clear();
  });

  describe('isFiveHourBucket', () => {
    it('identifies 5h window spellings and periodHours', () => {
      expect(isFiveHourBucket({ id: 'b1', label: 'L', window: '5h', remainingFraction: 1 })).toBe(
        true
      );
      expect(
        isFiveHourBucket({ id: 'b2', label: 'L', window: 'five-hour', remainingFraction: 1 })
      ).toBe(true);
      expect(
        isFiveHourBucket({ id: 'b3', label: 'L', window: 'five_hour', remainingFraction: 1 })
      ).toBe(true);
      expect(isFiveHourBucket({ id: 'b4', label: 'L', periodHours: 5, remainingFraction: 1 })).toBe(
        true
      );
      expect(isFiveHourBucket({ id: 'gemini-5h-limit', label: 'L', remainingFraction: 1 })).toBe(
        true
      );
      expect(
        isFiveHourBucket({ id: 'b5', label: 'L', window: 'weekly', remainingFraction: 1 })
      ).toBe(false);
    });
  });

  describe('isFiveHourBucketIdle', () => {
    it('returns true when a 5h bucket has no resetTime yet (unstarted/idle)', () => {
      const bucket: AntigravityQuotaBucket = {
        id: 'gemini-5h',
        label: 'Five Hour Limit',
        window: '5h',
        remainingFraction: 1,
        description: 'Full quota available',
      };
      expect(isFiveHourBucketIdle(bucket, now)).toBe(true);
    });

    it('returns true when a 5h bucket has passed its previous reset time (deltaMs <= 0)', () => {
      const bucket: AntigravityQuotaBucket = {
        id: 'gemini-5h',
        label: 'Five Hour Limit',
        window: '5h',
        remainingFraction: 1,
        resetTime: new Date(now - 1000).toISOString(),
      };
      expect(isFiveHourBucketIdle(bucket, now)).toBe(true);
    });

    it('returns false when bucket has a future resetTime indicating active countdown', () => {
      const bucket: AntigravityQuotaBucket = {
        id: 'gemini-5h',
        label: 'Five Hour Limit',
        window: '5h',
        remainingFraction: 1,
        resetTime: new Date(now + 4.9 * 3600 * 1000).toISOString(),
      };
      expect(isFiveHourBucketIdle(bucket, now)).toBe(false);
    });

    it('returns false when bucket is not a 5h window', () => {
      const bucket: AntigravityQuotaBucket = {
        id: 'gemini-weekly',
        label: 'Weekly Limit',
        window: '7d',
        remainingFraction: 1,
      };
      expect(isFiveHourBucketIdle(bucket, now)).toBe(false);
    });

    it('returns false when remainingFraction is less than 1', () => {
      const bucket: AntigravityQuotaBucket = {
        id: 'gemini-5h',
        label: 'Five Hour Limit',
        window: '5h',
        remainingFraction: 0.85,
      };
      expect(isFiveHourBucketIdle(bucket, now)).toBe(false);
    });

    it('returns false when description indicates 5-hour limit usage in progress', () => {
      const bucket: AntigravityQuotaBucket = {
        id: 'gemini-5h',
        label: 'Five Hour Limit',
        window: '5h',
        remainingFraction: 1,
        description: 'You have used some of your 5-hour limit, it will refresh soon',
      };
      expect(isFiveHourBucketIdle(bucket, now)).toBe(false);
    });
  });

  describe('cooldown and in-flight guards', () => {
    it('sets minimum cooldown to 4.5 hours', () => {
      expect(AUTO_PING_COOLDOWN_MS).toBe(4.5 * 3600 * 1000);
    });
  });
});
