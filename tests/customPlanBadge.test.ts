import { describe, expect, test } from 'bun:test';
import i18n from '@/i18n';
import '@/custom/i18n';
import { resolvePlanBadge } from '@/custom/quotaOverview/planBadge';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';
import type { AuthFileItem } from '@/types';

const t = i18n.cloneInstance({ lng: 'en', initImmediate: false }).t;

const entry = (type: string, extra: Partial<AuthFileItem> = {}): QuotaFileEntry =>
  ({ type, file: { name: `${type}.json`, type, ...extra } }) as QuotaFileEntry;
const loaded = (fields: Record<string, unknown>) =>
  ({ status: 'success', windows: [], ...fields }) as unknown as QuotaCardState;

describe('plan badges', () => {
  test('Claude prefers the profile tier and ranks Max 20x as the top plan', () => {
    expect(resolvePlanBadge(entry('claude'), undefined, 'Max 20x', t)).toEqual({
      label: 'Max 20x',
      tier: 'flagship',
    });
    expect(resolvePlanBadge(entry('claude'), undefined, 'Max 5x', t)?.tier).toBe('premium');
    expect(resolvePlanBadge(entry('claude'), undefined, 'Pro', t)?.tier).toBe('standard');
  });

  test('Claude falls back to the quota plan type with upstream labels', () => {
    expect(resolvePlanBadge(entry('claude'), loaded({ planType: 'plan_max5' }), null, t)).toEqual({
      label: 'Max 5x',
      tier: 'premium',
    });
  });

  test('Codex names Pro 200, Pro 100 and Pro 500 and ranks them like upstream', () => {
    const codex = (planType: string) =>
      resolvePlanBadge(entry('codex'), loaded({ planType }), null, t);
    expect(codex('pro')).toEqual({ label: 'Pro 200', tier: 'premium' });
    expect(codex('prolite')).toEqual({ label: 'Pro 100', tier: 'premium' });
    expect(codex('promax')).toEqual({ label: 'Pro 500', tier: 'flagship' });
    expect(codex('plus')).toEqual({ label: 'Plus', tier: 'standard' });
  });

  test('Codex reads the plan from the credential before quota loads', () => {
    expect(resolvePlanBadge(entry('codex', { plan_type: 'pro' }), undefined, null, t)).toEqual({
      label: 'Pro 200',
      tier: 'premium',
    });
  });

  test('Antigravity names Ultra, Ultra Lite and Pro from the subscription', () => {
    const antigravity = (plan: string | null, tierName: string | null = null) =>
      resolvePlanBadge(
        entry('antigravity'),
        loaded({ subscription: { plan, tierName, tierId: null } }),
        null,
        t
      );
    expect(antigravity('ultra')).toEqual({ label: 'Ultra', tier: 'flagship' });
    expect(antigravity('ultra-lite')).toEqual({ label: 'Ultra Lite', tier: 'premium' });
    expect(antigravity('pro')).toEqual({ label: 'Pro', tier: 'standard' });
    expect(antigravity('unknown', 'Google AI Ultra for Business')?.label).toBe(
      'Google AI Ultra for Business'
    );
  });

  test('returns nothing when the plan is not known', () => {
    expect(resolvePlanBadge(entry('antigravity'), undefined, null, t)).toBeNull();
    expect(resolvePlanBadge(entry('claude'), loaded({}), null, t)).toBeNull();
  });
});
