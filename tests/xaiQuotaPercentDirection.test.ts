/**
 * xAI quota rows: the printed percentage must agree with the meter beside it.
 *
 * The weekly and per-product rows derive both a used and a remaining value from
 * xAI's usage percentage. QuotaMeter is fed the remaining one, so the label has
 * to report remaining as well, the way Claude, Codex, Kimi, Antigravity, Meta
 * and the monthly credits row of this same card already do. Labelling from the
 * used value prints one number above a bar drawn from the other.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { XaiQuotaBody } from '@/features/quota/providers/xai/XaiQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { buildXaiBillingSummary } from '@/utils/quota';
import type { XaiBillingConfig, XaiQuotaState } from '@/types';

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test-host'
);

const weeklyConfig = (extra: XaiBillingConfig = {}): XaiBillingConfig => ({
  currentPeriod: {
    type: 'USAGE_PERIOD_TYPE_WEEKLY',
    start: '2026-09-22T10:11:39.397819+00:00',
    end: '2026-09-29T10:11:39.397819+00:00',
  },
  onDemandCap: { val: 0 },
  ...extra,
});

const render = (config: XaiBillingConfig): string => {
  const quota: XaiQuotaState = {
    status: 'success',
    billing: buildXaiBillingSummary(config),
  };
  return renderToStaticMarkup(createElement(XaiQuotaBody, { quota, classes }));
};

/** Meter fill widths, in render order. */
const meterWidths = (markup: string): string[] =>
  [...markup.matchAll(/quotaBarFill[^"]*"\s*style="width:([^;"]+)/g)].map((match) => match[1]);

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('XaiQuotaBody percentage direction', () => {
  test('the weekly label matches its meter', () => {
    const markup = render(weeklyConfig({ creditUsagePercent: 43 }));

    expect(markup).toContain('57% remaining');
    expect(meterWidths(markup)).toContain('57%');
    expect(markup).not.toContain('43%');
  });

  test('a product label matches its meter', () => {
    const markup = render(
      weeklyConfig({
        creditUsagePercent: 1,
        productUsage: [{ product: 'GrokBuild', usagePercent: 1 }],
      })
    );

    expect(markup).toContain('GrokBuild');
    expect(meterWidths(markup)).toEqual(['99%', '99%']);
    expect(markup).not.toContain('1% remaining');
  });

  // `>…<` anchors the label to its own element: "0% remaining" is a substring
  // of "100% remaining", so a bare toContain would pass on the wrong value.
  test.each([0, 1, 43, 100])('label and meter agree at %i percent used', (used) => {
    const markup = render(weeklyConfig({ creditUsagePercent: used }));

    expect(markup).toContain(`>${100 - used}% remaining<`);
    expect(meterWidths(markup)).toEqual([`${100 - used}%`]);
  });
});
