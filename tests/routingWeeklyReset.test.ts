import { afterAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import { buildRoutingPlan, draftFromBoard, resolveRoute } from '../src/features/routing/logic';
import { PolicyPanel } from '../src/features/routing/components/PolicyPanel';
import {
  buildRoutingBoard,
  buildRoutingConfigPatch,
  readRoutingSettings,
} from '../src/services/api/routing';
import { ROUTING_STRATEGIES, isWeightedRoutingStrategy } from '../src/types/routing';

// Fork: the routing board must keep the weekly-reset strategy, or saving it resets production
// routing to round-robin.
const RAW = {
  routing: { strategy: 'weekly-reset-weighted-round-robin', 'session-affinity': true },
  'api-keys': {
    codex: [
      {
        name: 'pool',
        keys: [{ 'api-key': 'sk-codex-aaaa', weight: 3 }, { 'api-key': 'sk-codex-bbbb' }],
      },
    ],
  },
};
const catalog = { channels: { codex: ['gpt-5'] }, credentials: {} };

const initialLanguage = i18n.language;
afterAll(async () => {
  await i18n.changeLanguage(initialLanguage);
});

describe('weekly-reset routing strategy on the routing board', () => {
  test('reads both config spellings and offers the strategy', () => {
    expect(readRoutingSettings(RAW).strategy).toBe('weekly-reset-weighted-round-robin');
    expect(readRoutingSettings({ routing: { strategy: 'weekly-reset-wrr' } }).strategy).toBe(
      'weekly-reset-weighted-round-robin'
    );
    expect(ROUTING_STRATEGIES).toContain('weekly-reset-weighted-round-robin');
    expect(isWeightedRoutingStrategy('weekly-reset-weighted-round-robin')).toBe(true);
    expect(isWeightedRoutingStrategy('round-robin')).toBe(false);
  });

  test('an untouched strategy is not written back', () => {
    const board = buildRoutingBoard(RAW, []);
    const draft = draftFromBoard(board);
    draft.settings = { ...draft.settings, sessionAffinity: false };
    const plan = buildRoutingPlan(board, draft);
    expect(plan.settings).toEqual({ sessionAffinity: false });
    expect(buildRoutingConfigPatch(RAW, board, plan)).toEqual({
      routing: { 'session-affinity': false },
    });
  });

  test('switching to it writes the canonical name', () => {
    const board = buildRoutingBoard({ ...RAW, routing: { strategy: 'round-robin' } }, []);
    const draft = draftFromBoard(board);
    draft.settings = { ...draft.settings, strategy: 'weekly-reset-weighted-round-robin' };
    const plan = buildRoutingPlan(board, draft);
    expect(buildRoutingConfigPatch(RAW, board, plan)).toEqual({
      routing: { strategy: 'weekly-reset-weighted-round-robin' },
    });
  });

  test('splits a tier by weight, like weighted round-robin', () => {
    const board = buildRoutingBoard(RAW, []);
    const preview = resolveRoute(board, draftFromBoard(board), catalog, null, 0);
    expect(preview.tiers[0].members.map((member) => member.share)).toEqual([75, 25]);
  });

  test('the strategy picker shows it as selected with its description', async () => {
    await i18n.changeLanguage('en');
    const html = renderToStaticMarkup(
      createElement(PolicyPanel, {
        settings: readRoutingSettings(RAW),
        onChange: () => {},
      })
    );
    expect(html).toMatch(/role="radio" aria-checked="true" tabindex="0"[^>]*>.*Reset weighted round-robin</);
    expect(html).toContain('weekly quota resets within 36 hours');
  });
});
