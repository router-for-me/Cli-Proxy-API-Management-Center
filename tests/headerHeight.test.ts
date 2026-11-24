import { describe, expect, test } from 'bun:test';

describe('header height', () => {
  test('comes from the stylesheet so the mobile value applies after a resize', async () => {
    const layout = await Bun.file('src/components/layout/MainLayout.tsx').text();
    const styles = await Bun.file('src/styles/layout.scss').text();

    expect(layout).not.toContain("'--header-height'");
    expect(styles).toMatch(
      /@media \(max-width: \$breakpoint-mobile\) \{\s*:root \{\s*--header-height: \d+px;/
    );
  });
});
