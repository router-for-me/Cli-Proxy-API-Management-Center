import { ReactNode, SVGProps, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useAuthStore, useConfigStore, useLanguageStore, useNotificationStore, useThemeStore } from '@/stores';
import { versionApi } from '@/services/api';
import { isLocalhost } from '@/utils/connection';

const iconProps: SVGProps<SVGSVGElement> = {
  width: 18,
  height: 18,
  viewBox: '0 0 20 20',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
  focusable: 'false'
};

const sidebarIcons: Record<string, ReactNode> = {
  settings: (
    <svg {...iconProps}>
      <path d="M4 6.5h12" />
      <circle cx="9" cy="6.5" r="2" />
      <path d="M4 10h12" />
      <circle cx="7" cy="10" r="2" />
      <path d="M4 13.5h12" />
      <circle cx="12" cy="13.5" r="2" />
    </svg>
  ),
  apiKeys: (
    <svg {...iconProps}>
      <circle cx="7.2" cy="10" r="2.4" />
      <path d="M9.6 10h6" />
      <path d="M12.8 10v2.4" />
      <path d="M14.8 10v1.4" />
    </svg>
  ),
  aiProviders: (
    <svg {...iconProps}>
      <circle cx="10" cy="5.2" r="2.2" />
      <circle cx="6" cy="13.2" r="2" />
      <circle cx="14" cy="13.2" r="2" />
      <path d="M8.6 6.8 6.8 10.8" />
      <path d="M11.4 6.8 13.2 10.8" />
      <path d="M7.8 13.2h4.4" />
    </svg>
  ),
  authFiles: (
    <svg {...iconProps}>
      <path d="M7 3.5h4.8L15 6.8V16H7Z" />
      <path d="M11.8 3.5V7h3.2" />
      <path d="m8.9 11.8 1.7 1.6 3.4-3.5" />
    </svg>
  ),
  oauth: (
    <svg {...iconProps}>
      <path d="M10 3.5 15.2 5.6v3.6c0 3-2 5.8-5.2 7-3.2-1.2-5.2-4-5.2-7V5.6Z" />
      <path d="M8.2 9.6h3.6" />
      <path d="m9.6 8.2-1.4 1.4 1.4 1.4" />
      <path d="m11.8 8.2 1.4 1.4-1.4 1.4" />
    </svg>
  ),
  usage: (
    <svg {...iconProps}>
      <path d="M4 14.5h12" />
      <path d="m6.2 11.3 3-3 2.4 2 2.9-3.7" />
    </svg>
  ),
  config: (
    <svg {...iconProps}>
      <path d="M5.2 8 10 5.8l4.8 2.2L10 10.2Z" />
      <path d="M5.2 12 10 9.8l4.8 2.2L10 14.2Z" />
      <path d="M10 10.2v3.6" />
    </svg>
  ),
  logs: (
    <svg {...iconProps}>
      <path d="M6.4 6h9" />
      <path d="M6.4 10h9" />
      <path d="M6.4 14h9" />
      <circle cx="4.2" cy="6" r="0.9" />
      <circle cx="4.2" cy="10" r="0.9" />
      <circle cx="4.2" cy="14" r="0.9" />
    </svg>
  ),
  system: (
    <svg {...iconProps}>
      <circle cx="10" cy="10" r="6.2" />
      <path d="M10 8.8v3.6" />
      <circle cx="10" cy="6.2" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  )
};

const parseVersionSegments = (version?: string | null) => {
  if (!version) return null;
  const cleaned = version.trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const parts = cleaned
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite);
  return parts.length ? parts : null;
};

const compareVersions = (latest?: string | null, current?: string | null) => {
  const latestParts = parseVersionSegments(latest);
  const currentParts = parseVersionSegments(current);
  if (!latestParts || !currentParts) return null;
  const length = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < length; i++) {
    const l = latestParts[i] || 0;
    const c = currentParts[i] || 0;
    if (l > c) return 1;
    if (l < c) return -1;
  }
  return 0;
};

