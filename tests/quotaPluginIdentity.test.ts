import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '@/i18n';
import { getAuthFileIcon } from '@/features/authFiles/constants';
import { getQuotaPluginLogo } from '@/features/quota/providers/plugin/identity';
import type { PluginListEntry } from '@/types';

// Match the existing CSS-module stub used by static component-rendering tests.
for (const name of ['QuotaBody', 'QuotaCard']) {
  mock.module(
    join(import.meta.dir, `../src/features/quota/components/${name}.module.scss`),
    () => ({
      default: new Proxy({}, { get: (_, key) => (typeof key === 'string' ? key : undefined) }),
    })
  );
}
const { QuotaCard } = await import('@/features/quota/components/QuotaCard');

const plugin = (overrides: Partial<PluginListEntry> = {}): PluginListEntry => ({
  id: 'custom-quota',
  path: '/plugins/custom-quota',
  configured: true,
  registered: true,
  enabled: true,
  effectiveEnabled: true,
  supportsOAuth: false,
  supportsQuota: true,
  quotaProvider: 'custom',
  logo: 'https://assets.example.test/custom.svg',
  configFields: [],
  menus: [],
  metadata: null,
  ...overrides,
});
const file = { name: 'custom.json', type: 'custom', quotaPluginId: 'custom-quota' };
const apiBase = 'https://proxy.example.test';

describe('quota plugin identity', () => {
  test('reads the declared logo of the host-selected plugin', () => {
    expect(getQuotaPluginLogo(file, [plugin()], apiBase)).toBe(plugin().logo);
    expect(
      getQuotaPluginLogo(file, [plugin({ id: 'other', logo: 'wrong.svg' }), plugin()], apiBase)
    ).toBe(plugin().logo);
    expect(getQuotaPluginLogo(file, [plugin({ id: 'other' })], apiBase)).toBe('');
  });

  test('reuses runtime and metadata precedence without needing a store request', () => {
    const metadata = {
      name: 'Custom',
      version: '1.0.0',
      author: '',
      githubRepository: '',
      logo: '/assets/custom.svg',
      configFields: [],
    };
    expect(getQuotaPluginLogo(file, [plugin({ metadata })], apiBase)).toBe(plugin().logo);
    expect(getQuotaPluginLogo(file, [plugin({ logo: ' ', metadata })], apiBase)).toBe(
      `${apiBase}/assets/custom.svg`
    );
    expect(getQuotaPluginLogo(file, [plugin({ logo: '' })], apiBase)).toBe('');
    expect(getQuotaPluginLogo(file, [], apiBase)).toBe('');
  });

  test('uses the existing legacy provider matching only without an explicit selection', () => {
    expect(
      getQuotaPluginLogo({ name: 'old.json', quotaProvider: ' CUSTOM ' }, [plugin()], apiBase)
    ).toBe(plugin().logo);
    expect(
      getQuotaPluginLogo(
        { name: 'old.json', quotaProvider: 'unknown' },
        [plugin(), plugin({ id: 'other', quotaProvider: 'other' })],
        apiBase
      )
    ).toBe('');
  });

  test('preserves existing remote, data and relative asset URL handling', () => {
    for (const logo of [
      'https://assets.example.test/custom.svg',
      'data:image/svg+xml,%3Csvg%20xmlns="http://www.w3.org/2000/svg"/%3E',
      'blob:https://proxy.example.test/synthetic',
      'invalid-image-reference',
    ]) {
      expect(getQuotaPluginLogo(file, [plugin({ logo })], apiBase)).toBe(logo);
    }
    expect(getQuotaPluginLogo(file, [plugin({ logo: '/custom.svg' })], apiBase)).toBe(
      `${apiBase}/custom.svg`
    );
  });

  test('updates identity when metadata arrives, changes or disappears', () => {
    expect(getQuotaPluginLogo(file, [], apiBase)).toBe('');
    expect(getQuotaPluginLogo(file, [plugin()], apiBase)).toBe(plugin().logo);
    expect(getQuotaPluginLogo(file, [plugin({ logo: '/new.svg' })], apiBase)).toBe(
      `${apiBase}/new.svg`
    );
    expect(getQuotaPluginLogo(file, [], apiBase)).toBe('');
  });
});

