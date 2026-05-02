import { Page } from '@playwright/test';

/**
 * Mocks all backend API calls under `/v0/management/...` so the SPA can
 * complete its login + initial fetches without a real server, then drives
 * the login form so the app reaches an authenticated state.
 *
 * Returns when navigation has settled on the dashboard ('/'). Throws if
 * login fails.
 */
export async function bypassLoginViaForm(page: Page) {
  // Mock the management API. Routes match any host so the apiBase the user
  // entered doesn't matter — Playwright intercepts before the network.
  await page.route('**/v0/management/**', (route) => {
    const url = route.request().url();
    if (url.includes('/config')) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(minimalConfigResponse())
      });
      return;
    }
    if (url.includes('/api-keys') || url.includes('/auth-files') || url.includes('/oauth-excluded-models')) {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return;
    }
    if (url.includes('/version') || url.includes('/latest-version')) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ version: 'test', buildDate: 'test' })
      });
      return;
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/');
  // Hash routing redirects unauthenticated users to /#/login.
  await page.waitForURL('**/#/login', { timeout: 10_000 });

  // The default login form has only the management-key input visible
  // (the optional API-base input is gated behind a "custom connection"
  // toggle). apiBase defaults to detectApiBaseFromLocation() — which the
  // route mock intercepts regardless of host.
  const keyInput = page.locator('input[type="password"]').first();
  await keyInput.waitFor({ state: 'visible', timeout: 10_000 });
  await keyInput.fill('test-management-key');

  // Submit by pressing Enter — the form handles Enter via onKeyDown.
  await keyInput.press('Enter');

  // Wait for hash to leave /login.
  await page.waitForFunction(
    () => !window.location.hash.startsWith('#/login'),
    { timeout: 10_000 }
  );
}

function minimalConfigResponse() {
  return {
    'remote-management': { 'secret-key': 'test', 'panel-github-repository': '' },
    debug: false,
    'logging-to-file': false,
    'usage-statistics-enabled': false,
    'auth-dir': '/tmp/auth',
    port: 9999,
    host: '127.0.0.1',
    'api-keys': [],
    'gemini-api-keys': [],
    'claude-api-keys': [],
    'codex-api-keys': [],
    'vertex-api-keys': [],
    'openai-compatibility': [],
    'oauth-excluded-models': {},
    quota: { providers: [] },
    'amp-code': {
      'upstream-url': '',
      'upstream-api-key': '',
      'upstream-api-keys': [],
      'model-mappings': [],
      'force-model-mappings': false,
      'restrict-management-to-localhost': false
    },
    'request-log': false,
    'request-retry': 3,
    'max-retry-credentials': 0,
    'max-retry-interval': 0,
    'commercial-mode': false,
    'websocket-auth': false,
    tls: { enable: false }
  };
}

/**
 * Captures performance timing metrics for the current page. Returns a
 * stable shape suitable for JSON-diffing against future runs.
 */
export async function capturePageTiming(page: Page) {
  return await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByType('paint');
    const fp = paint.find((p) => p.name === 'first-paint');
    const fcp = paint.find((p) => p.name === 'first-contentful-paint');
    return {
      domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : null,
      loadEvent: nav ? nav.loadEventEnd - nav.startTime : null,
      firstPaint: fp ? fp.startTime : null,
      firstContentfulPaint: fcp ? fcp.startTime : null,
      transferBytes: nav ? nav.transferSize : null,
      decodedBytes: nav ? nav.decodedBodySize : null
    };
  });
}
