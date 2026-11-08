import { describe, expect, test } from 'bun:test';

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const themeBlock = (themes: string, selector: string) => {
  const start = themes.indexOf(`${selector} {`);
  return themes.slice(start, themes.indexOf('\n}', start));
};

const token = (block: string, name: string) => {
  const match = block.match(new RegExp(`(?:^|\\s)${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`${name} is not a hex color`);
  return match[1];
};

describe('primary button', () => {
  test('keeps a 4.5:1 label contrast in every theme', async () => {
    const components = await Bun.file('src/styles/components.scss').text();
    const themes = await Bun.file('src/styles/themes.scss').text();
    const primary = components.match(/&\.btn-primary \{([^}]*)/)?.[1] ?? '';
    const fill = primary.match(/background-color: var\((--[\w-]+)[,)]/)?.[1];
    const label = primary.match(/\n\s*color: var\((--[\w-]+)[,)]/)?.[1];
    expect(fill).toBeDefined();
    expect(label).toBeDefined();

    for (const selector of [':root', "[data-theme='white']", "[data-theme='dark']"]) {
      const block = themeBlock(themes, selector);
      expect(contrast(token(block, fill!), token(block, label!))).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('is not recolored by a theme override', async () => {
    const components = await Bun.file('src/styles/components.scss').text();
    expect(components).not.toMatch(/\[data-theme='dark'\]\s*\{\s*\.btn\b/);
  });
});
