import type { PoolProviderId } from '../../src/domain/quotaPool/types';
import { isRecord } from '../../src/utils/helpers';
import { normalizePlanType, parseCodexUsagePayload } from '../../src/utils/quota/parsers';
import { parseAntigravitySubscriptionSummary } from '../../src/services/api/antigravitySubscription';

/**
 * Subscription weight in base-plan units: one unit is the provider's $20 plan (Claude Pro,
 * ChatGPT Plus), and 100 quota points equal one unit. Multipliers are the providers' published
 * "N times Pro/Plus" allowances (Oct 2026): Claude Max 5x/20x; ChatGPT Pro 200 is 10x Plus and
 * Pro 500 ("promax") 25x. ChatGPT reports both Pro 100 and Pro 200 as "pro"; it is counted as
 * the $200 plan. Google AI Ultra counts 20 units, like Claude Ultra (user direction, 21 Nov 2026);
 * Antigravity reports it as `g1-ultra-tier` or `g1-ultra-lite-tier`, both named "Google AI Ultra".
 * Unknown plans count as one unit and are marked unknown.
 */
const PLANS: Record<PoolProviderId, Record<string, { multiplier: number; label: string }>> = {
  claude: {
    claude_pro: { multiplier: 1, label: 'Pro' },
    default_claude_pro: { multiplier: 1, label: 'Pro' },
    // Anthropic renamed Max 5x to Max and Max 20x to Ultra on 2026-10-30. Profiles may report
    // either generation of tier name, so both are listed.
    default_claude_max_5x: { multiplier: 5, label: 'Max' },
    default_claude_max: { multiplier: 5, label: 'Max' },
    default_claude_max_20x: { multiplier: 20, label: 'Ultra' },
    default_claude_ultra: { multiplier: 20, label: 'Ultra' },
  },
  codex: {
    plus: { multiplier: 1, label: 'Plus' },
    pro: { multiplier: 10, label: 'Pro' },
    promax: { multiplier: 25, label: 'Pro 500' },
  },
  antigravity: {
    'g1-ultra-tier': { multiplier: 20, label: 'Ultra' },
    'g1-ultra-lite-tier': { multiplier: 20, label: 'Ultra' },
  },
};

export const POINTS_PER_UNIT = 100;

export function planWeight(
  provider: PoolProviderId,
  plan: string | null | undefined
): { multiplier: number; label: string | null; known: boolean } {
  const entry = plan ? PLANS[provider][plan] : undefined;
  return entry ? { ...entry, known: true } : { multiplier: 1, label: plan || null, known: false };
}

/** ChatGPT's usage response names the plan, e.g. "pro" or "promax". */
export function planFromCodexUsage(body: unknown): string | null {
  return normalizePlanType(parseCodexUsagePayload(body)?.plan_type);
}

/** Claude's OAuth profile names the plan as a rate-limit tier or an organization type; prefer
 * whichever the table knows (Pro accounts report a generic tier but a "claude_pro" type). */
export function planFromClaudeProfile(body: unknown): string | null {
  let profile: unknown = body;
  if (typeof body === 'string') {
    try {
      profile = JSON.parse(body);
    } catch {
      return null;
    }
  }
  const organization = isRecord(profile) ? profile.organization : null;
  if (!isRecord(organization)) return null;
  const candidates = [organization.rate_limit_tier, organization.organization_type]
    .map(normalizePlanType)
    .filter((plan): plan is string => plan !== null);
  return candidates.find((plan) => planWeight('claude', plan).known) ?? candidates[0] ?? null;
}

/** Antigravity's `loadCodeAssist` names the plan as a tier id, the paid tier first. */
export function planFromAntigravityCodeAssist(body: unknown): string | null {
  return parseAntigravitySubscriptionSummary(body)?.tierId ?? null;
}
