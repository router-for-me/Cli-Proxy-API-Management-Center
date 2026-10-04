import { expect, test } from 'bun:test';
import en from '../src/i18n/locales/en.json';
import ru from '../src/i18n/locales/ru.json';
import vi from '../src/i18n/locales/vi.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';

for (const [locale, resource] of Object.entries({ en, ru, vi, 'zh-CN': zhCN, 'zh-TW': zhTW })) {
  test(`shared name controls include localized server and browser hints in ${locale}`, () => {
    const labels = resource.config_management.visual.api_keys;
    for (const key of ['name_hint', 'name_local_hint', 'name_label', 'name_placeholder', 'name_save_error', 'name_retry'] as const) {
      expect(labels[key].trim().length).toBeGreaterThan(0);
    }
  });
}
