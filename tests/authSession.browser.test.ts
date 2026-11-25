import { expect, test } from 'bun:test';

// Opt-in with a Vite dev server; only fixture requests are used.
const origin = process.env.SYSTEM_TEST_ORIGIN;
const playwright = process.env.SYSTEM_TEST_PLAYWRIGHT;

for (const trigger of ['logout', '401']) {
  test.skipIf(!origin || !playwright)(`${trigger} discards session prompts on the login page`, async () => {
    const { chromium } = await import(playwright!);
    const browser = await chromium.launch({ channel: 'chrome' });
    try {
      const page = await browser.newPage({ locale: 'en-US', reducedMotion: 'reduce' });
      await page.route('**/v8/management/**', (route: { fulfill(o: object): Promise<void> }) =>
        route.fulfill({ json: {} })
      );
      await page.goto(`${origin}/#/system`);
      await page.locator('input[type=password]').fill('fixture-only');
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      await page.waitForURL('**/#/system');
      await page.route('**/v8/management/config', (route: { fulfill(o: object): Promise<void> }) =>
        route.fulfill({ status: 401, json: {} })
      );
      await page.evaluate(async () => {
        const { useNotificationStore } = await import('/src/stores/useNotificationStore.ts');
        const ui = useNotificationStore.getState();
        ui.showNotification('fixture.json failed', 'error', 60_000);
        ui.showConfirmation({ message: 'Delete fixture.json?', onConfirm: () => {} });
        ui.setConfirmationLoading(true);
      });
      await page.getByText('fixture.json failed').waitFor();
      await page.getByRole('dialog').waitFor();
      await page.evaluate(async (trigger: string) => {
        const { useAuthStore } = await import('/src/stores/useAuthStore.ts');
        if (trigger === 'logout') useAuthStore.getState().logout();
        else {
          const { apiClient } = await import('/src/services/api/client.ts');
          try {
            await apiClient.get('/config');
          } catch (error) {
            if ((error as { status?: number }).status !== 401) throw error;
          }
        }
      }, trigger);
      await page.waitForURL('**/#/login');
      expect(await page.getByRole('dialog').count()).toBe(0);
      expect(await page.getByText('fixture.json failed').count()).toBe(0);
    } finally {
      await browser.close();
    }
  });
}
