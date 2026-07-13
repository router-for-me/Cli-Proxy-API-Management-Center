import { describe, expect, test } from 'bun:test';
import { normalizeXAIConfigResponse } from '@/services/api/config';

describe('normalizeXAIConfigResponse', () => {
  test('uses the policy defaults for an empty response', () => {
    expect(normalizeXAIConfigResponse({})).toEqual({
      saveCooldownStatus: true,
      autoDisablePermissionDenied: true,
      otherForbiddenCooldownHours: 6,
      freeUsageExhaustedCooldownHours: 24,
      freeUsageExhaustedDisableAfter: 3,
      otherForbiddenDisableAfter: 3,
    });
  });

  test('accepts zero as an explicit disabled cooldown', () => {
    expect(
      normalizeXAIConfigResponse({
        'save-cooldown-status': false,
        'auto-disable-permission-denied': false,
        'other-403-cooldown-hours': 0,
        'free-usage-exhausted-cooldown-hours': 4.9,
        'free-usage-exhausted-disable-after': 0,
        'other-403-disable-after': 5.2,
      })
    ).toEqual({
      saveCooldownStatus: false,
      autoDisablePermissionDenied: false,
      otherForbiddenCooldownHours: 0,
      freeUsageExhaustedCooldownHours: 4,
      freeUsageExhaustedDisableAfter: 0,
      otherForbiddenDisableAfter: 5,
    });
  });
});
