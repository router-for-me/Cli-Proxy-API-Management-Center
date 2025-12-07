/**
 * 主题状态管理
 * 从原项目 src/modules/theme.js 迁移
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Theme } from '@/types';
import { STORAGE_KEY_THEME } from '@/utils/constants';

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  initializeTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',

      setTheme: (theme) => {
        // 应用主题到 DOM
        if (theme === 'dark') {
          document.documentElement.setAttribute('data-theme', 'dark');
        } else {
          document.documentElement.removeAttribute('data-theme');
        }

        set({ theme });
      },

      toggleTheme: () => {
        const { theme, setTheme } = get();
        const newTheme: Theme = theme === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
      },

      initializeTheme: () => {
        const { theme, setTheme } = get();

        // 检查系统偏好
        if (
          !localStorage.getItem(STORAGE_KEY_THEME) &&
          window.matchMedia &&
          window.matchMedia('(prefers-color-scheme: dark)').matches
        ) {
          setTheme('dark');
          return;
        }

        // 应用已保存的主题
        setTheme(theme);

        // 监听系统主题变化（仅在用户未手动设置时）
        if (window.matchMedia) {
          window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem(STORAGE_KEY_THEME)) {
              setTheme(e.matches ? 'dark' : 'light');
            }
          });
        }
      }
    }),
    {
      name: STORAGE_KEY_THEME
    }
  )
);
