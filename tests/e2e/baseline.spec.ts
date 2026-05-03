import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { bypassLoginViaForm, capturePageTiming } from './fixtures';

/**
 * Phase A baseline capture. These tests intentionally DO NOT assert on
 * absolute timing thresholds — they capture numbers for the bench file
 * which Phase B exit will compare against. Pass conditions are limited to:
 *   - Page mounts without unexpected console errors (filtered set).
 *   - Capture call returned a non-null record.
 *
 * Captures are written to `bench/baseline/frontend.latest.json` under
 * the `perf` key. Run `npm run baseline:update` to promote the latest
 * capture into the committed baseline at `bench/baseline/frontend.json`
 * (Codex Stage 1 exit review FE-3).
 */

const BASELINE_FILE = 'bench/baseline/frontend.latest.json';
const COMMITTED_BASELINE = 'bench/baseline/frontend.json';

// Patterns matching console errors that are noise rather than real
// regressions (matches the in-repo Vitest smoke-test allow-list at
// src/__tests__/routes.smoke.test.tsx).
const IGNORED_CONSOLE_ERROR_PATTERNS: RegExp[] = [/not implemented:/i];

function realErrors(errors: string[]): string[] {
  return errors.filter(
    (msg) => !IGNORED_CONSOLE_ERROR_PATTERNS.some((p) => p.test(msg))
  );
}

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
  // Write fresh capture to the .latest.json file (gitignored). Reuse
  // the committed baseline as a starting structure so consumers can
  // diff fields side-by-side. Test runs no longer overwrite the
  // committed baseline; promote with `npm run baseline:update`.
  const latestPath = path.resolve(process.cwd(), BASELINE_FILE);
  const committedPath = path.resolve(process.cwd(), COMMITTED_BASELINE);
  let scaffold: Record<string, unknown> = {};
  if (fs.existsSync(committedPath)) {
    try {
      scaffold = JSON.parse(fs.readFileSync(committedPath, 'utf8'));
    } catch {
      scaffold = {};
    }
  }
  scaffold.perf = {
    captured_at: new Date().toISOString(),
    routes: captures
  };
  fs.mkdirSync(path.dirname(latestPath), { recursive: true });
  fs.writeFileSync(latestPath, JSON.stringify(scaffold, null, 2) + '\n');
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
    expect(realErrors(errors)).toEqual([]);
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
    expect(realErrors(errors)).toEqual([]);
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
    expect(realErrors(errors)).toEqual([]);
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
    expect(realErrors(errors)).toEqual([]);
  });
});

test.describe('OpenAISection keyboard-nav baseline (placeholder)', () => {
  test.skip(
    'navigates by keyboard through 50 OpenAI keys',
    async () => {
      // Virtualization itself is in via @tanstack/react-virtual (see
      // VirtualizedProviderList in src/components/providers/OpenAISection/
      // OpenAISection.tsx) — the DOM-resident card count is now bounded
      // by viewport rather than by configs.length. The remaining work
      // here is the multi-provider browser fixture: bypassLoginViaForm
      // currently mocks /config but does not seed a 50-provider
      // openai-compatibility list. Until that fixture is wired, Tab/
      // Enter step-latency and FPS-per-scroll cannot be measured in CI.
      // Codex Stage 1 exit review FE-1: virtualization implemented;
      // keyboard-nav FPS measurement deferred to a follow-up that adds
      // the fixture seam. Track in bench/inventory if reopened.
    }
  );
});
