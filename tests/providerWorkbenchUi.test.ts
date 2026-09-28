import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { providersApi } from '../src/services/api/providers';

describe('provider workbench editing surface', () => {
  test('keeps normal credential editing without a raw group JSON editor', () => {
    const source = readFileSync(
      new URL('../src/features/providers/ProvidersWorkbenchPage.tsx', import.meta.url),
      'utf8'
    );
    expect(source).not.toContain('ProviderGroupsEditor');
    expect(source).toContain('<ProviderSheet');
    expect(providersApi).not.toHaveProperty('replaceGroups');
    expect(providersApi.updateCodexConfig).toBeFunction();
  });

  test('locales retain the group-safety hint without linking to the removed editor', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru']) {
      const messages = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      );
      expect(Object.keys(messages.providersPage.groups)).toEqual(['rowHint']);
    }
  });
});
