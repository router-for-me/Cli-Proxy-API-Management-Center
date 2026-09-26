import { describe, expect, test } from 'bun:test';
import {
  CLAUDE_CONFIG,
  canResetClaudeQuota,
  parseClaudeResetGrants,
} from '@/features/quota/providers/claude/data';
import { CLAUDE_USAGE_URL } from '@/utils/quota';

const NOW = Date.parse('2026-09-26T12:00:00Z');

describe('Claude reset grants', () => {
  test('asks the usage endpoint for the reset grant block', () => {
    expect(new URL(CLAUDE_USAGE_URL).searchParams.get('cedar_ember')).toBe('1');
  });

  test('returns null when the account is not eligible', () => {
    expect(parseClaudeResetGrants(null)).toBeNull();
    expect(parseClaudeResetGrants({ eligible: false, grants: [] })).toBeNull();
    expect(parseClaudeResetGrants({ eligible: true })).toBeNull();
  });

  test('counts only spendable grants and prefers the server-picked grant', () => {
    const grants = parseClaudeResetGrants({
      eligible: true,
      next_grant_id: 'grant_b',
      grants: [
        { id: 'grant_a', resets_left: 2, ends_at: '2026-10-01T00:00:00Z' },
        { id: 'grant_b', resets_left: '1', ends_at: '2026-10-05T00:00:00Z' },
        { id: 'grant_paused', resets_left: 5, paused: true },
        { id: 'grant_empty', resets_left: 0 },
        { id: 'bad id!', resets_left: 9 },
      ],
    });

    expect(grants).toEqual({
      availableCount: 3,
      nextGrantId: 'grant_b',
      expiresAt: '2026-10-05T00:00:00Z',
      cooldownUntil: null,
    });
  });

  test('falls back to the first spendable grant when the server pick is not spendable', () => {
    const grants = parseClaudeResetGrants({
      eligible: true,
      next_grant_id: 'grant_paused',
      grants: [
        { id: 'grant_paused', resets_left: 1, paused: true },
        { id: 'grant_ok', resets_left: 1 },
      ],
    });

    expect(grants?.nextGrantId).toBe('grant_ok');
    expect(grants?.availableCount).toBe(1);
  });

  test('offers a reset only with a spendable grant and no active cooldown', () => {
    const base = { availableCount: 1, nextGrantId: 'grant_ok', expiresAt: null };

    expect(canResetClaudeQuota({ resetGrants: null }, NOW)).toBeFalse();
    expect(
      canResetClaudeQuota({ resetGrants: { ...base, availableCount: 0, cooldownUntil: null } }, NOW)
    ).toBeFalse();
    expect(canResetClaudeQuota({ resetGrants: { ...base, cooldownUntil: null } }, NOW)).toBeTrue();
    expect(
      canResetClaudeQuota({ resetGrants: { ...base, cooldownUntil: '2026-09-26T13:00:00Z' } }, NOW)
    ).toBeFalse();
    expect(
      canResetClaudeQuota({ resetGrants: { ...base, cooldownUntil: '2026-09-26T11:00:00Z' } }, NOW)
    ).toBeTrue();
  });

  test('wires the reset action into the Claude quota adapter', () => {
    expect(CLAUDE_CONFIG.resetQuota).toBeFunction();
    expect(
      CLAUDE_CONFIG.canResetQuota?.({
        status: 'success',
        windows: [],
        resetGrants: {
          availableCount: 1,
          nextGrantId: 'grant_ok',
          expiresAt: null,
          cooldownUntil: null,
        },
      })
    ).toBeTrue();
    expect(CLAUDE_CONFIG.canResetQuota?.({ status: 'success', windows: [] })).toBeFalse();
  });
});
