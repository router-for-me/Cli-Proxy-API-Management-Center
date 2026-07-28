import { describe, expect, test } from 'bun:test';
import en from '../src/i18n/locales/en.json';
import ru from '../src/i18n/locales/ru.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';

/**
 * The quota board calls t() with defaultValue fallbacks, so a missing key never
 * throws — it silently renders English inside a Chinese UI. These assertions are
 * the only thing that catches that.
 */

type Block = Record<string, unknown>;

const LOCALES: Record<string, Block> = {
  en: (en as Block).quota_management as Block,
  ru: (ru as Block).quota_management as Block,
  'zh-CN': (zhCN as Block).quota_management as Block,
  'zh-TW': (zhTW as Block).quota_management as Block,
};

/** Keys used with a plain t() call — must be present verbatim. */
const SIMPLE_KEYS = [
  'title',
  'description',
  'refresh_all_credentials',
  'lowest_remaining',
  'not_loaded',
  'next_reset',
  'filter_all',
  'empty_title',
  'density_label',
];

/**
 * Keys used with { count }. i18next resolves these per-language via Intl plural
 * rules, so the required suffixes differ: Chinese has one form and takes the
 * bare key, English needs one/other, Russian needs one/few/many.
 */
const COUNT_KEYS = ['at_risk', 'credentials', 'density_option'];

/**
 * Of those, the ones whose string must actually print the number. `credentials`
 * is deliberately excluded: the tile renders the count itself in a <b>, and the
 * translation supplies only the noun. A string with {{count}} there renders
 * "4 4 个凭证" — which English hides, because its plural form is a bare noun.
 */
const INTERPOLATING_KEYS = ['at_risk', 'density_option'];

const REQUIRED_PLURAL_SUFFIXES: Record<string, string[]> = {
  en: ['_one', '_other'],
  ru: ['_one', '_few', '_many'],
  'zh-CN': [''],
  'zh-TW': [''],
};

describe('quota_management i18n coverage', () => {
  for (const [locale, block] of Object.entries(LOCALES)) {
    test(`${locale}: has every simple key`, () => {
      const missing = SIMPLE_KEYS.filter((key) => typeof block[key] !== 'string');
      expect(missing).toEqual([]);
    });

    test(`${locale}: has every plural form the language requires`, () => {
      const missing: string[] = [];
      for (const key of COUNT_KEYS) {
        for (const suffix of REQUIRED_PLURAL_SUFFIXES[locale]) {
          if (typeof block[`${key}${suffix}`] !== 'string') missing.push(`${key}${suffix}`);
        }
      }
      expect(missing).toEqual([]);
    });

    test(`${locale}: interpolates {{count}} where the string owns the number`, () => {
      const missing: string[] = [];
      for (const [key, value] of Object.entries(block)) {
        if (!INTERPOLATING_KEYS.some((base) => key === base || key.startsWith(`${base}_`))) continue;
        if (typeof value === 'string' && !value.includes('{{count}}')) missing.push(key);
      }
      expect(missing).toEqual([]);
    });

    /** Regression: the tile prints the count itself, so the string must not. */
    test(`${locale}: 'credentials' does not also interpolate the count`, () => {
      const doubled = Object.entries(block)
        .filter(([key]) => key === 'credentials' || key.startsWith('credentials_'))
        .filter(([, value]) => typeof value === 'string' && value.includes('{{count}}'))
        .map(([key]) => key);
      expect(doubled).toEqual([]);
    });
  }

  test('every locale defines the same quota_management keys', () => {
    // Plural suffixes legitimately differ per language, so compare base names.
    const base = (key: string) => key.replace(/_(one|two|few|many|other|zero)$/, '');
    const names = Object.entries(LOCALES).map(
      ([locale, block]) => [locale, new Set(Object.keys(block).map(base))] as const
    );
    const [, reference] = names[0];
    for (const [locale, keys] of names.slice(1)) {
      expect({ locale, missing: [...reference].filter((k) => !keys.has(k)) }).toEqual({
        locale,
        missing: [],
      });
    }
  });
});
