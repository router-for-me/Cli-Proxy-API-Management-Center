import { describe, expect, test } from 'bun:test';
import { classifyModels, normalizeModelList } from '@/utils/models';

describe('model grouping by owned_by', () => {
  test('preserves owned_by from /v1/models payloads', () => {
    const models = normalizeModelList({
      data: [
        { id: 'claude-opus-5-5', object: 'model', owned_by: 'anthropic' },
        { id: 'claude-opus-5-5-high', object: 'model', owned_by: 'antigravity' },
        { id: 'gpt-5' },
      ],
    });

    expect(models).toEqual([
      { name: 'claude-opus-5-5', ownedBy: 'anthropic' },
      { name: 'claude-opus-5-5-high', ownedBy: 'antigravity' },
      { name: 'gpt-5' },
    ]);
  });

  test('groups Antigravity-served models by owner instead of model family', () => {
    const groups = classifyModels([
      { name: 'claude-opus-5-5', ownedBy: 'anthropic' },
      { name: 'claude-opus-5-5-high', ownedBy: 'antigravity' },
      { name: 'gemini-3.1-pro-low', ownedBy: 'Antigravity' },
      { name: 'gemini-3.5-flash', ownedBy: 'google' },
      { name: 'devin/claude-opus-5-5', ownedBy: 'antigravity' },
    ]);

    const names = (id: string) =>
      groups.find((group) => group.id === id)?.items.map((item) => item.name);

    expect(names('antigravity')).toEqual(['claude-opus-5-5-high', 'gemini-3.1-pro-low']);
    expect(names('claude')).toEqual(['claude-opus-5-5']);
    expect(names('gemini')).toEqual(['gemini-3.5-flash']);
    expect(names('devin')).toEqual(['devin/claude-opus-5-5']);
  });

  test('falls back to name patterns for unmapped or missing owners', () => {
    const groups = classifyModels([
      { name: 'claude-sonnet' },
      { name: 'claude-haiku', ownedBy: 'constructor' },
      { name: 'unknown-model', ownedBy: 'someone' },
    ]);

    expect(groups.find((group) => group.id === 'claude')?.items).toHaveLength(2);
    expect(groups.find((group) => group.id === 'other')?.items).toHaveLength(1);
    expect(groups.some((group) => group.id === 'antigravity')).toBe(false);
  });
});
