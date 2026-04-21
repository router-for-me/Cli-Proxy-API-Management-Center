import { Suspense, lazy, useEffect, type ComponentType } from 'react';
import { Outlet, RouterProvider, createHashRouter } from 'react-router-dom';
import { PageLoadFallback } from '@/components/common/PageLoadFallback';
import { ProtectedRoute } from '@/router/ProtectedRoute';
import { preloadPrimaryRoutes } from '@/router/routeLoaders';
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
const PRIMARY_ROUTE_PRELOAD_DELAY_MS = 900;

type IdleCapableWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

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

function schedulePrimaryRoutePreload() {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const preload = () => {
    void preloadPrimaryRoutes();
  };
  const idleWindow = window as IdleCapableWindow;

  if (typeof idleWindow.requestIdleCallback === 'function') {
    const idleHandle = idleWindow.requestIdleCallback(preload, {
      timeout: PRIMARY_ROUTE_PRELOAD_DELAY_MS,
    });
    return () => {
      idleWindow.cancelIdleCallback?.(idleHandle);
    };
  }

  const timeoutId = window.setTimeout(preload, PRIMARY_ROUTE_PRELOAD_DELAY_MS);
  return () => {
    window.clearTimeout(timeoutId);
  };
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

  useEffect(() => {
    const cancelPreload = schedulePrimaryRoutePreload();
    return cancelPreload;
  }, []);

  return <RouterProvider router={router} />;
}

export default App;
