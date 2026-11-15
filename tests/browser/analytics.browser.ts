import { test, expect } from './analyticsHarness';
import type { AnalyticsScenario } from '../fixtures/analyticsUi';
import { analyticsViewports } from './analyticsViewports';

const tabs = ['Overview', 'Tokens & Cache', 'Cost', 'Performance', 'Requests', 'Model Rates'];

test('all controls, keyboard drilldown, paging, details and model schedules', async ({
  page,
  app,
}) => {
  await app.login();
  await app.loaded();
  for (const name of tabs) await app.tab(name);
  await page
    .locator('summary')
    .filter({ hasText: /^Rate details$/ })
    .first()
    .click();
  await expect(page.getByText('fast: $6.00 / $30.00', { exact: true })).toBeVisible();
  await expect(page.getByText(/Offline synthetic source/)).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('expanded-rates.png'),
    animations: 'disabled',
  });
  // The first-token chart has unmeasured hours, so its table must say Unavailable.
  await app.tab('Performance');
  const alternative = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: /^p95 reported TTFT/ }) })
    .locator('details');
  await alternative.locator('summary').click();
  await expect(alternative.locator('table')).toBeVisible();
  await expect(alternative.locator('table')).toContainText('Unavailable');
  await page.screenshot({
    path: test.info().outputPath('chart-table.png'),
    animations: 'disabled',
  });
  await app.tab('Requests');
  const details = page.getByRole('button', { name: 'Open event synthetic-event-2', exact: true });
  await details.click();
  await expect(page.getByRole('dialog')).toContainText('192.0.2.10');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(details).toBeFocused();
  await app.change(() => page.getByRole('button', { name: 'Next', exact: true }).click());
  expect(app.queries.at(-1)?.before_id).toBe(1);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await app.change(() => page.getByRole('button', { name: 'Previous', exact: true }).click());
  expect(app.queries.at(-1)?.before_id).toBeUndefined();
  await app.change(() =>
    page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('claude')
  );
  await app.change(() =>
    page.getByRole('combobox', { name: 'Model', exact: true }).selectOption('fixture-model')
  );
  await page.getByRole('searchbox').fill('synthetic-trace');
  await app.change(() => page.getByRole('button', { name: 'Apply', exact: true }).click());
  await app.tab('Overview');
  const bar = page.locator('svg rect[role=button]').first();
  await bar.focus();
  await expect(page.locator('output').first()).toContainText('UTC');
  await app.change(() => page.keyboard.press('Enter'));
  await expect(page.getByRole('tab', { name: 'Requests', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  expect(app.queries.at(-1)).toMatchObject({
    provider: 'claude',
    model: 'fixture-model',
    search: 'synthetic-trace',
  });
  expect(app.queries.at(-1)!.to_ms - app.queries.at(-1)!.from_ms).toBe(3_600_000);
  await app.change(() => page.getByRole('button', { name: 'Refresh', exact: true }).click());
  expect(app.queries.at(-1)!.to_ms - app.queries.at(-1)!.from_ms).toBe(86_400_000);
  await app.change(() => page.getByRole('button', { name: 'Clear filters', exact: true }).click());
  expect(app.queries.at(-1)?.provider).toBeUndefined();
  for (const [range, span] of [
    ['Last hour', 3_600_000],
    ['Last 7 days', 604_800_000],
    ['Last 30 days', 2_592_000_000],
  ] as const) {
    await app.change(() => page.getByRole('button', { name: range, exact: true }).click());
    expect(app.queries.at(-1)!.to_ms - app.queries.at(-1)!.from_ms).toBe(span);
    await expect(page.getByRole('button', { name: range, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  }
  // A chosen bucket size overrides the range's automatic one and survives a range change.
  expect(app.queries.at(-1)!.granularity).toBe('day');
  await app.change(() => page.getByRole('button', { name: 'Hourly', exact: true }).click());
  expect(app.queries.at(-1)!.granularity).toBe('hour');
  await expect(page.getByText('Current bucket: hour')).toBeVisible();
  // Today and Yesterday are UTC calendar days; the harness clock is 2026-10-29 12:00 UTC.
  const midnight = Date.UTC(2026, 9, 29);
  await app.change(() => page.getByRole('button', { name: 'Yesterday', exact: true }).click());
  expect(app.queries.at(-1)).toMatchObject({
    from_ms: midnight - 86_400_000,
    to_ms: midnight,
    granularity: 'hour',
  });
  await app.change(() => page.getByRole('button', { name: 'Auto', exact: true }).click());
  await app.change(() => page.getByRole('button', { name: 'Today', exact: true }).click());
  expect(app.queries.at(-1)!.from_ms).toBe(midnight);
  await app.change(() =>
    page.getByRole('combobox', { name: 'Recorded outcome', exact: true }).selectOption('failed')
  );
  await expect(page.locator('tbody')).toContainText('Failed');
});

for (const width of [1440, 1024, 390]) {
  test(`visual matrix at ${width}px`, async ({ page, app }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    app.scenario = 'large';
    await app.login();
    await app.loaded();
    for (const name of tabs) {
      await app.tab(name);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      const metrics = await page.locator('article[class*=metric] strong').evaluateAll((els) =>
        els.map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            height: rect.height,
            line: parseFloat(getComputedStyle(el).lineHeight),
            width: rect.width,
            scroll: el.scrollWidth,
          };
        })
      );
      expect(metrics.every((m) => m.height <= m.line + 1 && m.scroll <= m.width + 1)).toBe(true);
      if (name === 'Model Rates') {
        expect(
          await page
            .locator('table[class*=rates] td:nth-child(n+5):nth-child(-n+8)')
            .evaluateAll((els) =>
              els.every((el) => {
                const range = document.createRange();
                range.selectNodeContents(el);
                // One line of text: all boxes, including screen-reader text, sit on one line box.
                const tops = [...range.getClientRects()].map((r) => r.top);
                return Math.max(...tops) - Math.min(...tops) < 8;
              })
            )
        ).toBe(true);
      }
      if (name === 'Requests') {
        expect(
          await page
            .locator('td:last-child button')
            .evaluateAll((els) => els.every((el) => getComputedStyle(el).whiteSpace === 'nowrap'))
        ).toBe(true);
      }
      await page.screenshot({
        path: info.outputPath(`${name.replaceAll(' ', '-')}.png`),
        animations: 'disabled',
      });
      // Inspect lower charts/tables too; the app scrolls inside main, not the document.
      await page
        .locator('#analytics-panel')
        .evaluate((el) => el.lastElementChild?.scrollIntoView({ block: 'end' }));
      await page.screenshot({
        path: info.outputPath(`${name.replaceAll(' ', '-')}-bottom.png`),
        animations: 'disabled',
      });
      await page.getByRole('heading', { name: 'Analytics', exact: true }).scrollIntoViewIfNeeded();
    }
    await app.tab('Requests');
    await page.getByRole('button', { name: 'Open event synthetic-event-2', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // Long failure text and unbroken ids wrap inside the dialog instead of widening it.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Response trace ID');
    expect(
      await dialog.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll('dd, dd *')].every(
          (child) => child.getBoundingClientRect().right <= box.right + 1
        );
      })
    ).toBe(true);
    await page.screenshot({ path: info.outputPath('details.png'), animations: 'disabled' });
    await page
      .getByRole('dialog')
      .locator('dl')
      .last()
      .evaluate((el) => el.lastElementChild?.scrollIntoView({ block: 'end' }));
    await page.screenshot({ path: info.outputPath('details-bottom.png'), animations: 'disabled' });
    await page.keyboard.press('Escape');
  });
}

