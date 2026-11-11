import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { apiClient } from '@/services/api/client';
import { pluginStoreApi } from '@/services/api/plugins';
import { getStoreEntryDisplay } from '@/features/plugins/pluginStoreMetadata';
import type { PluginStoreEntry } from '@/types';

const spies: Array<{ mockRestore(): void }> = [];
const mockGet = (value: unknown) => {
  const spy = spyOn(apiClient, 'get').mockResolvedValue(value as never);
  spies.push(spy);
  return spy;
};
afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

const readSource = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const storeEntry = (overrides: Partial<PluginStoreEntry>): PluginStoreEntry => ({
  storeId: 'official/example',
  sourceId: 'official',
  sourceName: 'official',
  sourceUrl: '',
  id: 'example',
  name: 'Example',
  description: 'An English description.',
  author: 'someone',
  version: '1.0.0',
  repository: 'router-for-me/example-plugin',
  installType: 'github-release',
  authRequired: false,
  authConfigured: false,
  platforms: [],
  logo: '',
  homepage: 'https://example.test',
  license: 'MIT',
  tags: ['Interceptor'],
  installed: false,
  installedVersion: '',
  path: '',
  configured: false,
  registered: false,
  enabled: false,
  effectiveEnabled: false,
  updateAvailable: false,
  ...overrides,
});

describe('plugin store entry normalization', () => {
  test('keeps backend locales on normalized entries', async () => {
    mockGet({
      plugins_enabled: true,
      plugins_dir: 'plugins',
      plugins: [
        {
          id: 'example',
          name: 'Example',
          description: 'An English description.',
          locales: {
            'zh-CN': { description: '中文描述。 ' },
            'zh-TW': {},
          },
        },
      ],
    });
    const [entry] = (await pluginStoreApi.list()).plugins;
    // 后端已把键归一化成 BCP-47，空块由这里丢弃。
    expect(entry.locales).toEqual({ 'zh-CN': { description: '中文描述。' } });
  });

  test('drops empty and blank-key locale blocks like the backend does', async () => {
    mockGet({
      plugins_enabled: true,
      plugins_dir: 'plugins',
      plugins: [
        {
          id: 'example',
          locales: {
            '': { description: 'lost' },
            fr: {},
            de: { description: '   ' },
            en: { name: '', homepage: 'https://example.test/en' },
          },
        },
      ],
    });
    const [entry] = (await pluginStoreApi.list()).plugins;
    expect(entry.locales).toEqual({ en: { homepage: 'https://example.test/en' } });
  });

  test('omits locales when the response has none', async () => {
    mockGet({
      plugins_enabled: true,
      plugins_dir: 'plugins',
      plugins: [{ id: 'example', description: 'plain' }],
    });
    const [entry] = (await pluginStoreApi.list()).plugins;
    expect(entry.locales).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(entry, 'locales')).toBe(false);
  });
});

describe('store entry display metadata', () => {
  const entry = storeEntry({
    locales: {
      'zh-CN': { description: '中文描述。' },
      'zh-Hans': { description: '简体描述。', author: '作者' },
    },
  });

  test('simplified Chinese walks zh-CN, zh-Hans then bare zh', () => {
    // zh-CN 块只缺 author，逐字段回退到根值，不跨块借用 zh-Hans 的 author。
    expect(getStoreEntryDisplay(entry, 'zh-CN')).toEqual({
      name: 'Example',
      description: '中文描述。',
      author: 'someone',
      homepage: 'https://example.test',
      license: 'MIT',
      tags: ['Interceptor'],
    });
    expect(
      getStoreEntryDisplay(storeEntry({ locales: { zh: { description: '裸 zh。' } } }), 'zh-CN')
        .description
    ).toBe('裸 zh。');
  });

  test('traditional Chinese never receives Simplified locales', () => {
    expect(getStoreEntryDisplay(entry, 'zh-TW').description).toBe('An English description.');
    expect(
      getStoreEntryDisplay(storeEntry({ locales: { zh: { description: '裸 zh。' } } }), 'zh-TW')
        .description
    ).toBe('An English description.');
  });

  test('tags only switch when the matched locale carries its own list', () => {
    expect(getStoreEntryDisplay(entry, 'zh-CN').tags).toEqual(['Interceptor']);
    expect(
      getStoreEntryDisplay(storeEntry({ locales: { 'zh-CN': { tags: [' 拦截器 ', ''] } } }), 'zh-CN')
        .tags
    ).toEqual(['拦截器']);
  });

  test('tolerates non-canonical locale keys from other registries', () => {
    expect(
      getStoreEntryDisplay(storeEntry({ locales: { zh_cn: { description: '中文。' } } }), 'zh-CN')
        .description
    ).toBe('中文。');
  });

  test('localized names stay searchable next to their root values', () => {
    const page = readSource('src/features/plugins/PluginStorePage.tsx');
    const haystack = page.match(/const haystack = \[([\s\S]*?)\];/)?.[1] ?? '';
    for (const field of ['plugin.name', 'display.name', 'plugin.description', 'display.tags']) {
      expect(haystack).toContain(field);
    }
  });

  test('unknown languages and missing locales keep the root fields', () => {
    const plain = storeEntry({});
    expect(getStoreEntryDisplay(plain, 'en')).toEqual({
      name: 'Example',
      description: 'An English description.',
      author: 'someone',
      homepage: 'https://example.test',
      license: 'MIT',
      tags: ['Interceptor'],
    });
    expect(getStoreEntryDisplay(entry, 'xx')).toEqual(
      getStoreEntryDisplay(storeEntry({}), 'en')
    );
  });
});

// Source contract only: there is no browser DOM harness, so this pins that every
// store surface reads the localized display fields instead of the root ones.
describe('plugin store locale wiring', () => {
  test('cards, search and the install gate resolve metadata through one selector', () => {
    const page = readSource('src/features/plugins/PluginStorePage.tsx');
    const gate = readSource('src/features/plugins/components/PluginInstallGateModal.tsx');

    for (const source of [page, gate]) {
      expect(source).toContain('getStoreEntryDisplay');
      expect(source).not.toMatch(/entry\.description/);
      expect(source).not.toMatch(/entry\.author/);
      expect(source).not.toMatch(/entry\.license/);
      expect(source).not.toMatch(/entry\.tags/);
      expect(source).not.toMatch(/entry\.name/);
    }
  });
});
