import { describe, expect, test } from 'bun:test';
import { getXaiAccountStatus, matchesXaiStatusFilter } from '@/features/authFiles/xaiStatus';

const now = Date.parse('2026-07-13T00:00:00Z');
const baseFile = { name: 'xai.json', type: 'xai' };

describe('xAI auth-file status', () => {
  test('prioritizes denied and other 403 states ahead of cooldown', () => {
    const denied = {
      ...baseFile,
      xai_last_error_status: 403,
      disabled: true,
      disabled_reason: '{"code":"permission-denied","error":"Access denied."}',
      xai_cooldown_until: '2026-07-13T01:00:00Z',
    };
    const otherForbidden = { ...baseFile, xai_last_error_status: 403 };

    expect(getXaiAccountStatus(denied, now).kind).toBe('denied_403');
    expect(matchesXaiStatusFilter(denied, 'cooldown', now)).toBe(false);
    expect(matchesXaiStatusFilter(otherForbidden, 'other_403', now)).toBe(true);
  });

  test('recognizes active cooldown and healthy xAI auth files', () => {
    const cooldown = { ...baseFile, xai_cooldown_until: '2026-07-13T01:00:00Z' };

    expect(matchesXaiStatusFilter(cooldown, 'cooldown', now)).toBe(true);
    expect(matchesXaiStatusFilter(baseFile, 'working', now)).toBe(true);
  });
});