test('request detail shows the search-matched fields and copies the ids', async ({
  page,
  app,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  app.scenario = 'large';
  await app.login();
  await app.loaded();
  await app.tab('Requests');
  await page.getByRole('button', { name: 'Open event synthetic-event-2', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const failure = dialog.getByRole('region', { name: 'Failure text', exact: true });
  await expect(failure).toContainText('END-OF-FAILURE');
  // Long failure text scrolls inside its own keyboard-reachable region.
  await failure.focus();
  await expect(failure).toBeFocused();
  expect(await failure.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  for (const [label, text] of [
    ['Response trace ID', 'synthetic-header-trace-'],
    ['Credential file', 'synthetic-credential-file-'],
  ]) {
    await dialog.getByRole('button', { name: `Copy ${label}`, exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(text);
  }
  await page.keyboard.press('Escape');
});

for (const scenario of ['empty', 'unknown', 'zero'] as AnalyticsScenario[]) {
  test(`${scenario} data stays truthful`, async ({ page, app }, info) => {
    app.scenario = scenario;
    await app.login();
    await app.loaded();
    for (const name of ['Overview', 'Performance', 'Requests', 'Model Rates']) {
      await app.tab(name);
      await page.screenshot({ path: info.outputPath(`${name}.png`), animations: 'disabled' });
    }
    if (scenario === 'empty') {
      await expect(page.getByText('No model rates or registrations were returned.')).toBeVisible();
      await app.tab('Requests');
      await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    } else {
      await app.tab('Performance');
      const values = page.locator('article[class*=metric] strong');
      await expect(values).toHaveText(
        scenario === 'unknown' ? ['Unavailable', 'Unavailable', 'Unavailable'] : ['0', '0', '0']
      );
    }
  });
}

test('loading, error, retry and obsolete responses', async ({ page, app }, info) => {
  app.hold = true;
  await app.login();
  await expect(page.getByText('Loading analytics…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('loading.png'), animations: 'disabled' });
  await expect.poll(() => app.pending.length).toBeGreaterThan(0);
  app.release();
  await app.loaded();
  for (const status of [503, 404, 500]) {
    app.status = status;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.locator('article[class*=metric]')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`error-${status}.png`), animations: 'disabled' });
    if (status === 503) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: info.outputPath('error-mobile.png'), animations: 'disabled' });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    app.status = 200;
    await app.change(() => page.getByRole('button', { name: 'Retry', exact: true }).click());
  }
  app.hold = true;
  await page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('claude');
  await expect.poll(() => app.pending.length).toBeGreaterThan(0);
  await expect(
    page
      .getByRole('combobox', { name: 'Provider', exact: true })
      .getByRole('option', { name: 'codex', exact: true })
  ).toHaveCount(1);
  await expect(
    page.getByRole('combobox', { name: 'Model', exact: true }).locator('option')
  ).toHaveCount(3);
  app.hold = false;
  await app.change(() =>
    page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('codex')
  );
  await app.tab('Requests');
  await expect(page.locator('tbody')).toContainText('GPT / Codex');
  const settled = app.settled;
  app.release();
  await expect.poll(() => app.settled).toBeGreaterThan(settled);
  await expect(page.locator('#analytics-panel')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('tbody')).not.toContainText('Claude');
});

test('chart inspection follows the selected metric instead of retaining an old value', async ({
  page,
  app,
}) => {
  await app.login();
  await app.loaded();
  const chart = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'By provider · Retained events', exact: true }),
  });
  await chart.getByRole('button', { name: /^Claude: / }).focus();
  await expect(chart.locator('output')).toHaveText('Claude: 128');
  await app.tab('Tokens & Cache');
  const changed = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'By provider · Reported output tokens', exact: true }),
  });
  await expect(changed.locator('output')).toHaveText('Claude: 12,500');
});

