/**
 * Fork: opening the management UI lands on the dashboard; reloads and
 * back/forward keep their page. Imported first in main.tsx so it runs before
 * the hash router reads the URL.
 */

const navigation = performance.getEntriesByType('navigation')[0] as
  PerformanceNavigationTiming | undefined;

if (navigation?.type === 'navigate' && !/^(#\/?(login)?)?$/.test(window.location.hash)) {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
}

export {};
