import {
  anthropicResetGrantBlocker,
  type AnthropicResetGrantStatus,
} from '@/services/api/claudeResetGrants';
import { resetGrantKind, type ResetGrantKind } from './resetGrantKinds';

/**
 * Prefer the upstream recommendation; otherwise use stable ID ordering. With a
 * `kind`, only grants of that kind are considered.
 */
export function selectResetGrant(
  status: AnthropicResetGrantStatus,
  now: number,
  kind?: ResetGrantKind
) {
  if (status.cooldownUntil && Date.parse(status.cooldownUntil) > now) return undefined;
  const usable = status.grants.filter(
    (grant) =>
      (kind === undefined || resetGrantKind(grant) === kind) &&
      !anthropicResetGrantBlocker(status, grant.id) &&
      (!grant.startsAt || Date.parse(grant.startsAt) <= now) &&
      (!grant.endsAt || Date.parse(grant.endsAt) > now)
  );
  return (
    usable.find((grant) => grant.id === status.nextGrantId) ??
    usable.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0]
  );
}