test('logging out while analytics is pending hides the previous session', async ({ page, app }) => {
  await app.login();
  await app.loaded();
  app.hold = true;
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => app.pending.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Logout', exact: true }).click();
  await expect(page.locator('input[type=password]')).toBeVisible();
  const settled = app.settled;
  app.release();
  await expect.poll(() => app.settled).toBeGreaterThan(settled);
  await expect(page.locator('#analytics-panel')).toHaveCount(0);
});

// The page opens on its first chart: header, filters, tabs and cards fit above it, at every
// desktop window size and with the sidebar open or collapsed.
for (const { width, height } of analyticsViewports.filter((size) => size.width >= 1024)) {
  for (const sidebar of ['open', 'collapsed'] as const) {
    test(`first chart is on screen at ${width}x${height}, sidebar ${sidebar}`, async ({
      page,
      app,
    }) => {
      await page.setViewportSize({ width, height });
      app.scenario = 'large';
      await app.login();
      await app.loaded();
      if (sidebar === 'collapsed') await page.locator('.sidebar-toggle-floating').click();
      // The raised title is painted, not clipped by the shell or hidden under its controls.
      const title = await page
        .getByRole('heading', { name: 'Analytics', level: 1 })
        .evaluate((h1) => {
          const box = h1.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + 8, box.top + box.height / 2);
          return { top: box.top, painted: !!hit && h1.contains(hit) };
        });
      expect(title.painted, 'title is visible').toBe(true);
      expect(title.top).toBeGreaterThanOrEqual(0);
      // Filter buttons match the fields beside them.
      const heights = await page
        .locator('section[aria-label="Shared filters"] :is(select, input, button)')
        .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
      expect(new Set(heights).size, `control heights ${heights}`).toBe(1);
      // Clear filters and Refresh stay together on one row.
      const actionTops = await Promise.all(
        ['Clear filters', 'Refresh'].map((name) =>
          page
            .getByRole('button', { name, exact: true })
            .evaluate((el) => Math.round(el.getBoundingClientRect().top))
        )
      );
      expect(actionTops[0], 'Clear filters and Refresh share a row').toBe(actionTops[1]);
      for (const name of ['Overview', 'Tokens & Cache']) {
        await app.tab(name);
        const bottom = await page
          .locator('[class*=trendTime]')
          .first()
          .evaluate((el) => el.getBoundingClientRect().bottom);
        expect(bottom, `${name} chart bottom`).toBeLessThanOrEqual(height);
      }
    });
  }
}

