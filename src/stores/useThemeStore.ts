/**
 * 主题状态管理
 * 从原项目 src/modules/theme.js 迁移
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Theme } from '@/types';
import { STORAGE_KEY_THEME } from '@/utils/constants';

// 保持底层状态只有 light 和 dark，解决组件报错
type ResolvedTheme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
  initializeTheme: () => () => void;
}

const getSystemTheme = (): ResolvedTheme => {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
};

// 核心修改点：在这里处理纯白主题的 CSS 挂载
const applyTheme = (theme: Theme, resolved: ResolvedTheme) => {
  if (theme === 'light-pure') {
    document.documentElement.setAttribute('data-theme', 'light-pure');
  } else if (resolved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'auto',
      resolvedTheme: 'light',

      setTheme: (theme) => {
        // 如果是纯白主题，它的底层 resolved 状态依然算作 'light'
        const resolved: ResolvedTheme = theme === 'auto' ? getSystemTheme() : (theme === 'dark' ? 'dark' : 'light');
        applyTheme(theme, resolved);
        set({ theme, resolvedTheme: resolved });
      },

      cycleTheme: () => {
        const { theme, setTheme } = get();
        // 在这里加入纯白主题的循环顺序
        const order: Theme[] = ['light', 'light-pure', 'dark', 'auto'];
        const currentIndex = order.indexOf(theme);
        const nextTheme = order[(currentIndex + 1) % order.length];
        setTheme(nextTheme);
      },

      initializeTheme: () => {
        const { theme, setTheme } = get();

        // 应用已保存的主题
        setTheme(theme);

        // 监听系统主题变化（仅在 auto 模式下生效）
        if (!window.matchMedia) {
          return () => {};
        }

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const listener = () => {
          const { theme: currentTheme } = get();
          if (currentTheme === 'auto') {
            const resolved = getSystemTheme();
            applyTheme(currentTheme, resolved);
            set({ resolvedTheme: resolved });
          }
        };

        mediaQuery.addEventListener('change', listener);

        return () => mediaQuery.removeEventListener('change', listener);
      },
    }),
    {
      name: STORAGE_KEY_THEME,
    }
  )
);
