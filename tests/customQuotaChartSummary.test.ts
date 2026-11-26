import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import '@/custom/i18n';
import type { OverviewProviderPool } from '@/custom/quotaOverview/model';
import { fableColor } from '@/custom/quotaOverview/model';
import {
  PoolChart,
  providerChartColor,
  type PoolChartProps,
} from '@/custom/quotaOverview/PoolChart';
import type { PoolAccount } from '@/custom/quotaOverview/poolForecast';

const NOW = 1_800_000_000_000;
const account = (key: string, remaining: number): PoolAccount => ({
  key,
  name: key,
  label: key,
  priority: 0,
  enabled: true,
  remaining,
  resetAtMs: NOW + 86_400_000,
  periodMs: 604_800_000,
  blockedUntilMs: null,
  samples: [[NOW, remaining, NOW + 86_400_000]],
});
const claude: OverviewProviderPool = {
  provider: 'claude',
  credentialCount: 3,
  accounts: [account('a', 98), account('b', 97), account('c', 96)],
  fableAccounts: [account('fa', 95), account('fb', 94), account('fc', 93)],
};
const codex: OverviewProviderPool = {
  provider: 'codex',
  credentialCount: 2,
  accounts: [account('x', 60), account('y', 40)],
  fableAccounts: [],
};
const base: PoolChartProps = {
  pools: [claude, codex],
  nowMs: NOW,
  rangeStartMs: NOW - 86_400_000,
  rangeEndMs: NOW + 604_800_000,
  mode: 'remaining',
  scale: 'share',
  burnHours: 3,
  futureUsage: 'current',
  routing: 'soonest-reset-first',
  resolvedTheme: 'light',
};
const render = (patch: Partial<PoolChartProps> = {}) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: i18n.cloneInstance({ lng: 'en', initImmediate: false }) },
      createElement(PoolChart, { ...base, ...patch })
    )
  );
const tiles = (html: string) => html.match(/<button[^>]*>.*?<\/button>/g) ?? [];

describe('pool chart summary tiles', () => {
  test('shows one tile per pool, plus Fable, each with its share and pooled total', () => {
    const [claudeTile, fableTile, codexTile, ...rest] = tiles(render());
    expect(rest).toHaveLength(0);
    expect(claudeTile).toContain('Claude');
    expect(claudeTile).toContain('>97%</span>');
    expect(claudeTile).toContain('291 of 300%');
    expect(fableTile).toContain('Fable');
    expect(fableTile).toContain('>94%</span>');
    expect(fableTile).toContain('282 of 300%');
    expect(codexTile).toContain('Codex');
    expect(codexTile).toContain('>50%</span>');
    expect(codexTile).toContain('100 of 200%');
  });

  test('pooled scale shows summed percent against each capacity', () => {
    const [claudeTile, fableTile, codexTile] = tiles(render({ scale: 'pooled' }));
    expect(claudeTile).toContain('>291%</span>');
    expect(claudeTile).toContain('of 300%');
    expect(fableTile).toContain('>282%</span>');
    expect(codexTile).toContain('>100%</span>');
    expect(codexTile).toContain('of 200%');
  });

  test('keeps provider line colors and logos, with Fable in its own color', () => {
    const html = render();
    const [claudeTile, fableTile, codexTile] = tiles(html);
    expect(claudeTile).toContain(`--series-color:${providerChartColor('claude', 'light')}`);
    expect(claudeTile).toContain('<img');
    expect(codexTile).toContain(`--series-color:${providerChartColor('codex', 'light')}`);
    expect(codexTile).toContain('<img');
    expect(fableTile).toContain(`--series-color:${fableColor('light')}`);
  });

  test('marks hidden lines as unpressed and keeps the rest pressed', () => {
    const [claudeTile, fableTile, codexTile] = tiles(render({ hidden: ['claude:fable'] }));
    expect(claudeTile).toContain('aria-pressed="true"');
    expect(fableTile).toContain('aria-pressed="false"');
    expect(codexTile).toContain('aria-pressed="true"');
  });

  test('omits the Fable tile when no Fable allowance is reported', () => {
    const html = render({ pools: [{ ...claude, fableAccounts: [] }] });
    expect(tiles(html)).toHaveLength(1);
    expect(html).not.toContain('Fable');
  });

  test('reports unloaded credentials, and a pool with none loaded as a static tile', () => {
    const html = render({
      pools: [
        { ...claude, credentialCount: 4 },
        { ...codex, accounts: [] },
      ],
    });
    expect(html).toContain('1 not loaded');
    expect(tiles(html)).toHaveLength(2);
    expect(html).toContain('Quota not loaded');
  });

  test('labels the chart with every pool in one summary', () => {
    const html = render();
    expect(html).toContain(
      'aria-label="Pooled weekly quota: Claude 291% of 300% left, Fable 282% of 300% left, Codex 100% of 200% left.'
    );
  });
});
