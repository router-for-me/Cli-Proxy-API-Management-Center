import { expect, test } from 'bun:test';

// Opt-in with a local Vite server and Playwright installation. No live credentials are used.
const origin = process.env.SYSTEM_TEST_ORIGIN;
const playwright = process.env.SYSTEM_TEST_PLAYWRIGHT;

test.skipIf(!origin || !playwright)(
  'a failed request-log save cannot roll back the next session',
  async () => {
    const { chromium } = await import(playwright!);
    const browser = await chromium.launch({ channel: 'chrome' });
    const release = Promise.withResolvers<void>();
    try {
      const page = await browser.newPage({ locale: 'en-US', reducedMotion: 'reduce' });
      page.setDefaultTimeout(5_000);
      let requestLog = false;
      await page.route(
        '**/v8/management/**',
        async (route: {
          request(): { url(): string };
          fulfill(response: { json: unknown; status?: number }): Promise<void>;
        }) => {
          const path = new URL(route.request().url()).pathname;
          if (path.endsWith('/request-log')) {
            await release.promise;
            return route.fulfill({ status: 503, json: { error: 'old-session-error' } });
          }
          return route.fulfill({
            json: path.endsWith('/config')
              ? {
                  observability: { logs: { 'request-log': requestLog } },
                }
              : {},
          });
        }
      );
      await page.route(
        '**/v1/models',
        (route: { fulfill(response: { json: unknown }): Promise<void> }) =>
          route.fulfill({ json: { data: [] } })
      );
      const login = async () => {
        await page.locator('input[type=password]').fill('fixture');
        await page.getByRole('button', { name: 'Login', exact: true }).click();
      };
      const openSettings = async () => {
        const version = page.getByRole('button', { name: /Management UI Version/ });
        for (let i = 0; i < 7; i++) await version.click();
        return page.getByRole('dialog').getByRole('checkbox');
      };
      await page.goto(`${origin}/#/system`);
      await login();
      await openSettings();
      await page.getByRole('dialog').locator('label').click();
      const pending = page.waitForRequest('**/request-log');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await pending;
      await page.evaluate(() => window.dispatchEvent(new Event('unauthorized')));
      requestLog = true;
      await login();
      const checkbox = await openSettings();
      expect(await checkbox.isChecked()).toBe(true);
      const completed = page.waitForResponse('**/request-log');
      release.resolve();
      await completed;
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(await (await openSettings()).isChecked()).toBe(true);
    } finally {
      release.resolve();
      await browser.close();
    }
  },
  30_000
);
