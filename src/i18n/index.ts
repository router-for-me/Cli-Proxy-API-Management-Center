/**
 * i18next 国际化配置
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zhCN from './locales/zh-CN.json';
import en from './locales/en.json';
import { STORAGE_KEY_LANGUAGE } from '@/utils/constants';

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en }
  },
  lng: localStorage.getItem(STORAGE_KEY_LANGUAGE) || 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false // React 已经转义
  },
  react: {
    useSuspense: false
  }
});

export default i18n;
