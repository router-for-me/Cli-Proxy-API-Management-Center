import { describe, expect, test } from 'bun:test';
import {
  XAI_SUPERGROK_HEAVY_LIMIT_CENTS,
  planValueClassForTier,
  resolveAntigravityCardTier,
  resolveClaudeCardTier,
  resolveCodexCardTier,
  resolveInitialQuotaCardTier,
  resolveKimiCardTier,
  resolveQuotaCardTier,
  resolveXaiCardTier,
} from '@/features/quota/cardTier';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import type { XaiBillingSummary } from '@/types';

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test-host'
);

const billing = (overrides: Partial<XaiBillingSummary> = {}): XaiBillingSummary => ({
  mode: 'billing',
  periodType: 'monthly',
  usagePercent: null,
  productUsage: [],
  monthlyLimitCents: null,
  usedCents: null,
  includedUsedCents: null,
  onDemandCapCents: null,
  onDemandUsedCents: null,
  onDemandUsedPercent: null,
  usedPercent: null,
  ...overrides,
});

describe('quota card tier ladder', () => {
  test('Codex: Pro 500 is the suite, Pro 200 and Pro 100 are premium, Business ranks with Plus', () => {
    expect(resolveCodexCardTier('promax')).toBe('flagship');
    expect(resolveCodexCardTier('pro')).toBe('premium');
    expect(resolveCodexCardTier('prolite')).toBe('premium');
    expect(resolveCodexCardTier('self_serve_business_prolite')).toBe('standard');
    expect(resolveCodexCardTier('team')).toBe('standard');
    expect(resolveCodexCardTier('plus')).toBe('standard');
    expect(resolveCodexCardTier(null)).toBe('standard');
  });

  test.each([
    ['Allegro', 'promax'],
    ['Allegretto', 'pro'],
    ['Moderato', 'plus'],
  ])('Kimi %s shares the Codex %s tier', (planName, codexPlan) => {
    const expected = resolveCodexCardTier(codexPlan);
    expect(resolveKimiCardTier(planName)).toBe(expected);
    expect(resolveKimiCardTier(` ${planName.toUpperCase()} `)).toBe(expected);
    expect(resolveQuotaCardTier('kimi', { status: 'success', rows: [], planName })).toBe(expected);
  });

  test('Kimi Andante and unknown names stay standard, and pending reads preserve the tier', () => {
    for (const name of ['Andante', 'Vivace', 'Allegro Plus', '', null, undefined]) {
      expect(resolveKimiCardTier(name)).toBe('standard');
    }
    expect(resolveQuotaCardTier('kimi', { status: 'loading' })).toBeNull();
    expect(resolveQuotaCardTier('kimi', { status: 'error' })).toBeNull();
  });

  test('Antigravity: Ultra is the suite, Ultra Lite is premium', () => {
    expect(resolveAntigravityCardTier('ultra')).toBe('flagship');
    expect(resolveAntigravityCardTier(' Ultra-Lite ')).toBe('premium');
    expect(resolveAntigravityCardTier('pro')).toBe('standard');
    expect(resolveAntigravityCardTier(null)).toBe('standard');
  });

  test('Claude: Max 20x is the suite, Max 5x and an unspecified Max are premium', () => {
    expect(resolveClaudeCardTier('plan_max20')).toBe('flagship');
    expect(resolveClaudeCardTier('plan_max5')).toBe('premium');
    expect(resolveClaudeCardTier('plan_max')).toBe('premium');
    expect(resolveClaudeCardTier('plan_pro')).toBe('standard');
    expect(resolveClaudeCardTier(null)).toBe('standard');
  });

  test('xAI: subscription tier wins, then paid API, then the Heavy monthly limit', () => {
    expect(resolveXaiCardTier(billing({ planLabel: 'SuperGrok Heavy', planTier: 'elite' }))).toBe(
      'flagship'
    );
    expect(resolveXaiCardTier(billing({ planLabel: 'SuperGrok', planTier: 'premium' }))).toBe(
      'premium'
    );
    expect(resolveXaiCardTier(billing({ planLabel: 'Basic', planTier: 'standard' }))).toBe(
      'standard'
    );
    expect(resolveXaiCardTier(billing({ mode: 'paid-health' }))).toBe('premium');
    expect(
      resolveXaiCardTier(billing({ monthlyLimitCents: XAI_SUPERGROK_HEAVY_LIMIT_CENTS }))
    ).toBe('flagship');
    // The monthly-limit fallback agrees with the subscription interface.
    expect(resolveXaiCardTier(billing({ monthlyLimitCents: 15_000 }))).toBe('premium');
    expect(resolveXaiCardTier(billing({ monthlyLimitCents: 3_000 }))).toBe('standard');
  });

  test('only a successful read decides the tier', () => {
    expect(resolveQuotaCardTier('codex', undefined)).toBeNull();
    expect(resolveQuotaCardTier('codex', { status: 'loading' })).toBeNull();
    expect(resolveQuotaCardTier('codex', { status: 'error' })).toBeNull();
    expect(resolveQuotaCardTier('codex', { status: 'success', planType: 'promax' } as never)).toBe(
      'flagship'
    );
    expect(resolveQuotaCardTier('kimi', { status: 'success' })).toBe('standard');
    expect(resolveQuotaCardTier('xai', { status: 'success', billing: null } as never)).toBe(
      'standard'
    );
  });

  test('a Codex auth file seeds the tier before any quota is read', () => {
    expect(resolveInitialQuotaCardTier('codex', { name: 'a.json', plan_type: 'promax' })).toBe(
      'flagship'
    );
    expect(resolveInitialQuotaCardTier('codex', { name: 'a.json', plan_type: 'pro' })).toBe(
      'premium'
    );
    expect(resolveInitialQuotaCardTier('codex', { name: 'b.json' })).toBe('standard');
    expect(resolveInitialQuotaCardTier('claude', { name: 'c.json', plan_type: 'pro' })).toBe(
      'standard'
    );
  });

  test('the plan text class follows the card tier', () => {
    expect(planValueClassForTier('flagship', classes)).toBe('elitePlanValue');
    expect(planValueClassForTier('premium', classes)).toBe('premiumPlanValue');
    expect(planValueClassForTier('standard', classes)).toBe('codexPlanValue');
  });
});
