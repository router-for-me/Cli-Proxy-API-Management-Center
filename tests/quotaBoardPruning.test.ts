import { describe, expect, test } from 'bun:test';
import { pruneSliceToFiles } from '../src/components/quota/useQuotaBoard';
import type { AuthFileItem } from '../src/types';

const file = (name: string) => ({ name }) as AuthFileItem;
const loaded = (label: string) => ({ status: 'success' as const, label });

describe('quota board slice pruning', () => {
  test('keeps cached quota for credentials that still exist', () => {
    const prev = { 'a.json': loaded('a'), 'b.json': loaded('b') };
    const next = pruneSliceToFiles(prev, [file('a.json'), file('b.json')]);

    expect(next).toEqual(prev);
  });

  test('drops cached quota for a credential that disappeared', () => {
    const prev = { 'a.json': loaded('a'), 'b.json': loaded('b') };
    const next = pruneSliceToFiles(prev, [file('a.json')]);

    expect(Object.keys(next)).toEqual(['a.json']);
    expect(next['a.json']).toBe(prev['a.json']);
  });

  test('returns the identical object when nothing changed, so no re-render loop', () => {
    const prev = { 'a.json': loaded('a') };

    expect(pruneSliceToFiles(prev, [file('a.json')])).toBe(prev);
    expect(pruneSliceToFiles({}, [])).toEqual({});
  });

  test('empties the slice when the provider has no credentials left', () => {
    const prev = { 'a.json': loaded('a') };

    expect(pruneSliceToFiles(prev, [])).toEqual({});
  });

  /**
   * The regression this whole per-provider split exists to prevent.
   *
   * Each provider's slice must be pruned against ONLY that provider's files.
   * Running one pass over a flat, mixed credential list means every provider
   * sees a list that is mostly other providers' files, and wipes its own slice.
   */
  test('per-provider pruning preserves every slice; one flat pass would wipe them', () => {
    const claudeSlice = { 'claude-a.json': loaded('a'), 'claude-b.json': loaded('b') };
    const codexSlice = { 'codex-a.json': loaded('c') };
    const kimiSlice = { 'kimi-a.json': loaded('d') };

    const claudeFiles = [file('claude-a.json'), file('claude-b.json')];
    const codexFiles = [file('codex-a.json')];
    const kimiFiles = [file('kimi-a.json')];

    // Correct: each slice pruned against its own provider's files.
    expect(pruneSliceToFiles(claudeSlice, claudeFiles)).toEqual(claudeSlice);
    expect(pruneSliceToFiles(codexSlice, codexFiles)).toEqual(codexSlice);
    expect(pruneSliceToFiles(kimiSlice, kimiFiles)).toEqual(kimiSlice);

    // Wrong: pruning a slice against one provider's subset of a flat list.
    // Documents the failure mode — Codex and Kimi lose everything.
    expect(pruneSliceToFiles(codexSlice, claudeFiles)).toEqual({});
    expect(pruneSliceToFiles(kimiSlice, claudeFiles)).toEqual({});
  });
});