for (const { width, height } of analyticsViewports) {
  test(`filters and cards fit at ${width}x${height}`, async ({ page, app }) => {
    await page.setViewportSize({ width, height });
    app.scenario = 'large';
    await app.login();
    await app.loaded();
    if (width <= 700) {
      await page.getByRole('button', { name: 'Shared filters', exact: true }).click();
    }
    const layout = await page.evaluate(() => {
      const filters = document.querySelector('section[aria-label="Shared filters"]');
      if (!filters) throw new Error('Missing shared filters');
      const controls = [...filters.querySelectorAll('input,select,button')];
      const rects = controls.map((el) => el.getBoundingClientRect());
      const cards = [...document.querySelectorAll('[class*="metricValue"]')];
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        targets: rects.map((r) => Math.min(r.width, r.height)),
        outside: rects.some((r) => r.left < 0 || r.right > innerWidth),
        overlaps: rects.some((a, i) =>
          rects
            .slice(i + 1)
            .some(
              (b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
            )
        ),
        clippedValues: cards.filter((el) => el.scrollWidth > el.clientWidth + 1).length,
      };
    });
    expect(layout.overflow).toBe(false);
    expect(layout.outside).toBe(false);
    expect(layout.overlaps).toBe(false);
    expect(layout.clippedValues).toBe(0);
    expect(Math.min(...layout.targets)).toBeGreaterThanOrEqual(width <= 700 ? 44 : 24);
  });
}

test.describe('touch tablet', () => {
  test.use({ hasTouch: true });
  test('filters and disclosures retain touch targets at 1024px', async ({ page, app }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await app.login();
    await app.loaded();
    await app.tab('Tokens & Cache');
    const targets = await page
      .locator('main button, main select, main input, main summary')
      .evaluateAll((els) =>
        els
          .filter((el) => el.checkVisibility())
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { text: el.textContent, size: Math.min(r.width, r.height) };
          })
      );
    expect(targets.filter((target) => target.size < 44)).toEqual([]);
    const details = page.getByText('Measurement details', { exact: true });
    await details.focus();
    await expect(details).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Legacy data cannot establish/)).toBeVisible();
  });
});

