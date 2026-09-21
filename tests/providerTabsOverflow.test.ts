import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const tabsStyles = readFileSync(
  'src/features/authFiles/components/ProviderTabs.module.scss',
  'utf8'
);
const quotaStyles = readFileSync('src/features/quota/QuotaPage.module.scss', 'utf8');

describe('provider filter overflow', () => {
  test('constrains the strip and preserves native horizontal scrolling', () => {
    expect(tabsStyles).toMatch(/\.tabs\s*\{[^}]*min-width: 0;/);
    expect(tabsStyles).toMatch(/\.tabs\s*\{[^}]*max-width: 100%;/);
    expect(tabsStyles).toMatch(/\.tabs\s*\{[^}]*overflow-x: auto;/);
    expect(tabsStyles).toMatch(/\.tab\s*\{[^}]*flex-shrink: 0;/);
  });

  test('exposes a scrollbar for mouse users rather than hiding trailing providers', () => {
    expect(tabsStyles).toContain('scrollbar-width: thin;');
    expect(tabsStyles).not.toContain('scrollbar-width: none;');
    expect(tabsStyles).toMatch(/&::-webkit-scrollbar\s*\{\s*height: 6px;/);
    expect(tabsStyles).not.toMatch(/&::-webkit-scrollbar\s*\{[^}]*display: none/);
  });

  test('allocates remaining quota toolbar width without shrinking the sort control', () => {
    expect(quotaStyles).toMatch(/> :first-child\s*\{\s*flex: 1 1 auto;\s*min-width: 0;/);
    expect(quotaStyles).toMatch(/\.sort\s*\{\s*flex: 0 0 auto;/);
  });
});
