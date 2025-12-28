/**
 * i18next 国际化配置
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import en from './locales/en.json';
import { STORAGE_KEY_LANGUAGE } from '@/utils/constants';

type SupportedLanguage = 'zh-CN' | 'en';

function normalizeLanguage(value: unknown): SupportedLanguage | null {
  if (value === 'zh-CN' || value === 'en') {
    return value;
  }
  return null;
}

function resolveBrowserLanguage(): SupportedLanguage {
  const browserLanguage = typeof navigator !== 'undefined' ? navigator.language : '';
  return browserLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

function resolveInitialLanguage(): SupportedLanguage {
  if (typeof window === 'undefined') {
    return 'en';
  }

  const raw = window.localStorage.getItem(STORAGE_KEY_LANGUAGE);

  const direct = normalizeLanguage(raw);
  if (direct) {
    return direct;
  }

  // Backward-compat: older builds stored Zustand persist JSON under the same key.
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { state?: { language?: unknown } };
      const nested = normalizeLanguage(parsed?.state?.language);
      if (nested) {
        window.localStorage.setItem(STORAGE_KEY_LANGUAGE, nested);
        return nested;
      }
    } catch {
      // ignore
    }
  }

  return resolveBrowserLanguage();
}

export const initialLanguage = resolveInitialLanguage();

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en }
  },
  lng: initialLanguage,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false // React 已经转义
  },
  react: {
    useSuspense: false
  }
});

export default i18n;
