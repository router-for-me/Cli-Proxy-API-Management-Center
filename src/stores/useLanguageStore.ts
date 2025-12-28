/**
 * 语言状态管理
 * 从原项目 src/modules/language.js 迁移
 */

import { create } from 'zustand';
import type { Language } from '@/types';
import { STORAGE_KEY_LANGUAGE } from '@/utils/constants';
import i18n, { initialLanguage, validateLanguage } from '@/i18n';

interface LanguageState {
  language: Language;
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
}

function normalizeLanguage(value: unknown): Language {
  return validateLanguage(value) ?? 'en';
}

export const useLanguageStore = create<LanguageState>()((set, get) => ({
  language: normalizeLanguage(initialLanguage ?? i18n.language),

  setLanguage: (language) => {
    try {
      localStorage.setItem(STORAGE_KEY_LANGUAGE, language);
    } catch {
      // ignore
    }

    i18n.changeLanguage(language);
    set({ language });
  },

  toggleLanguage: () => {
    const { language, setLanguage } = get();
    const newLanguage: Language = language === 'zh-CN' ? 'en' : 'zh-CN';
    setLanguage(newLanguage);
  }
}));
