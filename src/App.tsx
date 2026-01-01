import { useCallback, useEffect, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from '@/pages/LoginPage';
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
    const cleanupTheme = initializeTheme();
    void restoreSession().finally(() => {
      setAuthReady(true);
    });
    return cleanupTheme;
  }, [initializeTheme, restoreSession]);

  useEffect(() => {
    setLanguage(language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅用于首屏同步 i18n 语言

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

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
          path="/*"
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        />
      </Routes>
    </HashRouter>
  );
}

export default App;