export function MainLayout() {
  const { t, i18n } = useTranslation();
  const { showNotification } = useNotificationStore();

  const apiBase = useAuthStore((state) => state.apiBase);
  const serverVersion = useAuthStore((state) => state.serverVersion);
  const serverBuildDate = useAuthStore((state) => state.serverBuildDate);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const clearCache = useConfigStore((state) => state.clearCache);

  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const language = useLanguageStore((state) => state.language);
  const toggleLanguage = useLanguageStore((state) => state.toggleLanguage);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [brandExpanded, setBrandExpanded] = useState(true);
  const brandCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);

  const isLocal = useMemo(() => isLocalhost(window.location.hostname), []);

  const fullBrandName = 'CLI Proxy API Management Center';
  const abbrBrandName = t('title.abbr');

  // 将顶栏高度写入 CSS 变量，确保侧栏/内容区计算一致，防止滚动时抖动
  useLayoutEffect(() => {
    const updateHeaderHeight = () => {
      const height = headerRef.current?.offsetHeight;
      if (height) {
        document.documentElement.style.setProperty('--header-height', `${height}px`);
      }
    };

    updateHeaderHeight();

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' && headerRef.current ? new ResizeObserver(updateHeaderHeight) : null;
    if (resizeObserver && headerRef.current) {
      resizeObserver.observe(headerRef.current);
    }

    window.addEventListener('resize', updateHeaderHeight);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', updateHeaderHeight);
    };
  }, []);

  // 5秒后自动收起品牌名称
  useEffect(() => {
    brandCollapseTimer.current = setTimeout(() => {
      setBrandExpanded(false);
    }, 5000);

    return () => {
      if (brandCollapseTimer.current) {
        clearTimeout(brandCollapseTimer.current);
      }
    };
  }, []);

  const handleBrandClick = useCallback(() => {
    if (!brandExpanded) {
      setBrandExpanded(true);
      // 点击展开后，5秒后再次收起
      if (brandCollapseTimer.current) {
        clearTimeout(brandCollapseTimer.current);
      }
      brandCollapseTimer.current = setTimeout(() => {
        setBrandExpanded(false);
      }, 5000);
    }
  }, [brandExpanded]);

  useEffect(() => {
    fetchConfig().catch(() => {
      // ignore initial failure; login flow会提示
    });
  }, [fetchConfig]);

  const statusClass =
    connectionStatus === 'connected'
      ? 'success'
      : connectionStatus === 'connecting'
        ? 'warning'
        : connectionStatus === 'error'
          ? 'error'
          : 'muted';

  const navItems = [
    { path: '/settings', label: t('nav.basic_settings'), icon: sidebarIcons.settings },
    { path: '/api-keys', label: t('nav.api_keys'), icon: sidebarIcons.apiKeys },
    { path: '/ai-providers', label: t('nav.ai_providers'), icon: sidebarIcons.aiProviders },
    { path: '/auth-files', label: t('nav.auth_files'), icon: sidebarIcons.authFiles },
    ...(isLocal ? [{ path: '/oauth', label: t('nav.oauth', { defaultValue: 'OAuth' }), icon: sidebarIcons.oauth }] : []),
    { path: '/usage', label: t('nav.usage_stats'), icon: sidebarIcons.usage },
    { path: '/config', label: t('nav.config_management'), icon: sidebarIcons.config },
    ...(config?.loggingToFile ? [{ path: '/logs', label: t('nav.logs'), icon: sidebarIcons.logs }] : []),
    { path: '/system', label: t('nav.system_info'), icon: sidebarIcons.system }
  ];

  const handleRefreshAll = async () => {
    clearCache();
    try {
      await fetchConfig(undefined, true);
      showNotification(t('notification.data_refreshed'), 'success');
    } catch (error: any) {
      showNotification(`${t('notification.refresh_failed')}: ${error?.message || ''}`, 'error');
    }
  };

  const handleVersionCheck = async () => {
    setCheckingVersion(true);
    try {
      const data = await versionApi.checkLatest();
      const latest = data?.['latest-version'] ?? data?.latest_version ?? data?.latest ?? '';
      const comparison = compareVersions(latest, serverVersion);

      if (!latest) {
        showNotification(t('system_info.version_check_error'), 'error');
        return;
      }

      if (comparison === null) {
        showNotification(t('system_info.version_current_missing'), 'warning');
        return;
      }

      if (comparison > 0) {
        showNotification(t('system_info.version_update_available', { version: latest }), 'warning');
      } else {
        showNotification(t('system_info.version_is_latest'), 'success');
      }
    } catch (error: any) {
      showNotification(`${t('system_info.version_check_error')}: ${error?.message || ''}`, 'error');
    } finally {
      setCheckingVersion(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="main-header" ref={headerRef}>
        <div className="left">
          <button
            className="sidebar-toggle-header"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            title={sidebarCollapsed ? t('sidebar.expand', { defaultValue: '展开' }) : t('sidebar.collapse', { defaultValue: '收起' })}
          >
            {sidebarCollapsed ? '»' : '«'}
          </button>
          <div
            className={`brand-header ${brandExpanded ? 'expanded' : 'collapsed'}`}
            onClick={handleBrandClick}
            title={brandExpanded ? undefined : fullBrandName}
          >
            <span className="brand-full">{fullBrandName}</span>
            <span className="brand-abbr">{abbrBrandName}</span>
          </div>
          <Button className="mobile-menu-btn" variant="ghost" size="sm" onClick={() => setSidebarOpen((prev) => !prev)}>
            ☰
          </Button>
          <div className="connection">
              <span className={`status-badge ${statusClass}`}>
                {t(
                  connectionStatus === 'connected'
                    ? 'common.connected_status'
                    : connectionStatus === 'connecting'
                      ? 'common.connecting_status'
                      : 'common.disconnected_status'
                )}
              </span>
              <span className="base">{apiBase || '-'}</span>
            </div>
          </div>

          <div className="header-actions">
            <Button variant="ghost" size="sm" onClick={handleRefreshAll} title={t('header.refresh_all')}>
              ↻
            </Button>
            <Button variant="ghost" size="sm" onClick={handleVersionCheck} loading={checkingVersion} title={t('system_info.version_check_button')}>
              ⬆
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleLanguage} title={t('language.switch')}>
              {language === 'zh-CN' ? '中' : 'En'}
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleTheme} title={t('theme.switch')}>
              {theme === 'dark' ? '☀' : '☾'}
            </Button>
          </div>
        </header>

      <div className="main-body">
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="nav-section">
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <span className="nav-icon">{item.icon}</span>
                {!sidebarCollapsed && <span className="nav-label">{item.label}</span>}
              </NavLink>
            ))}
          </div>
        </aside>

        <div className="content">
          <main className="main-content">
            <Outlet />
          </main>

          <footer className="footer">
            <span>
              {t('footer.api_version')}: {serverVersion || t('system_info.version_unknown')}
            </span>
            <span>
              {t('footer.build_date')}:{' '}
              {serverBuildDate ? new Date(serverBuildDate).toLocaleString(i18n.language) : t('system_info.version_unknown')}
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}
