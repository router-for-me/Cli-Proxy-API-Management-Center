import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { WelcomePage } from '@/pages/WelcomePage';
import { ApiKeysPage } from '@/pages/ApiKeysPage';
import { AiProvidersPage } from '@/pages/AiProvidersPage';
import { AuthFilesPage } from '@/pages/AuthFilesPage';
import { OAuthPage } from '@/pages/OAuthPage';
import { UsagePage } from '@/pages/UsagePage';
import { ConfigPage } from '@/pages/ConfigPage';
import { LogsPage } from '@/pages/LogsPage';
import { SystemPage } from '@/pages/SystemPage';
import { MainLayout } from '@/components/layout/MainLayout';
import { ProtectedRoute } from '@/router/ProtectedRoute';
import { useAuthStore, useLanguageStore, useThemeStore } from '@/stores';

function App() {
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const isRestoring = useAuthStore((state) => state.isRestoring);

  useEffect(() => {
    initializeTheme();
    restoreSession();
  }, [initializeTheme, restoreSession]);

  useEffect(() => {
    setLanguage(language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅用于首屏同步 i18n 语言

  const theme = useThemeStore((state) => state.theme);

  if (isRestoring) {
    return <div className="h-screen bg-background" />;
  }

  return (
    <HashRouter>
      <Toaster 
        position="bottom-center" 
        theme={theme}
        toastOptions={{
          duration: 1000,
          unstyled: true,
        }}
      />
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Navigate to="/welcome" replace />} />
          <Route path="welcome" element={<WelcomePage />} />
          <Route path="login" element={<Navigate to="/welcome" replace />} />
          <Route path="settings" element={<Navigate to="/config" replace />} />
          <Route path="api-keys" element={<ProtectedRoute><ApiKeysPage /></ProtectedRoute>} />
          <Route path="ai-providers" element={<ProtectedRoute><AiProvidersPage /></ProtectedRoute>} />
          <Route path="auth-files" element={<ProtectedRoute><AuthFilesPage /></ProtectedRoute>} />
          <Route path="oauth" element={<ProtectedRoute><OAuthPage /></ProtectedRoute>} />
          <Route path="usage" element={<ProtectedRoute><UsagePage /></ProtectedRoute>} />
          <Route path="config" element={<ProtectedRoute><ConfigPage /></ProtectedRoute>} />
          <Route path="logs" element={<ProtectedRoute><LogsPage /></ProtectedRoute>} />
          <Route path="system" element={<ProtectedRoute><SystemPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/welcome" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default App;
