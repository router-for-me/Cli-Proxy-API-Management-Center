import { expect, test } from 'bun:test';

// Opt in with a Vite dev server and Playwright; no live management connection.
const origin = process.env.SYSTEM_TEST_ORIGIN;
const playwright = process.env.SYSTEM_TEST_PLAYWRIGHT;

test.skipIf(!origin || !playwright)(
  'closing a pending preview aborts fetch; an oversized stream stops before EOF but downloads fully',
  async () => {
    const { chromium } = await import(playwright!);
    const browser = await chromium.launch({ channel: 'chrome' });
    const size = 2 * 1024 * 1024 + 1;
    try {
      const page = await browser.newPage({ locale: 'en-US', reducedMotion: 'reduce' });
      page.setDefaultTimeout(5000);
      await page.addInitScript(() => {
        const fetch = window.fetch.bind(window);
        let attempts = 0;
        window.fetch = (input, init) => {
          if (!(input instanceof Request) || !input.url.endsWith('/errors/fixture.log')) {
            return fetch(input, init);
          }
          if (input.headers.get('Authorization') !== 'Bearer fixture') throw Error('Missing auth');
          if (++attempts === 1) {
            document.body.dataset.preview = 'pending';
            return new Promise((_, reject) =>
              input.signal.addEventListener('abort', () => {
                document.body.dataset.preview = 'aborted';
                reject(input.signal.reason);
              })
            );
          }
          return Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new Uint8Array(2 * 1024 * 1024));
                  controller.enqueue(new Uint8Array(1)); // No Content-Length, no EOF.
                },
                cancel() {
                  document.body.dataset.preview = 'stopped';
                },
              })
            )
          );
        };
      });
      await page.route(
        '**/v8/management/**',
        (route: { request(): { url(): string }; fulfill(options: object): Promise<void> }) => {
          const path = new URL(route.request().url()).pathname;
          if (path.endsWith('/errors/fixture.log'))
            return route.fulfill({ body: Buffer.alloc(size) });
          return route.fulfill({
            json: path.endsWith('/errors') ? { files: [{ name: 'fixture.log' }] } : {},
          });
        }
      );
      await page.goto(`${origin}/#/logs`);
      await page.locator('input[type=password]').fill('fixture');
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      await page.getByRole('button', { name: 'Error Request Logs', exact: true }).first().click();
      const open = page.getByRole('button', { name: 'Open', exact: true });
      await open.click();
      await page.locator('body[data-preview=pending]').waitFor();
      await page.keyboard.press('Escape');
      await page.locator('body[data-preview=aborted]').waitFor();
      await open.click();
      await page.getByText(/exceeds the 2 MiB preview limit/).waitFor();
      await page.locator('body[data-preview=stopped]').waitFor();
      const downloaded = page.waitForEvent('download');
      await page.getByRole('dialog').getByRole('button', { name: 'Download' }).click();
      expect(Bun.file(await (await downloaded).path()).size).toBe(size);
    } finally {
      await browser.close();
    }
  },
  30_000
);
