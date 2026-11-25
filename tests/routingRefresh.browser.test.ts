import { expect, test } from 'bun:test';

// Opt-in: point ROUTING_TEST_ORIGIN at a local Vite server and ROUTING_TEST_PLAYWRIGHT
// at a Playwright installation with access to Chrome. All management responses are fixtures.
const origin = process.env.ROUTING_TEST_ORIGIN;
const playwright = process.env.ROUTING_TEST_PLAYWRIGHT;

test.skipIf(!origin || !playwright)(
  'a confirmed board refresh blocks edits until the fresh draft is ready',
  async () => {
    const { chromium } = await import(playwright!);
    const browser = await chromium.launch({ channel: 'chrome' });
    const gate = Promise.withResolvers<void>();
    try {
      const page = await browser.newPage({ locale: 'en-US', reducedMotion: 'reduce' });
      let refreshing = false;
      let modelRequests = 0;
      let cachedRequests = 0;
      await page.route(
        '**/v8/management/**',
        async (route: {
          request(): { url(): string };
          fulfill(response: { json: unknown; status?: number }): Promise<void>;
        }) => {
          const path = new URL(route.request().url()).pathname;
          if (path.endsWith('/config')) {
            if (refreshing) await gate.promise;
            return route.fulfill({
              json: { routing: { retry: { 'request-retry': refreshing ? 4 : 1 } } },
            });
          }
          if (path.endsWith('/credentials/models')) {
            if (new URL(route.request().url()).searchParams.get('name') === 'empty.json') {
              cachedRequests++;
              return route.fulfill({ json: { models: [] } });
            }
            modelRequests++;
            return refreshing
              ? route.fulfill({ json: { models: [{ id: 'recovered-model' }] } })
              : route.fulfill({ status: 503, json: { error: 'unavailable' } });
          }
          return route.fulfill({
            json: path.endsWith('/credentials')
              ? { files: ['fixture.json', 'empty.json'].map((name) => ({ name, type: 'codex' })) }
              : {},
          });
        }
      );
      await page.goto(`${origin}/#/routing`);
      await page.locator('input[type=password]').fill('fixture-only');
      await page.getByRole('button', { name: /^Login$/i }).click();
      const retry = page.getByRole('spinbutton', { name: 'Retry rounds' });
      await retry.fill('3');
      await page.getByText(/^Loading models /).waitFor({ state: 'hidden' });
      expect(modelRequests).toBe(1);
      refreshing = true;
      await page.getByTitle('Refresh All', { exact: true }).click();
      await page.getByRole('button', { name: 'Refresh', exact: true }).click();
      await page.getByLabel('Loading routing…').waitFor();
      expect(await retry.count()).toBe(0);
      expect(await page.locator('[data-member-key]').count()).toBe(0);
      expect(
        await page.getByRole('button', { name: 'Save', exact: true, disabled: false }).count()
      ).toBe(0);
      gate.resolve();
      await retry.waitFor();
      expect(await retry.inputValue()).toBe('4');
      await page.locator('#routing-model-preview').click();
      await page.getByRole('option', { name: 'recovered-model' }).waitFor();
      expect(modelRequests).toBe(2);
      expect(cachedRequests).toBe(1);
      await retry.fill('2');
      await page.getByRole('region', { name: 'Unsaved routing changes' }).waitFor();
    } finally {
      gate.resolve();
      await browser.close();
    }
  },
  30_000
);
