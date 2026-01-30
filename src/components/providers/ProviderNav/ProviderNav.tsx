import { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useThemeStore } from '@/stores';
import iconGemini from '@/assets/icons/gemini.svg';
import iconOpenaiLight from '@/assets/icons/openai-light.svg';
import iconOpenaiDark from '@/assets/icons/openai-dark.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconVertex from '@/assets/icons/vertex.svg';
import iconAmp from '@/assets/icons/amp.svg';
import styles from './ProviderNav.module.scss';

export type ProviderId = 'gemini' | 'codex' | 'claude' | 'vertex' | 'ampcode' | 'openai';

interface ProviderNavItem {
  id: ProviderId;
  label: string;
  getIcon: (theme: string) => string;
}

const PROVIDERS: ProviderNavItem[] = [
  { id: 'gemini', label: 'Gemini', getIcon: () => iconGemini },
  { id: 'codex', label: 'Codex', getIcon: (theme) => (theme === 'dark' ? iconOpenaiDark : iconOpenaiLight) },
  { id: 'claude', label: 'Claude', getIcon: () => iconClaude },
  { id: 'vertex', label: 'Vertex', getIcon: () => iconVertex },
  { id: 'ampcode', label: 'Ampcode', getIcon: () => iconAmp },
  { id: 'openai', label: 'OpenAI', getIcon: (theme) => (theme === 'dark' ? iconOpenaiDark : iconOpenaiLight) },
];

export function ProviderNav() {
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const [activeProvider, setActiveProvider] = useState<ProviderId | null>(null);
  const [mounted, setMounted] = useState(false);
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const getScrollContainer = useCallback(() => {
    if (scrollContainerRef.current) return scrollContainerRef.current;
    const container = document.querySelector('.content') as HTMLElement | null;
    scrollContainerRef.current = container;
    return container;
  }, []);

  const handleScroll = useCallback(() => {
    const container = getScrollContainer();
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const triggerPoint = containerRect.top + containerRect.height * 0.3;

    let currentActive: ProviderId | null = null;

    for (const provider of PROVIDERS) {
      const element = document.getElementById(`provider-${provider.id}`);
      if (element) {
        const rect = element.getBoundingClientRect();
        const elementTop = rect.top;
        const elementBottom = rect.bottom;

        if (triggerPoint >= elementTop && triggerPoint < elementBottom) {
          currentActive = provider.id;
          break;
        }
      }
    }

    setActiveProvider(currentActive);
  }, [getScrollContainer]);

  useEffect(() => {
    const container = getScrollContainer();
    if (!container) return;

    handleScroll();
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll, getScrollContainer]);

  const scrollToProvider = (providerId: ProviderId) => {
    const container = getScrollContainer();
    const element = document.getElementById(`provider-${providerId}`);
    if (!element || !container) return;

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const headerOffset = 24;
    const scrollTop = container.scrollTop + (elementRect.top - containerRect.top) - headerOffset;

    container.scrollTo({
      top: scrollTop,
      behavior: 'smooth',
    });
  };

  const navContent = (
    <div className={styles.navContainer}>
      <div className={styles.navList}>
        {PROVIDERS.map((provider) => {
          const isActive = activeProvider === provider.id;
          return (
            <button
              key={provider.id}
              className={`${styles.navItem} ${isActive ? styles.active : ''}`}
              onClick={() => scrollToProvider(provider.id)}
              title={provider.label}
              type="button"
            >
              <img
                src={provider.getIcon(resolvedTheme)}
                alt={provider.label}
                className={styles.icon}
              />
            </button>
          );
        })}
      </div>
    </div>
  );

  if (!mounted) return null;

  return createPortal(navContent, document.body);
}
