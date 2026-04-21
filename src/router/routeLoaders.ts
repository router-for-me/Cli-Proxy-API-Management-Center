const loadDashboardPage = () => import('@/pages/DashboardPage');
const loadAiProvidersPage = () => import('@/pages/AiProvidersPage');
const loadAuthFilesPage = () => import('@/pages/AuthFilesPage');
const loadUsagePage = () => import('@/pages/UsagePage');
const loadConfigPage = () => import('@/pages/ConfigPage');
const loadSystemPage = () => import('@/pages/SystemPage');
const loadRequestLogsPage = () => import('@/pages/RequestLogsPage');

const PRIMARY_ROUTE_LOADERS = [
  loadDashboardPage,
  loadConfigPage,
  loadAiProvidersPage,
  loadAuthFilesPage,
  loadUsagePage,
  loadRequestLogsPage,
  loadSystemPage,
] as const;

let primaryRoutesPreloaded = false;

export function preloadPrimaryRoutes() {
  if (primaryRoutesPreloaded) {
    return Promise.resolve();
  }

  primaryRoutesPreloaded = true;
  return Promise.allSettled(PRIMARY_ROUTE_LOADERS.map((loader) => loader())).then(() => undefined);
}

export {
  loadAiProvidersPage,
  loadAuthFilesPage,
  loadConfigPage,
  loadDashboardPage,
  loadRequestLogsPage,
  loadSystemPage,
  loadUsagePage,
};