for (const width of [320, 390, 600]) {
  test(`phone filters keep KPIs visible and preserve state at ${width}px`, async ({
    page,
    app,
  }) => {
    await page.setViewportSize({ width, height: 568 });
    app.scenario = 'large';
    await app.login();
    await app.loaded();
    const toggle = page.getByRole('button', { name: 'Shared filters', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    for (const name of ['Overview', 'Tokens & Cache']) {
      await app.tab(name);
      const bottom = await page
        .locator('article[class*=metric] strong')
        .first()
        .evaluate((el) => el.getBoundingClientRect().bottom);
      expect(bottom).toBeLessThanOrEqual(568);
    }
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await app.change(() =>
      page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('claude')
    );
    const search = page.getByRole('searchbox');
    await search.fill('draft search');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await expect(toggle).toContainText('Last 24 hours · 1 active');
    await expect(page.getByRole('combobox', { name: 'Provider', exact: true })).toBeHidden();
    await page.keyboard.press('Space');
    await expect(page.getByRole('combobox', { name: 'Provider', exact: true })).toHaveValue(
      'claude'
    );
    await expect(search).toHaveValue('draft search');
    // Desktop always exposes filters even when the phone disclosure was closed.
    await toggle.click();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(toggle).toBeHidden();
    await expect(page.getByRole('combobox', { name: 'Provider', exact: true })).toBeVisible();
  });
}

test('the shell top fade waits for scrolling, so the raised title stays readable', async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 2293, height: 840 });
  app.scenario = 'large';
  await app.login();
  await app.loaded();
  const fade = page.locator('.top-gradient-blur');
  await expect.poll(() => fade.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await page.locator('.content').evaluate((el) => el.scrollBy(0, 300));
  await expect.poll(() => fade.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
});

test('the last view comes back after a reload and a fresh sign-in', async ({ page, app }) => {
  await app.login();
  await app.loaded();
  await app.tab('Tokens & Cache');
  await app.change(() => page.getByRole('button', { name: 'Last 7 days', exact: true }).click());
  await app.change(() => page.getByRole('button', { name: 'Hourly', exact: true }).click());
  await app.change(() =>
    page.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('claude')
  );
  await app.change(() =>
    page.getByRole('combobox', { name: 'Recorded outcome', exact: true }).selectOption('failed')
  );
  await page.getByRole('searchbox').fill('synthetic-trace');
  await app.change(() => page.getByRole('button', { name: 'Apply', exact: true }).click());
  const chosen = app.queries.at(-1)!;
  await page.goto('about:blank');
  await app.login();
  await app.loaded();
  await expect(page.getByRole('tab', { name: 'Tokens & Cache', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  for (const name of ['Last 7 days', 'Hourly'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  await expect(page.getByRole('combobox', { name: 'Provider', exact: true })).toHaveValue('claude');
  await expect(page.getByRole('searchbox')).toHaveValue('synthetic-trace');
  // The window is recomputed from the saved range; everything else is the same query.
  const restored = app.queries.at(-1)!;
  expect(restored).toMatchObject({
    provider: 'claude',
    outcome: 'failed',
    search: 'synthetic-trace',
    granularity: 'hour',
  });
  expect(restored.to_ms - restored.from_ms).toBe(chosen.to_ms - chosen.from_ms);
});

test('a collapsed sidebar stays collapsed after a reload', async ({ page, app }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await app.login();
  await app.loaded();
  await page.locator('.sidebar-toggle-floating').click();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-is-collapsed/);
  await page.goto('about:blank');
  await app.login();
  await app.loaded();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-is-collapsed/);
});

test('range and bucket live in the address, so a link opens that exact view', async ({
  page,
  app,
}) => {
  await app.login();
  await app.loaded();
  // Writing the view into the address never refetches it.
  await page.waitForTimeout(300);
  expect(app.queries).toHaveLength(1);
  await expect(page).toHaveURL(/[?&]range=24h(&|$)/);
  await app.change(() => page.getByRole('button', { name: 'Last 7 days', exact: true }).click());
  await app.change(() => page.getByRole('button', { name: 'Hourly', exact: true }).click());
  await expect(page).toHaveURL(/[?&]range=7d(&|$)/);
  await expect(page).toHaveURL(/[?&]bucket=hour(&|$)/);
  // Opening a link mounts the page straight into its view.
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  const before = app.queries.length;
  await app.change(() => page.goto('/#/analytics?tab=tokens&range=30d&bucket=day'));
  await page.waitForTimeout(300);
  expect(app.queries.length - before).toBe(1);
  await expect(page.getByRole('tab', { name: 'Tokens & Cache', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  for (const name of ['Last 30 days', 'Daily'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  expect(app.queries.at(-1)).toMatchObject({ granularity: 'day' });
  expect(app.queries.at(-1)!.to_ms - app.queries.at(-1)!.from_ms).toBe(2_592_000_000);
  // Changing the address while the page is open moves the data with it.
  await app.change(() => page.goto('/#/analytics?tab=tokens&range=yesterday&bucket=auto'));
  await expect(page.getByRole('button', { name: 'Yesterday', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(app.queries.at(-1)).toMatchObject({
    from_ms: Date.UTC(2026, 9, 28),
    to_ms: Date.UTC(2026, 9, 29),
    granularity: 'hour',
  });
});
