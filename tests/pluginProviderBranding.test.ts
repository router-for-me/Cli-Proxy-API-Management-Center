import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import { ProviderTabs } from '../src/features/authFiles/components/ProviderTabs';
import { getAuthFileIcon, getTypeLabel } from '../src/features/authFiles/constants';
import { collectPluginProviderBranding } from '../src/features/plugins/pluginResources';
import type { PluginListEntry } from '../src/types';
import en from '../src/i18n/locales/en.json';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });
const t = i18n.t.bind(i18n);

const META_LOGO = 'https://cdn.example.com/meta.svg';

const plugin = (overrides: Partial<PluginListEntry>): PluginListEntry => ({
  id: 'muse-code',
  path: '/plugins/muse-code.so',
  configured: true,
  registered: true,
  enabled: true,
  effectiveEnabled: true,
  supportsOAuth: true,
  oauthProvider: 'muse-code',
  logo: META_LOGO,
  configFields: [],
  menus: [],
  metadata: {
    name: 'Muse Code',
    version: '0.1.1',
    author: 'someone',
    githubRepository: 'https://github.com/someone/muse-code',
    logo: META_LOGO,
    configFields: [],
  },
  ...overrides,
});

describe('plugin provider branding', () => {
  test('collects label and logo from active OAuth plugins only', () => {
    const branding = collectPluginProviderBranding(
      [
        plugin({}),
        plugin({ id: 'shadow', oauthProvider: 'muse-code', metadata: null, logo: '/other.svg' }),
        plugin({ id: 'off', oauthProvider: 'off-provider', effectiveEnabled: false }),
        plugin({ id: 'no-oauth', oauthProvider: 'plain', supportsOAuth: false }),
        plugin({
          id: 'relative',
          oauthProvider: 'Relative_Provider',
          logo: '',
          metadata: null,
        }),
      ],
      'https://proxy.example.com'
    );

    expect(branding).toEqual({
      'muse-code': { label: 'Muse Code', logo: META_LOGO },
      'relative-provider': { label: 'relative', logo: '' },
    });
  });

  test('falls back to plugin branding only for non built-in providers', () => {
    const branding = { 'muse-code': { label: 'Muse Code', logo: META_LOGO } };

    expect(getTypeLabel(t, 'muse-code', branding)).toBe('Muse Code');
    expect(getAuthFileIcon('muse-code', 'dark', branding)).toBe(META_LOGO);

    expect(getTypeLabel(t, 'muse-code')).toBe('Muse-code');
    expect(getAuthFileIcon('muse-code', 'dark')).toBeNull();

    const shadowing = { codex: { label: 'Fake Codex', logo: META_LOGO } };
    expect(getTypeLabel(t, 'codex', shadowing)).toBe(getTypeLabel(t, 'codex'));
    expect(getAuthFileIcon('codex', 'light', shadowing)).not.toBe(META_LOGO);
  });

  test('renders the plugin logo and name in the provider tabs', () => {
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(ProviderTabs, {
          types: ['all', 'muse-code'],
          counts: { all: 1, 'muse-code': 1 },
          active: 'muse-code',
          resolvedTheme: 'dark',
          pluginBranding: { 'muse-code': { label: 'Muse Code', logo: META_LOGO } },
          onChange: () => {},
        })
      )
    );

    expect(markup).toContain(`src="${META_LOGO}"`);
    expect(markup).toContain('Muse Code');
    expect(markup).not.toContain('Muse-code');
  });
});