describe('quota card icon precedence', () => {
  const render = (provider: string, pluginLogo?: string) =>
    renderToStaticMarkup(
      createElement(QuotaCard, {
        entry: { type: 'plugin', file: { ...file, type: provider } },
        pluginLogo,
        resolvedTheme: 'light',
        canRefresh: false,
        resetting: false,
        onRefresh: () => {},
        onReset: () => {},
      })
    );

  test('renders a declared custom logo as a decorative image', () => {
    const markup = render('custom', plugin().logo);
    expect(markup).toContain(`<img src="${plugin().logo}" alt=""`);
  });

  test('keeps known registry icons ahead of plugin logos', () => {
    const markup = render('gemini', plugin().logo);
    expect(markup).toContain(`<img src="${getAuthFileIcon('gemini', 'light')}" alt=""`);
    expect(markup).not.toContain(plugin().logo);
  });

  test('retains the initial fallback when no declared logo is available', () => {
    const markup = render('custom');
    expect(markup).not.toContain('<img');
    expect(markup).toContain('>C</span>');
  });
});

// Source contracts guard React's state ownership/key boundary. SSR above cannot exercise image
// errors or reconciliation; the real QuotaPage browser fixture verifies both recovery sequences.
describe('quota card icon lifetime contract', () => {
  const source = readFileSync(
    join(import.meta.dir, '../src/features/quota/components/QuotaCard.tsx'),
    'utf8'
  );
  const [iconSource, cardSource] = source.split('export function QuotaCard(');

  test('keys the state-owning icon by selected source, including the absent lifetime', () => {
    expect(iconSource).toContain('function QuotaCardIcon(');
    expect(iconSource).toContain('const [failed, setFailed] = useState(false)');
    expect(cardSource).toContain('<QuotaCardIcon key={iconSrc} src={iconSrc} label={typeLabel} />');
    // Keep the child present for A -> absent -> A, not just A -> B -> A.
    expect(cardSource).not.toMatch(/iconSrc\s*&&\s*<QuotaCardIcon/);
    expect(cardSource).not.toMatch(/useState[^;]*(?:failed|Failed)/);
    expect(cardSource).not.toContain('failedIconSrc');
  });

  test('same-source failure is terminal for that icon instance, without an effect or retry', () => {
    expect(iconSource).toContain('return src && !failed ?');
    expect(iconSource).toContain('onError={() => setFailed(true)}');
    expect(iconSource).toContain('<span className={styles.iconFallback}>');
    expect(iconSource).not.toMatch(/setFailed\(false\)|useEffect|setTimeout|setInterval/);
  });

  test('does not key or move entrance and credential state into the icon lifetime', () => {
    expect(cardSource).toContain('const [mountEntranceDelayMs] = useState<number | null>(');
    expect(cardSource).toContain('const claudeReset = useClaudeResetGrants(');
    expect(cardSource).not.toMatch(/<article[^>]*\bkey=/s);
    const pageSource = readFileSync(
      join(import.meta.dir, '../src/features/quota/QuotaPage.tsx'),
      'utf8'
    );
    expect(pageSource).toContain('key={`${entry.type}:${getQuotaCacheKey(entry.file)}`}');
  });
});

describe('aggregate Plugin tab localization', () => {
  const labels = {
    en: 'Plugin',
    'zh-CN': '插件',
    'zh-TW': '插件',
    ru: 'Плагин',
    vi: 'Plugin',
    ko: '플러그인',
    tr: 'Eklenti',
  };
  for (const [locale, label] of Object.entries(labels)) {
    test(`defines the aggregate label in ${locale}`, () => {
      const messages = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
      expect(messages.auth_files.filter_plugin).toBe(label);
    });
  }
});
