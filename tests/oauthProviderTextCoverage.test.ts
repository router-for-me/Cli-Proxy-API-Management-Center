import { describe, expect, test } from 'bun:test';
import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';

/**
 * The OAuth page resolves every label as
 *   auth_login.<getProviderI18nPrefix(providerId)>_<suffix>
 * so a key written under the wrong prefix renders as raw text
 * ("auth_login.minimax_cn_open_link") instead of the label. These checks fail
 * loudly on that class of bug.
 */

/** Mirrors getProviderI18nPrefix in src/pages/OAuthPage.tsx. */
const getProviderI18nPrefix = (provider: string): string => provider.replace('-', '_');

const LOCALES = { en, ru, 'zh-CN': zhCN, 'zh-TW': zhTW } as const;

/** Suffixes the OAuth page resolves through getProviderText(). */
const SUFFIXES = [
  'copy_link',
  'oauth_button',
  'oauth_hint',
  'oauth_start_error',
  'oauth_status_error',
  'oauth_status_success',
  'oauth_status_waiting',
  'oauth_url_label',
  'open_link',
] as const;

/**
 * Provider ids whose card this change adds or touches. kimi-ai is excluded
 * because its upstream keys use a different scheme, and that predates this work.
 */
const PROVIDER_IDS = ['meta', 'xai', 'minimax', 'minimax-cn'] as const;

type AuthLogin = Record<string, string>;

const authLogin = (locale: keyof typeof LOCALES): AuthLogin =>
  (LOCALES[locale] as { auth_login: AuthLogin }).auth_login;

describe('OAuth provider label coverage', () => {
  test('the provider prefix normalizes a hyphen to an underscore', () => {
    // getProviderI18nPrefix replaces only the first hyphen, so the reachable
    // prefix for the "minimax-cn" card is "minimax_cn".
    expect(getProviderI18nPrefix('minimax')).toBe('minimax');
    expect(getProviderI18nPrefix('minimax-cn')).toBe('minimax_cn');
  });

  for (const [locale] of Object.entries(LOCALES)) {
    test(`${locale}: every provider has a label for every suffix`, () => {
      const messages = authLogin(locale as keyof typeof LOCALES);
      const missing: string[] = [];
      for (const provider of PROVIDER_IDS) {
        const prefix = getProviderI18nPrefix(provider);
        for (const suffix of SUFFIXES) {
          const key = `${prefix}_${suffix}`;
          const value = messages[key];
          if (typeof value !== 'string' || value.trim() === '') {
            missing.push(key);
          }
        }
      }
      expect(missing).toEqual([]);
    });
  }

  for (const [locale] of Object.entries(LOCALES)) {
    test(`${locale}: no label leaks its own i18n key`, () => {
      const messages = authLogin(locale as keyof typeof LOCALES);
      const leaking: string[] = [];
      for (const [key, value] of Object.entries(messages)) {
        if (typeof value !== 'string') continue;
        if (value.includes('auth_login.')) leaking.push(`${key} = ${value}`);
      }
      expect(leaking).toEqual([]);
    });
  }

  for (const [locale] of Object.entries(LOCALES)) {
    test(`${locale}: copy and open link are distinct labels`, () => {
      const messages = authLogin(locale as keyof typeof LOCALES);
      for (const provider of PROVIDER_IDS) {
        const prefix = getProviderI18nPrefix(provider);
        const copy = messages[`${prefix}_copy_link`];
        const open = messages[`${prefix}_open_link`];
        if (typeof copy !== 'string' || typeof open !== 'string') continue;
        expect(`${prefix}:${copy}`).not.toBe(`${prefix}:${open}`);
      }
    });
  }

  test('every minimax key lives under a prefix the page can look up', () => {
    const reachable = new Set(PROVIDER_IDS.map(getProviderI18nPrefix));
    for (const locale of Object.keys(LOCALES) as (keyof typeof LOCALES)[]) {
      const messages = authLogin(locale);
      const unreachable: string[] = [];
      for (const key of Object.keys(messages)) {
        if (!key.startsWith('minimax')) continue;
        const prefix = key.split('_')[0];
        if (!reachable.has(prefix)) unreachable.push(key);
      }
      expect({ locale, unreachable }).toEqual({ locale, unreachable: [] });
    }
  });

  test('the two MiniMax regions are described as separate logins', () => {
    for (const locale of Object.keys(LOCALES) as (keyof typeof LOCALES)[]) {
      const messages = authLogin(locale);
      const globalTitle = messages.minimax_oauth_title ?? '';
      const cnTitle = messages.minimax_cn_oauth_title ?? '';
      expect(globalTitle).not.toBe(cnTitle);
      expect(globalTitle).toContain('minimax.io');
      expect(cnTitle).toContain('minimaxi.com');
    }
  });
});
