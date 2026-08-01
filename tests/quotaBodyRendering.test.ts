/**
 * Provider bodies rendered end-to-end.
 *
 * Bodies receive their class map as a prop and import no stylesheet, so unlike
 * QuotaCard they can be rendered directly here — which is the only place the
 * "absolute plus countdown" pairing is checked as actual markup rather than as
 * a formatter's return value.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { CodexQuotaBody } from '@/features/quota/providers/codex/CodexQuotaBody';
import { ClaudeQuotaBody } from '@/features/quota/providers/claude/ClaudeQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { formatInstantShort } from '@/utils/quota';
import { DAY_MS, HOUR_MS } from '@/utils/time/durations';
import type { ClaudeQuotaState, CodexQuotaState } from '@/types';

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test-host'
);

/**
 * useNow() freezes to module-load time under renderToStaticMarkup (it reads
 * getServerSnapshot), so instants are placed relative to the real clock.
 */
const now = Date.now();

// The i18n fallback is zh-CN; pin English so the countdown assertions read.
beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('CodexQuotaBody', () => {
  const quota: CodexQuotaState = {
    status: 'success',
    planType: 'pro',
    windows: [
      {
        id: 'primary',
        label: '5-hour limit',
        usedPercent: 38,
        resetLabel: '08-02 18:00',
        resetAtMs: now + 3 * HOUR_MS,
        periodHours: 5,
      },
    ],
    rateLimitResetCredits: [
      {
        id: 'credit-1',
        status: 'available',
        grantedAt: new Date(now - DAY_MS).toISOString(),
        expiresAt: new Date(now + 11 * DAY_MS).toISOString(),
      },
    ],
    rateLimitResetCreditsAvailableCount: 1,
  };

  test('renders a window reset as absolute plus countdown', () => {
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota, classes }));

    expect(markup).toContain('08-02 18:00');
    expect(markup).toContain('quotaResetRelative');
    expect(markup).toMatch(/3 hours/);
  });

  test('renders reset-credit expiry in local time with a countdown', () => {
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota, classes }));

    expect(markup).toContain(formatInstantShort(now + 11 * DAY_MS));
    expect(markup).toMatch(/11 days/);
  });

  test('highlights the credit when it expires before every window resets', () => {
    const creditFirst: CodexQuotaState = {
      ...quota,
      windows: [{ ...quota.windows[0], resetAtMs: now + 5 * DAY_MS }],
      rateLimitResetCredits: [
        {
          id: 'credit-1',
          status: 'available',
          grantedAt: new Date(now - DAY_MS).toISOString(),
          expiresAt: new Date(now + 2 * HOUR_MS).toISOString(),
        },
      ],
    };
    const markup = renderToStaticMarkup(
      createElement(CodexQuotaBody, { quota: creditFirst, classes })
    );

    expect(markup).toContain('codexResetCreditRowSoon');
    expect(markup).not.toContain('quotaRowSoon');
  });

  test('highlights the window when it resets before any credit expires', () => {
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota, classes }));

    expect(markup).toContain('quotaRowSoon');
    expect(markup).not.toContain('codexResetCreditRowSoon');
  });

  test('highlights nothing once every instant is in the past', () => {
    const stale: CodexQuotaState = {
      ...quota,
      windows: [{ ...quota.windows[0], resetAtMs: now - HOUR_MS }],
      rateLimitResetCredits: [],
      rateLimitResetCreditsAvailableCount: null,
    };
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota: stale, classes }));

    expect(markup).not.toContain('Soon');
  });

  test('keeps the baked label alone when the store entry predates resetAtMs', () => {
    const stale: CodexQuotaState = {
      ...quota,
      windows: [{ ...quota.windows[0], resetAtMs: undefined, periodHours: undefined }],
      rateLimitResetCredits: [],
      rateLimitResetCreditsAvailableCount: null,
    };
    const markup = renderToStaticMarkup(createElement(CodexQuotaBody, { quota: stale, classes }));

    expect(markup).toContain('08-02 18:00');
    expect(markup).not.toContain('quotaResetRelative');
  });
});

describe('ClaudeQuotaBody', () => {
  test('pairs each window reset with a countdown', () => {
    const quota: ClaudeQuotaState = {
      status: 'success',
      windows: [
        {
          id: 'five_hour',
          label: '5-hour',
          usedPercent: 12,
          resetLabel: '08-02 17:00',
          resetAtMs: now + 2 * HOUR_MS,
          periodHours: 5,
        },
        {
          id: 'seven_day',
          label: '7-day',
          usedPercent: 60,
          resetLabel: '08-06 04:00',
          resetAtMs: now + 4 * DAY_MS,
          periodHours: 168,
        },
      ],
    };
    const markup = renderToStaticMarkup(createElement(ClaudeQuotaBody, { quota, classes }));

    expect(markup).toContain('08-02 17:00');
    expect(markup).toContain('08-06 04:00');
    expect(markup).toMatch(/2 hours/);
    expect(markup).toMatch(/4 days/);
  });
});
