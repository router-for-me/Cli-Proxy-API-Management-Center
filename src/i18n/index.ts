/**
 * i18next 国际化配置
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import en from './locales/en.json';
import { STORAGE_KEY_LANGUAGE } from '@/utils/constants';
import type { Language } from '@/types';

export function validateLanguage(value: unknown): Language | null {
  return value === 'zh-CN' || value === 'en' ? value : null;
}

function resolveBrowserLanguage(): Language {
  if (typeof navigator === 'undefined') {
    return 'en';
  }

  const candidates = Array.isArray(navigator.languages) && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language];

  for (const candidate of candidates) {
    const normalized = (candidate || '').toLowerCase();
    if (normalized.startsWith('zh')) {
      return 'zh-CN';
    }
    if (normalized.startsWith('en')) {
      return 'en';
    }
  }

  return 'en';
}

function resolveInitialLanguage(): Language {
  if (typeof window === 'undefined') {
    return 'en';
  }

  const raw = window.localStorage.getItem(STORAGE_KEY_LANGUAGE);

  const direct = validateLanguage(raw);
  if (direct) {
    return direct;
  }

  // Backward-compat: older builds stored Zustand persist JSON under the same key.
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { state?: { language?: unknown } };
      const nested = validateLanguage(parsed?.state?.language);
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
