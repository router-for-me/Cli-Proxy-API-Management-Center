import { describe, expect, test } from 'bun:test';
import {
  getCustomOAuthExcludedRules,
  getEffectiveOAuthExcludedRules,
  hasOAuthExcludedRule,
  normalizeOAuthExcludedRules,
  updateOAuthExcludedRule,
} from '../src/features/authFiles/oauthExcludedRules';

describe('OAuth excluded rules', () => {
  test('keeps wildcard rules and removes case-insensitive duplicates', () => {
    expect(normalizeOAuthExcludedRules([' gpt-* ', 'GPT-*', '', 'claude-3'])).toEqual([
      'gpt-*',
      'claude-3',
    ]);
  });

  test('finds and toggles rules case-insensitively', () => {
    expect(hasOAuthExcludedRule(['GPT-4o'], 'gpt-4O')).toBe(true);
    expect(updateOAuthExcludedRule(['GPT-4o'], ' gpt-4O ', false)).toEqual([]);
    expect(updateOAuthExcludedRule(['gpt-4o'], ' gpt-* ', true)).toEqual(['gpt-4o', 'gpt-*']);
  });

  test('returns configured rules that are absent from the static model catalog', () => {
    expect(
      getCustomOAuthExcludedRules(
        ['gpt-4o', 'gpt-*', 'retired-model', 'CLAUDE-3'],
        ['GPT-4O', 'claude-3']
      )
    ).toEqual(['gpt-*', 'retired-model']);
  });

  test('includes a pending custom rule in the effective rules', () => {
    expect(getEffectiveOAuthExcludedRules(['gpt-4o'], ' gpt-* ')).toEqual(['gpt-4o', 'gpt-*']);
  });

  test('ignores a blank pending custom rule', () => {
    expect(getEffectiveOAuthExcludedRules(['gpt-4o'], '   ')).toEqual(['gpt-4o']);
  });

  test('keeps the original spelling for a case-insensitive duplicate', () => {
    expect(getEffectiveOAuthExcludedRules(['GPT-4o'], 'gpt-4O')).toEqual(['GPT-4o']);
  });
});
