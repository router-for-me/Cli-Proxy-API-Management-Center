import type { AccountResets, PoolProviderId } from '../../src/domain/quotaPool/types';
import {
  anthropicResetGrantBlocker,
  parseAnthropicResetGrantStatus,
} from '../../src/services/api/claudeResetGrants';
import { normalizeCodexResetCreditsPayload } from '../../src/utils/quota/resetCredits';
import { parseClaudeUsagePayload, parseCodexUsagePayload } from '../../src/utils/quota/parsers';
import { isRecord } from '../../src/utils/helpers';

/** Missing or malformed reset data must not replace the last successful reading. */
export function readAccountResets(
  provider: PoolProviderId,
  body: unknown,
  observedAtMs: number
): AccountResets | null {
  // Antigravity has no reset grants or credits.
  if (provider === 'antigravity') return null;
  const payload =
    provider === 'claude' ? parseClaudeUsagePayload(body) : parseCodexUsagePayload(body);
  if (!isRecord(payload)) return null;
  if (provider === 'codex') {
    const summary = normalizeCodexResetCreditsPayload(payload.rate_limit_reset_credits);
    const available = summary.availableCount;
    const applicable = summary.applicableAvailableCount;
    if (
      summary.invalidPayload ||
      available === null ||
      applicable === null ||
      !Number.isInteger(available) ||
      available < 0 ||
      !Number.isInteger(applicable)
    )
      return null;
    const usable = Math.min(available, Math.max(0, applicable));
    const expiries = codexCreditExpiries(summary.credits);
    return {
      available,
      usable,
      blocker: available > 0 && usable === 0 ? 'not_applicable' : null,
      nextExpiryAtMs: expiries.length ? expiries[0]! : null,
      ...(expiries.length ? { expiries } : {}),
      observedAtMs,
    };
  }

  const status = parseAnthropicResetGrantStatus(payload.cedar_ember);
  if (!status) return null;
  const held = status.grants.filter((grant) => grant.resetsLeft > 0);
  const available = held.reduce((sum, grant) => sum + grant.resetsLeft, 0);
  const cooldown = !!status.cooldownUntil && Date.parse(status.cooldownUntil) > observedAtMs;
  const usable = cooldown
    ? 0
    : held.reduce(
        (sum, grant) =>
          !anthropicResetGrantBlocker(status, grant.id) &&
          (!grant.startsAt || Date.parse(grant.startsAt) <= observedAtMs) &&
          (!grant.endsAt || Date.parse(grant.endsAt) > observedAtMs)
            ? sum + grant.resetsLeft
            : sum,
        0
      );
  // One entry per reset: a grant holding two resets that end together lists its end twice.
  const dated = held
    .flatMap((grant) => {
      const at = grant.endsAt ? Date.parse(grant.endsAt) : NaN;
      return Number.isFinite(at)
        ? Array.from({ length: grant.resetsLeft }, () => ({ at, kind: grant.kind }))
        : [];
    })
    .sort((a, b) => a.at - b.at);
  const expiries = dated.map((reset) => reset.at);
  let blocker: AccountResets['blocker'] = null;
  if (!status.eligible) blocker = `ineligible:${status.ineligibleReason ?? 'unknown'}`;
  else if (available > 0 && usable === 0) {
    if (cooldown) blocker = 'cooldown';
    else if (held.some((grant) => grant.useRequiresLimit && !status.atLimit))
      blocker = 'not_limited';
    else if (held.some((grant) => grant.paused)) blocker = 'paused';
  }
  return {
    available,
    usable,
    blocker,
    nextExpiryAtMs: expiries.length ? expiries[0]! : null,
    ...(expiries.length ? { expiries, kinds: dated.map((reset) => reset.kind) } : {}),
    observedAtMs,
  };
}

/** Each available credit's expiry, soonest first; credits without a readable expiry are skipped. */
export function codexCreditExpiries(credits: readonly { expiresAt: string }[]): number[] {
  return credits
    .map((credit) => Date.parse(credit.expiresAt))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

/**
 * Codex's usage reply counts credits but may not list them; the credit-details reply does. Adopt
 * its expiries only when it lists exactly the credits this reading holds, so a stale list never
 * describes resets that were spent or granted since.
 */
export function withCodexCreditDetails(
  resets: AccountResets,
  expiries: readonly number[] | undefined
) {
  if (!expiries || (resets.expiries?.length ?? 0) >= resets.available) return resets;
  if (expiries.length !== resets.available) return resets;
  return { ...resets, expiries: [...expiries], nextExpiryAtMs: expiries[0] ?? null };
}
