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
  // Write fresh perf capture to the .latest.json file (gitignored).
  // Merge — preserve any existing bundle section in latest so a prior
  // bundle-only capture is not lost by a subsequent Playwright run
  // (Codex Stage 1 exit round 2 FE-R2-4). The committed baseline acts
  // as a fallback scaffold only when latest does not exist yet, so
  // capture sections stay independent across runs.
  const latestPath = path.resolve(process.cwd(), BASELINE_FILE);
  const committedPath = path.resolve(process.cwd(), COMMITTED_BASELINE);
  let scaffold: Record<string, unknown> = {};
  if (fs.existsSync(latestPath)) {
    try {
      scaffold = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
    } catch {
      scaffold = {};
    }
  } else if (fs.existsSync(committedPath)) {
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
      // Virtualisation is in via @tanstack/react-virtual (see
      // VirtualizedProviderList in src/components/providers/OpenAISection/
      // OpenAISection.tsx). The list switches to single-column virtualised
      // rendering above OPENAI_VIRTUALIZATION_THRESHOLD (50 items); below
      // that, it falls back to the original CSS grid so typical-sized
      // installations keep their existing keyboard behaviour exactly
      // (Codex Stage 1 exit round 2 FE-R2-3 — preserve grid layout for
      // the typical case).
      //
      // Acceptable observable change above threshold: native Tab focus
      // can only reach cards inside the scroll viewport. Users scroll
      // to bring offscreen cards into reach; the virtualiser's overscan
      // (4 rows) keeps focus stable across short focus motions. This is
      // a documented trade-off (Codex Stage 1 exit round 2 FE-R2-2). A
      // follow-up that adds focus-aware scroll-into-view is tracked in
      // bench/inventory if reopened.
      //
      // The multi-provider browser fixture for FPS measurement is still
      // missing (bypassLoginViaForm mocks /config but does not seed 50+
      // openai-compatibility entries). Until that lands, Tab/Enter
      // step-latency and FPS-per-scroll are not measured in CI.
    }
  );
});
