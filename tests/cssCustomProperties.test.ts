import { describe, expect, test } from 'bun:test';

describe('CSS custom properties', () => {
  test('every var() read has a definition', async () => {
    const defined = new Set<string>();
    const read = new Map<string, string>();

    for await (const path of new Bun.Glob('src/**/*.{scss,css,ts,tsx}').scan('.')) {
      const source = await Bun.file(path).text();
      // Stylesheet declarations, such as `--radius-md: 8px`.
      for (const [, name] of source.matchAll(/(?<![\w-])(--[\w-]+)\s*:/g)) defined.add(name);
      // Properties that scripts set at runtime, such as style={{ '--meter-index': 1 }}.
      for (const [, name] of source.matchAll(/['"`](--[\w-]+)['"`]/g)) defined.add(name);
      for (const [, name] of source.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (!read.has(name)) read.set(name, path);
      }
    }

    const undefinedReads = [...read].filter(([name]) => !defined.has(name));
    expect(undefinedReads).toEqual([]);
  });
});
