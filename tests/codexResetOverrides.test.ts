import { describe, expect, test } from 'bun:test';
import {
  CODEX_RESET_OVERRIDES_KEY,
  formatLocalDateTimeInput,
  parseCodexResetOverrides,
  parseLocalDateTimeInput,
  readCodexResetOverrides,
  writeCodexResetOverrides,
} from '../src/features/quota/codexResetOverrides';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
};

describe('Codex reset overrides', () => {
  test('reads the ISO-string shape documented for browser-console use', () => {
    const value = JSON.stringify({
      'codex-alice.json': '2026-09-22T12:00:00+02:00',
      invalid: 'not-a-date',
    });

    expect(parseCodexResetOverrides(value)).toEqual({
      'codex-alice.json': new Date('2026-09-22T12:00:00+02:00').getTime(),
    });
    expect(parseCodexResetOverrides('{')).toEqual({});
  });

  test('writes ISO values and removes the key when the last override is cleared', () => {
    const storage = memoryStorage();
    const resetAtMs = new Date('2026-09-22T10:00:00Z').getTime();

    writeCodexResetOverrides({ 'codex-alice.json': resetAtMs }, storage);
    expect(readCodexResetOverrides(storage)).toEqual({ 'codex-alice.json': resetAtMs });
    expect(storage.getItem(CODEX_RESET_OVERRIDES_KEY)).toContain('2026-09-22T10:00:00.000Z');

    writeCodexResetOverrides({}, storage);
    expect(storage.getItem(CODEX_RESET_OVERRIDES_KEY)).toBeNull();
  });

  test('round-trips a local datetime input without changing the instant', () => {
    const resetAtMs = new Date(2026, 8, 22, 12, 30).getTime();
    expect(parseLocalDateTimeInput(formatLocalDateTimeInput(resetAtMs))).toBe(resetAtMs);
    expect(parseLocalDateTimeInput('')).toBeNull();
  });
});
