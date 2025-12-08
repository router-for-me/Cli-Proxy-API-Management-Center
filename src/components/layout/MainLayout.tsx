import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { useAuthStore, useConfigStore, useLanguageStore, useNotificationStore, useThemeStore } from '@/stores';
import { versionApi } from '@/services/api';
import { isLocalhost } from '@/utils/connection';

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

  const isLocal = useMemo(() => isLocalhost(window.location.hostname), []);

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
    { path: '/settings', label: t('nav.basic_settings') },
    { path: '/api-keys', label: t('nav.api_keys') },
    { path: '/ai-providers', label: t('nav.ai_providers') },
    { path: '/auth-files', label: t('nav.auth_files') },
    ...(isLocal ? [{ path: '/oauth', label: t('nav.oauth', { defaultValue: 'OAuth' }) }] : []),
    { path: '/usage', label: t('nav.usage_stats') },
    { path: '/config', label: t('nav.config_management') },
    ...(config?.loggingToFile ? [{ path: '/logs', label: t('nav.logs') }] : []),
    { path: '/system', label: t('nav.system_info') }
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
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="brand">{sidebarCollapsed ? t('title.abbr').charAt(0) : t('title.abbr')}</div>
        <div className="nav-section">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
              title={sidebarCollapsed ? item.label : undefined}
            >
              {sidebarCollapsed ? item.label.charAt(0) : item.label}
            </NavLink>
          ))}
        </div>
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed((prev) => !prev)}
          title={sidebarCollapsed ? t('sidebar.expand', { defaultValue: '展开' }) : t('sidebar.collapse', { defaultValue: '收起' })}
        >
          {sidebarCollapsed ? '»' : '«'}
        </button>
      </aside>

      <div className="content">
        <header className="main-header">
          <div className="left">
            <Button variant="ghost" size="sm" onClick={() => setSidebarOpen((prev) => !prev)}>
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

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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
  );
}
