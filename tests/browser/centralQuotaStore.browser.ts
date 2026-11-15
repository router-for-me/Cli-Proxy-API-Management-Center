/**
 * One quota store per hub, shared by every page: a Fable reset claimed on Auth Files is the
 * reading Quota (/quota/accounts) and Quota Management (/quota) show next, without either page
 * reading on its own. The real UI and the real prox-history run over a fake CLI-Proxy that holds
 * one Fable reset for carol and refills her windows when it is spent. Nothing here reaches a real
 * hub: the harness routes every request to loopback fakes and fails the test on anything else.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './credentialFlowHarness';

test.describe.configure({ timeout: 150_000 });

// Set PROX_EVIDENCE_DIR to keep the screenshots; a plain run only asserts.
const shoot = async (page: Page, name: string, focus?: Locator) => {
  const dir = process.env.PROX_EVIDENCE_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await focus?.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(dir, `${name}.png`) });
};

/** The Claude pool's section on Quota Management, where carol's held resets show. */
const claudePool = (page: Page): Locator => page.getByText('Claude · Claude / Claude Code');

const goto = async (page: Page, hash: string) => {
  await page.evaluate((target) => void (window.location.hash = target), hash);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#${hash}`);
};

/** carol's card on Auth Files: the nearest ancestor of her name that holds a quota slot. */
const filesCard = (page: Page): Locator =>
  page
    .getByText('carol', { exact: true })
    .locator('xpath=ancestor::*[.//section[@data-quota-state]][1]');

test('a Fable reset claimed on Auth Files shows on Quota and Quota Management without a re-read', async ({
  flow,
  context,
}) => {
  await flow.grantClaudeResets('claude-carol', 1);
  await flow.collect();
  const page = await flow.open(context, '/auth-files');

  // Auth Files reads carol's quota: 75% of the 5-hour window, 40% of the week, one Fable reset.
  const card = filesCard(page);
  await card.getByRole('button', { name: 'Refresh quota only for this credential' }).click();
  await expect(card).toContainText('1/1 left');
  await expect(card).toContainText('75%');
  await shoot(page, '1-auth-files-before-claim');

  // The Quota page shows that same reading at once; it never read carol itself.
  const usageBeforeQuotaPage = (await flow.state()).usageCalls;
  await goto(page, '/quota/accounts');
  // The first carol.json is her card's name; the timeline below repeats it.
  const quotaName = page.getByText('carol.json', { exact: true }).first();
  await expect(quotaName).toBeVisible();
  const accountCard = quotaName.locator('xpath=ancestor::*[contains(., "5-hour limit")][1]');
  await expect(accountCard).toContainText('75%');
  expect((await flow.state()).usageCalls).toBe(usageBeforeQuotaPage);
  await shoot(page, '2-quota-accounts-shares-the-reading');

  // Quota Management still shows the server's pre-claim reading: one Fable reset held.
  await goto(page, '/quota');
  await expect(page.getByRole('main')).toContainText('1 Fable');
  await shoot(page, '3-quota-management-before-claim', claudePool(page));

  // Claim it on Auth Files (the fake hub spends it and refills carol's windows).
  await goto(page, '/auth-files');
  await card.getByRole('button', { name: /^Use reset/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Use Fable reset' }).click();
  await expect.poll(async () => (await flow.state()).claims).toEqual(['claude-carol']);
  await expect(card).toContainText('0 held');
  await expect(card).toContainText('100%');
  await shoot(page, '4-auth-files-after-claim');

  // Quota shows the claim without reading carol on its own: the claim's forced read already
  // landed in the shared store.
  const usageAfterClaim = (await flow.state()).usageCalls;
  await goto(page, '/quota/accounts');
  await expect(accountCard).toContainText('100%');
  await expect(accountCard).not.toContainText('75%');
  expect((await flow.state()).usageCalls).toBe(usageAfterClaim);
  await shoot(page, '5-quota-accounts-after-claim');

  // The claim told prox-history to re-read carol (one targeted refresh), and Quota Management
  // shows that new reading: no resets held, her week refilled.
  expect(flow.proxRequests.filter((request) => request === 'POST refresh')).toHaveLength(1);
  await goto(page, '/quota');
  await expect(page.getByRole('main')).not.toContainText('1 Fable');
  await expect(page.getByRole('main')).toContainText('95.0%');
  await shoot(page, '6-quota-management-after-claim', claudePool(page));
});
