import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../src/i18n/index';
import { QuotaTimeline } from '../src/features/quota/components/QuotaTimeline';
import type { QuotaFileEntry } from '../src/features/quota/logic';
import { buildKimiQuotaRows } from '../src/utils/quota';

const entries: QuotaFileEntry[] = [
  {
    file: { name: 'weekly-only.json', type: 'claude' },
    type: 'claude',
  },
];

const baseProps = {
  entries,
  displayNameFor: (name: string) => name,
  resolvedTheme: 'light' as const,
  now: new Date(2026, 6, 29, 12).getTime(),
};

describe('QuotaTimeline rendering', () => {
  test('keeps the panel and controls visible when 5-hour mode has no matching lanes', () => {
    const weeklyOnlyQuota = {
      status: 'success' as const,
      windows: [
        {
          label: '7-day',
          usedPercent: 25,
          resetAtMs: new Date(2026, 7, 1, 12).getTime(),
          periodHours: 168,
        },
      ],
    };

    const markup = renderToStaticMarkup(
      createElement(QuotaTimeline, {
        ...baseProps,
        initialMode: 'session',
        quotaFor: () => weeklyOnlyQuota,
      })
    );

    expect(markup).toContain('<section');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('role="status"');
  });

  test('renders a Kimi 5-hour lane from the protobuf-style time unit', () => {
    const rows = buildKimiQuotaRows({
      usage: {
        used: '1',
        limit: '100',
        resetTime: '2099-08-06T13:59:23.136523Z',
      },
      limits: [
        {
          window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
          detail: {
            used: '2',
            limit: '100',
            resetTime: '2099-07-31T06:59:23.136523Z',
          },
        },
      ],
    });

    const markup = renderToStaticMarkup(
      createElement(QuotaTimeline, {
        entries: [
          {
            file: { name: 'kimi-real-response.json', type: 'kimi' },
            type: 'kimi',
          },
        ],
        displayNameFor: (name: string) => name,
        resolvedTheme: 'light',
        now: new Date('2099-07-31T04:40:00Z').getTime(),
        initialMode: 'session',
        quotaFor: () => ({ status: 'success', rows }),
      })
    );

    expect(markup).toContain('kimi-real-response.json');
    expect(markup).not.toContain('role="status"');
  });

  test('stays hidden before any credential exposes a usable quota window', () => {
    const markup = renderToStaticMarkup(
      createElement(QuotaTimeline, {
        ...baseProps,
        quotaFor: () => undefined,
      })
    );

    expect(markup).toBe('');
  });
});
