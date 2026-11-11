/**
 * Banked Claude resets by what they do: a general reset clears the account's
 * limits, a Fable reset only gives back what Fable used. React-free.
 */

import type { AnthropicResetGrant } from '@/services/api/claudeResetGrants';

export const RESET_GRANT_KINDS = ['general', 'fable'] as const;
export type ResetGrantKind = (typeof RESET_GRANT_KINDS)[number];

/** Upstream marks a Fable reset with `gives_back_weekly`; every other grant is general. */
export const resetGrantKind = (grant: AnthropicResetGrant): ResetGrantKind =>
  grant.givesBackWeekly ? 'fable' : 'general';

export type ResetGrantLine = {
  kind: ResetGrantKind;
  /** Resets left across the unexpired grants of this kind. */
  count: number;
  /** When the first of them expires; null when none states an end. */
  expiresAtMs: number | null;
};

/** One line per kind that still holds resets, general first. */
export function resetGrantLines(
  grants: readonly AnthropicResetGrant[],
  nowMs: number
): ResetGrantLine[] {
  return RESET_GRANT_KINDS.flatMap((kind) => {
    let count = 0;
    let expiresAtMs: number | null = null;
    grants.forEach((grant) => {
      if (resetGrantKind(grant) !== kind || grant.resetsLeft <= 0) return;
      const endsAtMs = grant.endsAt ? Date.parse(grant.endsAt) : null;
      if (endsAtMs !== null && endsAtMs <= nowMs) return;
      count += grant.resetsLeft;
      if (endsAtMs !== null) expiresAtMs = Math.min(expiresAtMs ?? Infinity, endsAtMs);
    });
    return count > 0 ? [{ kind, count, expiresAtMs }] : [];
  });
}
