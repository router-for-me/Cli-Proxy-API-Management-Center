import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import { buildPoolForecast } from '../src/features/quota/forecast/model';
import { PoolForecastCard } from '../src/features/quota/forecast/PoolForecastCard';
import type { ForecastPool } from '../src/features/quota/forecast/pools';

const HOUR = 60 * 60 * 1000;
const now = new Date(2026, 10, 26, 12).getTime();
const from = now - 3 * 24 * HOUR;
const to = now + 11 * 24 * HOUR;

const pool: ForecastPool = {
  provider: 'antigravity',
  plans: [{ key: 'antigravity:pro', plan: 'pro', weight: 1, defaultWeight: 1, count: 1 }],
  unrecordedCount: 0,
  accounts: [
    {
      key: 'antigravity-a.json',
      name: 'a',
      weight: 1,
      periodMs: 7 * 24 * HOUR,
      samples: [
        { t: now - 2 * HOUR, used: 20, resetAt: now + 3 * 24 * HOUR },
        { t: now - HOUR, used: 30, resetAt: now + 3 * 24 * HOUR },
      ],
    },
  ],
};

const render = (compact: boolean) =>
  renderToStaticMarkup(
    createElement(PoolForecastCard, {
      pool,
      forecast: buildPoolForecast(pool.accounts, {
        now,
        from,
        to,
        burnWindowHours: 1,
        futureUsage: 'same',
        horizon: to,
      }),
      view: 'remaining',
      burnWindowHours: 1,
      showAccounts: false,
      from,
      to,
      now,
      horizon: to,
      resolvedTheme: 'dark',
      planLabel: (plan) => plan,
      compact,
    })
  );

const chartHeight = (markup: string) => Number(/height:(\d+)px/.exec(markup)?.[1]);

describe('PoolForecastCard', () => {
  let previous = '';
  beforeAll(() => {
    previous = i18n.language;
    return i18n.changeLanguage('en');
  });
  afterAll(() => i18n.changeLanguage(previous));

  test('a compact pool drops the repeated "First empty" stat and uses a shorter chart', () => {
    const full = render(false);
    const compact = render(true);
    expect(full).toContain('First empty');
    expect(compact).not.toContain('First empty');
    expect(compact).toContain('Pool empty');
    expect(chartHeight(compact)).toBeLessThan(chartHeight(full) * 0.7);
  });
});
