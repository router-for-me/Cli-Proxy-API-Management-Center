import { describe, expect, test } from 'bun:test';

const mobileRules = async () => {
  const styles = await Bun.file('src/styles/layout.scss').text();
  return styles.slice(styles.indexOf('@media (max-width: $breakpoint-mobile) {'));
};

describe('mobile drawer', () => {
  test('hides the floating header actions while the drawer is open', async () => {
    const layout = await Bun.file('src/components/layout/MainLayout.tsx').text();
    expect(layout).toContain("sidebarOpen ? 'sidebar-is-open' : ''");
    expect(await mobileRules()).toMatch(
      /\.app-shell\.sidebar-is-open \.main-header \.header-actions \{\s*visibility: hidden;/
    );
  });

  test('keeps the drawer brand clear of the floating close button', async () => {
    expect(await mobileRules()).toMatch(
      /\.sidebar\.collapsed \.sidebar-header \{\s*justify-content: flex-start;\s*padding-left: 56px;/
    );
  });
});
