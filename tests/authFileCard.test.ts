import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// The quota host binds CSS-module classes at import time, which Bun cannot render.
// Keep these source contracts small; browser checks cover the actual card interactions.
const source = readFileSync(
  new URL('../src/features/authFiles/components/AuthFileCard.tsx', import.meta.url),
  'utf8'
);
const css = readFileSync(
  new URL('../src/features/authFiles/components/AuthFileCard.module.scss', import.meta.url),
  'utf8'
);

describe('auth file card presentation contract', () => {
  test('uses identity rather than logos or duplicate status badges', () => {
    expect(source).not.toContain('<img');
    expect(source).not.toContain('getAuthFileIcon');
    expect(source).not.toContain('stateBadge');
    expect(source).toContain('<h3');
    expect(source).toContain('{identity.primary}');
    expect(source).toContain('{identity.secondary}');
  });

  test('prefixes the account with a theme-aware legacy provider pill', () => {
    const heading = source.split('<h3')[1].split('</h3>')[0];
    expect(heading.indexOf('{typeLabel}')).toBeLessThan(heading.indexOf('{identity.primary}'));
    expect(heading).toContain('styles.providerBadge');
    expect(heading).toContain('backgroundColor: typeColor.bg');
    expect(heading).toContain('color: typeColor.text');
    expect(source).toContain('getTypeColor(providerKey, resolvedTheme)');
    const badge = css.split('.providerBadge {')[1].split('}')[0];
    expect(badge).toContain('border-radius: 12px');
    expect(badge).toContain('padding: 4px 10px');
    expect(badge).toContain('font-size: 12px');
    expect(badge).not.toContain('text-transform: uppercase');
    const account = css.split('.account {')[1].split('}')[0];
    expect(account).toContain('overflow-wrap: anywhere');
    expect(account).not.toContain('text-ellipsis');
  });

  test('uses one header toggle and credential-specific accessible names', () => {
    const header = source.split('<header')[1].split('</header>')[0];
    expect(source.match(/<ToggleSwitch/g)).toHaveLength(1);
    expect(header).toContain('<ToggleSwitch');
    expect(header).toContain("ariaLabel={t('auth_files.card_select', { name: file.name })}");
    expect(header).not.toContain('aria-label=');
    expect(header).toContain("t('auth_files.card_toggle', { name: file.name })");
    expect(header).toContain('checked={!file.disabled}');
    expect(header).toContain('statusUpdating[file.name] === true || isManualRefreshing');
    expect(header).toContain('isRuntimeOnly ?');
  });

  test('keeps disabled contents readable without card lift or logo styling', () => {
    expect(source).not.toContain('cardDisabled');
    expect(css).not.toContain('.cardDisabled');
    expect(css).not.toContain('.avatar');
    expect(css).not.toContain('translateY');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  test('retains individual management actions and warning detail', () => {
    for (const handler of [
      'onShowModels(file)',
      'onDownload(file.name)',
      'onManualRefresh(file)',
      'onOpenPrefixProxyEditor(file)',
      'onDelete(file.name)',
    ]) {
      expect(source).toContain(handler);
    }
    expect(source).toContain('rawStatusMessage && hasStatusWarning');
    expect(source).toContain('showManualRefreshButton');
    expect(source).toContain('file.disabled ||');
  });
});
