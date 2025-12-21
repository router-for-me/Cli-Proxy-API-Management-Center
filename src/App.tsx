import { useCallback, useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ApiKeysPage } from '@/pages/ApiKeysPage';
import { AiProvidersPage } from '@/pages/AiProvidersPage';
import { AuthFilesPage } from '@/pages/AuthFilesPage';
import { OAuthPage } from '@/pages/OAuthPage';
import { UsagePage } from '@/pages/UsagePage';
import { ConfigPage } from '@/pages/ConfigPage';
import { LogsPage } from '@/pages/LogsPage';
import { SystemPage } from '@/pages/SystemPage';
import { NotificationContainer } from '@/components/common/NotificationContainer';
import { SplashScreen } from '@/components/common/SplashScreen';
import { MainLayout } from '@/components/layout/MainLayout';
import { ProtectedRoute } from '@/router/ProtectedRoute';
import { useAuthStore, useLanguageStore, useThemeStore } from '@/stores';

const SPLASH_DURATION = 1500;
const SPLASH_FADE_DURATION = 400;

function App() {
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const restoreSession = useAuthStore((state) => state.restoreSession);

  const [splashReadyToFade, setSplashReadyToFade] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    initializeTheme();
    void restoreSession().finally(() => {
      setAuthReady(true);
    });
  }, [initializeTheme, restoreSession]);

  useEffect(() => {
    setLanguage(language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅用于首屏同步 i18n 语言

  useEffect(() => {
    const timer = setTimeout(() => {
      setSplashReadyToFade(true);
    }, SPLASH_DURATION - SPLASH_FADE_DURATION);

    return () => clearTimeout(timer);
  }, []);

  const handleSplashFinish = useCallback(() => {
    setShowSplash(false);
  }, []);

  if (showSplash) {
    return (
      <SplashScreen
        fadeOut={splashReadyToFade && authReady}
        onFinish={handleSplashFinish}
      />
    );
  }

  return (
    <HashRouter>
      <NotificationContainer />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="api-keys" element={<ApiKeysPage />} />
          <Route path="ai-providers" element={<AiProvidersPage />} />
          <Route path="auth-files" element={<AuthFilesPage />} />
          <Route path="oauth" element={<OAuthPage />} />
          <Route path="usage" element={<UsagePage />} />
          <Route path="config" element={<ConfigPage />} />
          <Route path="logs" element={<LogsPage />} />
          <Route path="system" element={<SystemPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
