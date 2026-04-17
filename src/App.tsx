import { Suspense, lazy, useEffect, type ComponentType } from 'react';
import { Outlet, RouterProvider, createHashRouter } from 'react-router-dom';
import { PageLoadFallback } from '@/components/common/PageLoadFallback';
import { ProtectedRoute } from '@/router/ProtectedRoute';
import { useLanguageStore, useThemeStore } from '@/stores';

function lazyNamed<TModule extends Record<string, unknown>>(
  loader: () => Promise<TModule>,
  exportName: keyof TModule
) {
  return lazy(async () => {
    const module = await loader();
    return { default: module[exportName] as ComponentType };
  });
}

const LazyLoginPage = lazyNamed(() => import('@/pages/LoginPage'), 'LoginPage');
const LazyMainLayout = lazyNamed(() => import('@/components/layout/MainLayout'), 'MainLayout');
const fullScreenFallback = <PageLoadFallback fullScreen />;

function renderLazyPage(Component: ComponentType) {
  return (
    <Suspense fallback={fullScreenFallback}>
      <Component />
    </Suspense>
  );
}

function RootShell() {
  return <Outlet />;
}

const router = createHashRouter([
  {
    element: <RootShell />,
    children: [
      { path: '/login', element: renderLazyPage(LazyLoginPage) },
      {
        path: '/*',
        element: (
          <ProtectedRoute>
            {renderLazyPage(LazyMainLayout)}
          </ProtectedRoute>
        ),
      },
    ],
  },
]);

function App() {
  const initializeTheme = useThemeStore((state) => state.initializeTheme);
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);

  useEffect(() => {
    const cleanupTheme = initializeTheme();
    return cleanupTheme;
  }, [initializeTheme]);

  useEffect(() => {
    setLanguage(language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅用于首屏同步 i18n 语言

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return <RouterProvider router={router} />;
}

export default App;
