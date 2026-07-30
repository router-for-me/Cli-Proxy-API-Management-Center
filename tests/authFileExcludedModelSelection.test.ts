import { describe, expect, test } from 'bun:test';
import {
  isModelExcludedByWildcard,
  matchesExcludedModelRule,
  parseExcludedModelRules,
  replaceCustomExcludedModelRules,
  splitExcludedModelRules,
  toggleExcludedModel,
} from '../src/features/authFiles/excludedModelSelection';

describe('auth-file excluded model selection', () => {
  test('normalizes lines and matches backend wildcard semantics case-insensitively', () => {
    expect(parseExcludedModelRules(' GPT-5-*\ngpt-5-*\nclaude-opus ')).toEqual([
      'GPT-5-*',
      'claude-opus',
    ]);
    expect(matchesExcludedModelRule('gpt-5-*', 'GPT-5-Codex')).toBe(true);
    expect(matchesExcludedModelRule('*-preview', 'gemini-3-pro-preview')).toBe(true);
    expect(matchesExcludedModelRule('gpt-5-*', 'gpt-4.1')).toBe(false);
  });

  test('separates selectable exact models from custom rules', () => {
    expect(
      splitExcludedModelRules(
        ['GPT-5-Codex', 'gpt-5-*', 'unlisted-model'],
        ['gpt-5-codex', 'claude-opus']
      )
    ).toEqual({
      selectedIds: ['gpt-5-codex'],
      customRules: ['gpt-5-*', 'unlisted-model'],
    });
  });

  test('adds and removes exact selections without changing wildcard rules', () => {
    const added = toggleExcludedModel(['gpt-5-*'], 'claude-opus', true);
    expect(added).toEqual(['gpt-5-*', 'claude-opus']);
    expect(toggleExcludedModel(added, 'CLAUDE-OPUS', false)).toEqual(['gpt-5-*']);
    expect(isModelExcludedByWildcard(added, 'gpt-5-mini')).toBe(true);
  });

  test('updates custom rules while retaining selected credential models', () => {
    expect(
      replaceCustomExcludedModelRules(
        ['gpt-5-codex', 'old-*'],
        ['gpt-5-codex', 'claude-opus'],
        'new-*\nlegacy-model'
      )
    ).toEqual(['gpt-5-codex', 'new-*', 'legacy-model']);
  });
});
