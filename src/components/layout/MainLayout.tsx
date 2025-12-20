import { ReactNode, SVGProps, useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Tooltip } from '@/components/ui/Tooltip';
import { cn } from '@/lib/utils';
import {
  IconBot,
  IconChartLine,
  IconCrocodile,
  IconFileText,
  IconInfo,
  IconKey,
  IconScrollText,
  IconSettings,
  IconShield
} from '@/components/ui/icons';

import { useAuthStore, useConfigStore, useLanguageStore, useThemeStore, useNotificationStore } from '@/stores';

import { useSound } from '@/hooks/useSound';

const sidebarIcons: Record<string, ReactNode> = {
  apiKeys: <IconKey size={22} />,
  aiProviders: <IconBot size={24} />,
  authFiles: <IconFileText size={22} />,
  oauth: <IconShield size={22} />,
  usage: <IconChartLine size={22} />,
  config: <IconSettings size={22} />,
  logs: <IconScrollText size={22} />,
  system: <IconInfo size={22} />
};

const headerIconProps: SVGProps<SVGSVGElement> = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
};

const headerIcons = {
  refresh: (
    <svg {...headerIconProps}>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  ),
  update: (
    <svg {...headerIconProps}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  ),
  menu: (
    <svg {...headerIconProps}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  ),
  chevronLeft: (
    <svg {...headerIconProps}>
      <path d="m14 18-6-6 6-6" />
    </svg>
  ),
  chevronRight: (
    <svg {...headerIconProps}>
      <path d="m10 6 6 6-6 6" />
    </svg>
  ),
  language: (
    <svg {...headerIconProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  sun: (
    <svg {...headerIconProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  ),
  moon: (
    <svg {...headerIconProps}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
    </svg>
  ),
  logout: (
    <svg {...headerIconProps}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
};

export function MainLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const apiBase = useAuthStore((state) => state.apiBase);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const logout = useAuthStore((state) => state.logout);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);

  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const toggleLanguage = useLanguageStore((state) => state.toggleLanguage);
  
  const showNotification = useNotificationStore((state) => state.showNotification);
  
  const sound = useSound();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [displayedTitle, setDisplayedTitle] = useState('CPAMC');
  const [isAnimating, setIsAnimating] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [navStyle, setNavStyle] = useState<'sidebar' | 'top'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('cli-proxy-nav-style') as 'sidebar' | 'top') || 'sidebar';
    }
    return 'sidebar';
  });

  useEffect(() => {
    localStorage.setItem('cli-proxy-nav-style', navStyle);
  }, [navStyle]);

  // Title typewriter animation
  const fullTitle = t('title.main');
  const abbrTitle = t('title.abbr');
  
  useEffect(() => {
    if (!hasInteracted) return;
    
    const targetTitle = titleExpanded ? fullTitle : abbrTitle;
    
    let cancelled = false;
    const animate = async () => {
      setIsAnimating(true);
      
      if (titleExpanded) {
        // Expanding: type out full title
        for (let i = abbrTitle.length; i <= targetTitle.length; i++) {
          if (cancelled) break;
          setDisplayedTitle(targetTitle.slice(0, i));
          await new Promise(r => setTimeout(r, 25));
        }
      } else {
        // Collapsing: delete back to abbr
        for (let i = fullTitle.length; i >= abbrTitle.length; i--) {
          if (cancelled) break;
          const text = i <= abbrTitle.length ? abbrTitle : fullTitle.slice(0, i);
          setDisplayedTitle(text);
          await new Promise(r => setTimeout(r, 15));
        }
      }
      
      if (!cancelled) {
        setDisplayedTitle(targetTitle);
        setIsAnimating(false);
      }
    };
    
    animate();
    
    return () => { cancelled = true; };
  }, [titleExpanded, hasInteracted, fullTitle, abbrTitle]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchConfig().catch(() => {});
    }
  }, [fetchConfig, isAuthenticated]);

  const navItems = [
    { path: '/api-keys', label: t('nav.api_keys'), icon: sidebarIcons.apiKeys },
    { path: '/ai-providers', label: t('nav.ai_providers'), icon: sidebarIcons.aiProviders },
    { path: '/auth-files', label: t('nav.auth_files'), icon: sidebarIcons.authFiles },
    { path: '/oauth', label: t('nav.oauth', { defaultValue: 'OAuth' }), icon: sidebarIcons.oauth },
    { path: '/usage', label: t('nav.usage_stats'), icon: sidebarIcons.usage },
    ...(config?.loggingToFile ? [{ path: '/logs', label: t('nav.logs'), icon: sidebarIcons.logs }] : [])
  ];
  
  const configNavItem = { path: '/config', label: t('nav.settings'), icon: sidebarIcons.config };
  const topNavItems = [...navItems, configNavItem];

  // Persist current path to localStorage for restore on refresh
  useEffect(() => {
    if (isAuthenticated && location.pathname !== '/welcome' && location.pathname !== '/') {
      localStorage.setItem('cli-proxy-last-path', location.pathname);
    }
  }, [isAuthenticated, location.pathname]);

  // Tab key navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isAuthenticated) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      sound.click();
      const currentIndex = topNavItems.findIndex(item => item.path === location.pathname);
      const nextIndex = e.shiftKey
        ? (currentIndex - 1 + topNavItems.length) % topNavItems.length
        : (currentIndex + 1) % topNavItems.length;
      navigate(topNavItems[nextIndex].path);
    }
  }, [isAuthenticated, location.pathname, topNavItems, navigate, sound]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const headerActions = (
    <div className="flex items-center gap-3 text-xs">
      <div className="flex h-7 items-center border border-border bg-card divide-x divide-border">
      <Tooltip content={t('language.switch')}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { sound.toggleSound(); toggleLanguage(); }}
          className="w-9 h-full rounded-none text-muted-foreground hover:text-foreground"
        >
          {headerIcons.language}
        </Button>
      </Tooltip>
      <Tooltip content={theme === 'light' ? t('theme.switch_to_dark') : t('theme.switch_to_light')}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { sound.toggleSound(); toggleTheme(); }}
          className="w-9 h-full rounded-none text-muted-foreground hover:text-foreground"
        >
          {theme === 'light' ? headerIcons.sun : headerIcons.moon}
        </Button>
      </Tooltip>
      <Tooltip content={sound.muted ? t('sound.unmute') : t('sound.mute')}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { if (sound.muted) { sound.toggle(); sound.toggleSound(); } else { sound.toggleSound(); sound.toggle(); } }}
          className="w-9 h-full rounded-none text-muted-foreground hover:text-foreground"
        >
          {sound.muted ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <line x1="23" y1="9" x2="17" y2="15" />
              <line x1="17" y1="9" x2="23" y2="15" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          )}
        </Button>
      </Tooltip>
      <Tooltip content={t('header.logout')}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { sound.click(); logout(); }}
          className="w-9 h-full rounded-none text-muted-foreground hover:text-foreground"
        >
          {headerIcons.logout}
        </Button>
      </Tooltip>
      </div>
    </div>
  );

  const footerContent = (
    <footer className="bg-primary dark:bg-primary/80 text-primary-foreground px-3 py-1 flex justify-between items-center text-[10px] shrink-0">
      <span className="inline-flex items-center gap-3">
        <Tooltip content={apiBase || ''}>
          <span className="inline-flex items-center gap-1.5">
            <svg width="6" height="6" viewBox="0 0 6 6" className="shrink-0">
              <circle cx="3" cy="3" r="3" className={cn(connectionStatus === 'connected' ? "fill-emerald-400" : "fill-amber-400 animate-pulse")} />
            </svg>
            <span>{connectionStatus === 'connected' ? 'Connected' : 'Connecting'}</span>
          </span>
        </Tooltip>
        <span
          onClick={() => setNavStyle(navStyle === 'sidebar' ? 'top' : 'sidebar')}
          className="hover:opacity-80 cursor-pointer"
        >
          Nav: {navStyle === 'sidebar' ? 'Side' : 'Top'}
        </span>
      </span>
      <span className="inline-flex items-center gap-3">
        <span>UI: {__APP_VERSION__ || '?'}</span>
        <span>API: {serverVersion || '?'}</span>
        <Tooltip content={t('nav.system_info')}>
          <NavLink to="/system" className="hover:opacity-80 cursor-pointer">
            <IconInfo size={14} />
          </NavLink>
        </Tooltip>
      </span>
    </footer>
  );

  // Top navigation layout
  if (navStyle === 'top') {
    return (
      <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
        <div className="max-w-5xl mx-auto w-full flex-1 flex flex-col p-4 md:p-8 pb-0 min-h-0">
          <header className="border-b border-border pb-4 shrink-0">
            <div className="flex items-center justify-between">
              <Tooltip content={titleExpanded ? t('title.abbr') : t('title.main')}>
                <h1 
                  className={cn(
                    "text-xl font-bold tracking-tight text-primary flex items-center gap-2 select-none",
                    isAnimating ? "cursor-default" : "cursor-pointer"
                  )}
                  onClick={() => { if (!isAnimating) { sound.click(); setHasInteracted(true); setTitleExpanded(!titleExpanded); } }}
                >
                  <IconCrocodile size={36} />
                  <span 
                    className="text-2xl tracking-tight mt-0.5 whitespace-nowrap"
                    style={{ fontFamily: "'Kranky', cursive" }}
                  >
                    {displayedTitle}
                  </span>
                </h1>
              </Tooltip>
              {headerActions}
            </div>
          </header>

          <div className="flex items-center justify-between mt-8">
            <nav className="flex items-center gap-0.5 text-sm border border-border bg-card p-1 shrink-0 overflow-x-auto">
              {[...navItems, configNavItem].map((item) => (
                <NavLink
                  key={item.path}
                  to={isAuthenticated ? item.path : '#'}
                  onClick={(e) => {
                    if (!isAuthenticated) {
                      e.preventDefault();
                      showNotification(t('notification.connection_required'), 'warning');
                    }
                  }}
                  className={({ isActive }) => cn(
                    "relative px-3 py-1.5 transition-all duration-150 outline-none flex items-center gap-2 text-xs tracking-wide cursor-pointer whitespace-nowrap",
                    isActive && isAuthenticated
                      ? "text-primary-foreground bg-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <span className="shrink-0 [&>svg]:w-3.5 [&>svg]:h-3.5">{item.icon}</span>
                  <span className="leading-none hidden sm:inline">{item.label}</span>
                </NavLink>
              ))}
            </nav>
            <div className="hidden md:flex items-center gap-2 text-muted-foreground/50">
              <span className="tracking-wider text-[10px]">NAVIGATE</span>
              <kbd className="text-[10px] min-w-5 h-5 flex items-center justify-center px-1.5 bg-muted border border-border font-medium">Tab</kbd>
            </div>
          </div>
          <main className="border border-border bg-card p-6 flex-1 relative overflow-auto mt-8">
            <Outlet />
          </main>
        </div>
        {footerContent}
      </div>
    );
  }

  // Sidebar navigation layout (default) - VSCode style icons only
  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
        )}

        <nav className={cn(
          "w-12 shrink-0 border-r border-border bg-card flex flex-col items-center pt-2 pb-2",
          "fixed md:relative inset-y-0 left-0 z-50 md:z-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}>
          {navItems.map((item) => (
            <Tooltip key={item.path} content={item.label} side="right">
              <NavLink
                to={isAuthenticated ? item.path : '#'}
                onClick={(e) => { 
                  if (!isAuthenticated) {
                    e.preventDefault();
                    showNotification(t('notification.connection_required'), 'warning');
                    return;
                  }
                  sound.click(); 
                  setSidebarOpen(false); 
                }}
                className={({ isActive }) => cn(
                  "relative w-12 h-12 flex items-center justify-center transition-colors cursor-pointer outline-none",
                  isActive && isAuthenticated
                    ? "text-primary"
                    : "text-primary/40 hover:text-primary/70 dark:text-[#858585] dark:hover:text-primary/70"
                )}
              >
                {({ isActive }) => (
                  <>
                    {isActive && isAuthenticated && (
                      <span className="absolute inset-1.5 bg-[#DDDDE2] dark:bg-primary/20" style={{ borderRadius: '6px' }} />
                    )}
                    <span className="relative z-10 [&>svg]:w-6 [&>svg]:h-6">{item.icon}</span>
                  </>
                )}
              </NavLink>
            </Tooltip>
          ))}
          <div className="flex-1" />
          <Tooltip content={configNavItem.label} side="right">
            <NavLink
              to={isAuthenticated ? configNavItem.path : '#'}
              onClick={(e) => { 
                if (!isAuthenticated) {
                  e.preventDefault();
                  showNotification(t('notification.connection_required'), 'warning');
                  return;
                }
                sound.click(); 
                setSidebarOpen(false); 
              }}
              className={({ isActive }) => cn(
                "relative w-12 h-12 flex items-center justify-center transition-colors cursor-pointer outline-none",
                isActive && isAuthenticated
                  ? "text-primary"
                  : "text-primary/40 hover:text-primary/70 dark:text-[#858585] dark:hover:text-primary/70"
              )}
            >
              {({ isActive }) => (
                <>
                  {isActive && isAuthenticated && (
                    <span className="absolute inset-1.5 bg-[#DDDDE2] dark:bg-primary/20" style={{ borderRadius: '6px' }} />
                  )}
                  <span className="relative z-10 [&>svg]:w-6 [&>svg]:h-6">{configNavItem.icon}</span>
                </>
              )}
            </NavLink>
          </Tooltip>
        </nav>

        <div className="flex-1 flex flex-col min-h-0">
          <header className="border-b border-border px-4 md:px-6 py-3 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => setSidebarOpen((prev) => !prev)} className="md:hidden">
                  {headerIcons.menu}
                </Button>
                <Tooltip content={titleExpanded ? t('title.abbr') : t('title.main')}>
                  <h1 
                    className={cn(
                      "text-xl font-bold tracking-tight text-primary flex items-center gap-2 select-none",
                      isAnimating ? "cursor-default" : "cursor-pointer"
                    )}
                    onClick={() => { if (!isAnimating) { sound.click(); setHasInteracted(true); setTitleExpanded(!titleExpanded); } }}
                  >
                    <IconCrocodile size={36} />
                    <span 
                      className="text-2xl tracking-tight mt-0.5 whitespace-nowrap"
                      style={{ fontFamily: "'Kranky', cursive" }}
                    >
                      {displayedTitle}
                    </span>
                  </h1>
                </Tooltip>
              </div>
              {headerActions}
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-4 md:p-6">
            <h2 className="text-sm font-bold text-primary mb-4">
              {[...navItems, configNavItem].find(item => item.path === location.pathname)?.label || ''}
            </h2>
            <Outlet />
          </main>
        </div>
      </div>
      {footerContent}
    </div>
  );
}
