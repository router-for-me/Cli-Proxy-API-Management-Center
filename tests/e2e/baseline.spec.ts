import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { bypassLoginViaForm, capturePageTiming } from './fixtures';

/**
 * Phase A baseline capture. These tests intentionally DO NOT assert on
 * absolute timing thresholds — they capture numbers for the bench file
 * which Phase B exit will compare against. Pass conditions are limited to:
 *   - Page mounts without console errors.
 *   - Capture call returned a non-null record.
 *
 * Captures are written to `bench/baseline/frontend.json` under the `perf`
 * key, merging with the bundle-size baseline already there.
 */

const BASELINE_FILE = 'bench/baseline/frontend.json';

interface PerfRecord {
  domContentLoaded: number | null;
  loadEvent: number | null;
  firstPaint: number | null;
  firstContentfulPaint: number | null;
  transferBytes: number | null;
  decodedBytes: number | null;
}

const captures: Record<string, PerfRecord & { url: string; consoleErrors: number }> = {};

test.afterAll(() => {
  const filePath = path.resolve(process.cwd(), BASELINE_FILE);
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      existing = {};
    }
  }
  existing.perf = {
    captured_at: new Date().toISOString(),
    routes: captures
  };
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n');
});

test.describe('Phase A frontend perf baseline', () => {
  test('login page TTI', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/#/login', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');

    const timing = await capturePageTiming(page);
    captures['/#/login'] = { url: '/#/login', ...timing, consoleErrors: errors.length };
    expect(timing).not.toBeNull();
  });

  test('dashboard / TTI (auth via login form)', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await bypassLoginViaForm(page);
    await page.waitForLoadState('networkidle');

    const timing = await capturePageTiming(page);
    captures['/'] = { url: '/', ...timing, consoleErrors: errors.length };
    expect(timing).not.toBeNull();
  });

  test('/#/auth-files TTI', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await bypassLoginViaForm(page);
    await page.goto('/#/auth-files');
    await page.waitForLoadState('networkidle');

    const timing = await capturePageTiming(page);
    captures['/#/auth-files'] = { url: '/#/auth-files', ...timing, consoleErrors: errors.length };
    expect(timing).not.toBeNull();
  });

  test('/#/config TTI', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await bypassLoginViaForm(page);
    await page.goto('/#/config');
    await page.waitForLoadState('networkidle');

    const timing = await capturePageTiming(page);
    captures['/#/config'] = { url: '/#/config', ...timing, consoleErrors: errors.length };
    expect(timing).not.toBeNull();
  });
});

test.describe('OpenAISection keyboard-nav baseline (placeholder)', () => {
  test.skip(
    'navigates by keyboard through 50 OpenAI keys',
    async () => {
      // Phase A placeholder. Exercising OpenAISection requires reaching a
      // /ai-providers/openai/<index> route with a config that already
      // contains the openai-compatibility provider list. The Phase A
      // bypassLoginViaForm helper mocks /config but the provider-edit
      // navigation flow needs additional fixture state we don't have yet.
      //
      // Phase B (virtualization of OpenAISection) lands the fixture +
      // un-skips this test, captures baseline keyboard-step latency, and
      // adds the post-virtualization regression assertion.
    }
  );
});
