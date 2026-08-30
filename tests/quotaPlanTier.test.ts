import { describe, expect, test } from 'bun:test';
import {
  ELITE_CODEX_PLAN_TYPE,
  PREMIUM_CODEX_PLAN_TYPES,
  resolvePlanTier,
  resolveClaudePlanTier,
} from '@/utils/quota';

describe('resolvePlanTier', () => {
  test("elite wins for 'pro' even though it is also in the premium set (order contract)", () => {
    // 顺序契约回归：'pro' 同时命中 PREMIUM_CODEX_PLAN_TYPES，
    // 一旦 premium 判断先行，Pro 20x 会静默退回金卡。
    expect(PREMIUM_CODEX_PLAN_TYPES.has(ELITE_CODEX_PLAN_TYPE)).toBe(true);
    expect(resolvePlanTier('pro')).toBe('elite');
  });

  test('normalizes case and whitespace before matching', () => {
    expect(resolvePlanTier('PRO')).toBe('elite');
    expect(resolvePlanTier('  Pro  ')).toBe('elite');
    expect(resolvePlanTier('Pro-Lite')).toBe('premium');
  });

  test('maps every pro-lite spelling to premium', () => {
    expect(resolvePlanTier('prolite')).toBe('premium');
    expect(resolvePlanTier('pro-lite')).toBe('premium');
    expect(resolvePlanTier('pro_lite')).toBe('premium');
  });

  test('maps ordinary and unknown plans to plain', () => {
    expect(resolvePlanTier('plus')).toBe('plain');
    expect(resolvePlanTier('team')).toBe('plain');
    expect(resolvePlanTier('free')).toBe('plain');
    expect(resolvePlanTier('enterprise')).toBe('plain');
  });

  test('maps missing values to plain', () => {
    expect(resolvePlanTier(null)).toBe('plain');
    expect(resolvePlanTier(undefined)).toBe('plain');
    expect(resolvePlanTier('')).toBe('plain');
    expect(resolvePlanTier('   ')).toBe('plain');
  });
});

describe('resolveClaudePlanTier', () => {
  test('gives Max the gold badge, not the platinum one', () => {
    // Platinum marks a single top tier; the profile endpoint exposes only a
    // has_claude_max boolean, so plan_max cannot be told apart from Max 5x.
    expect(resolveClaudePlanTier('plan_max')).toBe('premium');
    expect(resolveClaudePlanTier('plan_max5')).toBe('premium');
  });

  test('reserves platinum for Max 20x', () => {
    expect(resolveClaudePlanTier('plan_max20')).toBe('elite');
  });

  test('leaves the lower tiers unbadged', () => {
    expect(resolveClaudePlanTier('plan_pro')).toBe('plain');
    expect(resolveClaudePlanTier('plan_team')).toBe('plain');
    expect(resolveClaudePlanTier('plan_free')).toBe('plain');
    expect(resolveClaudePlanTier('plan_unknown')).toBe('plain');
  });

  test('tolerates casing, padding and absence', () => {
    expect(resolveClaudePlanTier('  PLAN_MAX  ')).toBe('premium');
    expect(resolveClaudePlanTier(null)).toBe('plain');
    expect(resolveClaudePlanTier(undefined)).toBe('plain');
    expect(resolveClaudePlanTier('')).toBe('plain');
  });
});
