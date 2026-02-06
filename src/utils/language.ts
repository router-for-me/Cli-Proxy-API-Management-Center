import type { Language } from '@/types';
import { STORAGE_KEY_LANGUAGE } from '@/utils/constants';

const parseStoredLanguage = (value: string): Language | null => {
  try {
    const parsed = JSON.parse(value);
    const candidate = parsed?.state?.language ?? parsed?.language ?? parsed;
    if (candidate === 'zh-CN' || candidate === 'en' || candidate === 'ru') {
      return candidate;
    }
  } catch {
    if (value === 'zh-CN' || value === 'en' || value === 'ru') {
      return value;
    }
  }
  return null;
};

const getStoredLanguage = (): Language | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY_LANGUAGE);
    if (!stored) {
      return null;
    }
    return parseStoredLanguage(stored);
  } catch {
    return null;
  }
};

const getBrowserLanguage = (): Language => {
  if (typeof navigator === 'undefined') {
    return 'zh-CN';
  }
  const raw = navigator.languages?.[0] || navigator.language || 'zh-CN';
  const lower = raw.toLowerCase();
  if (lower.startsWith('zh')) return 'zh-CN';
  if (lower.startsWith('ru')) return 'ru';
  return 'en';
};

export const getInitialLanguage = (): Language => getStoredLanguage() ?? getBrowserLanguage();
