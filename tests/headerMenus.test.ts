import { describe, expect, test } from 'bun:test';

const layout = () => Bun.file('src/styles/layout.scss').text();

describe('header menus', () => {
  test('language and theme popovers are opaque without the glass blur', async () => {
    const styles = await layout();
    const popover = styles.match(/\.language-menu-popover,\s*\.theme-menu-popover \{([^}]*)\}/);
    expect(popover?.[1]).toContain('background: var(--floating-surface);');
    expect(popover?.[1]).not.toContain('backdrop-filter');
  });

  test('the selected language uses the text color, not the muted primary color', async () => {
    const styles = await layout();
    const option = styles.slice(styles.indexOf('.language-menu-option {'));
    expect(option).toMatch(/&\.active \{\s*color: var\(--text-primary\);/);
  });
});
