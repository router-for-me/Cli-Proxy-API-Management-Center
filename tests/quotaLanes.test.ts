import { describe, expect, test } from 'bun:test';
import { quotaSamples } from '../server/quota/collector';
import { buildClaudeQuotaWindows } from '../src/domain/quotaWindows/claude';
import { buildCodexQuotaWindows } from '../src/domain/quotaWindows/codex';
import { laneOf, poolWindowId, type PoolLane } from '../src/domain/quotaWindows/lanes';
import { buildTimelineLane } from '../src/features/quota/quotaTimelineModel';
import { CLAUDE_USAGE_WINDOW_KEYS } from '../src/utils/quota/constants';

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
const WEEKLY_RESET = NOW + 5 * 24 * HOUR;
const MODEL_RESET = NOW + 1 * 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();
const t = ((key: string) => key) as never;

// Every Claude 7-day window has a 168 h period, so the period tie-break alone
// picks whichever resets first: here Fable, which resets a day from now.
const claudeBody = {
  five_hour: { utilization: 10, resets_at: iso(NOW + 2 * HOUR) },
  seven_day: { utilization: 30, resets_at: iso(WEEKLY_RESET) },
  seven_day_opus: { utilization: 70, resets_at: iso(MODEL_RESET + HOUR) },
  seven_day_sonnet: { utilization: 60, resets_at: iso(MODEL_RESET + 2 * HOUR) },
  seven_day_cowork: { utilization: 50, resets_at: iso(MODEL_RESET + 3 * HOUR) },
  seven_day_oauth_apps: { utilization: 40, resets_at: iso(MODEL_RESET + 4 * HOUR) },
  limits: [
    {
      kind: 'weekly_scoped',
      percent: 80,
      is_active: true,
      resets_at: iso(MODEL_RESET),
      scope: { model: { display_name: 'Fable' } },
    },
  ],
};

const codexBody = {
  rate_limit: {
    primary_window: { used_percent: 10, limit_window_seconds: 18000, reset_at: WEEKLY_RESET / 1000 },
    secondary_window: { used_percent: 20, limit_window_seconds: 604800, reset_at: WEEKLY_RESET / 1000 },
  },
  code_review_rate_limit: {
    primary_window: { used_percent: 5, limit_window_seconds: 18000 },
    secondary_window: { used_percent: 6, limit_window_seconds: 604800 },
  },
  additional_rate_limits: [
    {
      limit_name: 'GPT-5.3-Codex-Spark',
      rate_limit: {
        primary_window: { used_percent: 1, limit_window_seconds: 18000 },
        secondary_window: { used_percent: 2, limit_window_seconds: 604800, reset_at: MODEL_RESET / 1000 },
      },
    },
    {
      limit_name: 'Team',
      rate_limit: {
        primary_window: { used_percent: 1, limit_window_seconds: 18000 },
        secondary_window: { used_percent: 2, limit_window_seconds: 30 * 86400 },
      },
    },
  ],
};

const claudeIds = () =>
  buildClaudeQuotaWindows(claudeBody as never, t).map((window) => window.id);
const codexIds = () => buildCodexQuotaWindows(codexBody as never, t).map((window) => window.id);
const codexMonthly = () =>
  buildCodexQuotaWindows(
    {
      rate_limit: {
        primary_window: { used_percent: 1, limit_window_seconds: 18000 },
        secondary_window: { used_percent: 2, limit_window_seconds: 30 * 86400 },
      },
    } as never,
    t
  ).map((window) => window.id);

describe('lane mapping', () => {
  const claudeKnown = [...CLAUDE_USAGE_WINDOW_KEYS.map(({ id }) => id), 'seven-day-fable'];
  const codexKnown = [...codexIds(), ...codexMonthly()];

  test('the fixtures exercise every id the builders can emit', () => {
    expect(new Set(claudeIds())).toEqual(new Set(claudeKnown));
    expect(codexKnown).toEqual(
      expect.arrayContaining([
        'five-hour',
        'weekly',
        'monthly',
        'code-review-five-hour',
        'code-review-weekly',
      ])
    );
    expect(codexKnown.filter((id) => /-\d+$/.test(id)).length).toBeGreaterThan(2);
  });

  test('every known id maps to exactly one lane, and none falls to other by accident', () => {
    const expected: Record<string, string> = {
      'five-hour': 'five-hour',
      'seven-day': 'weekly',
      'seven-day-opus': 'model',
      'seven-day-sonnet': 'model',
      'seven-day-fable': 'model',
      'seven-day-cowork': 'other',
      'seven-day-oauth-apps': 'other',
    };
    for (const id of claudeKnown) expect([id, laneOf('claude', id)]).toEqual([id, expected[id]]);
    for (const id of codexKnown) {
      const lane = laneOf('codex', id);
      if (id === 'five-hour' || id === 'weekly' || id === 'monthly') expect(lane).toBe(id);
      else expect([id, lane]).toEqual([id, 'model']);
    }
  });

  test('each provider has exactly one pool window per lane', () => {
    for (const [provider, ids] of [
      ['claude', claudeKnown],
      ['codex', codexKnown],
    ] as const) {
      for (const lane of ['weekly', 'five-hour'] as PoolLane[]) {
        const matches = [...new Set(ids)].filter((id) => laneOf(provider, id) === lane);
        expect(matches).toEqual([poolWindowId(provider, lane)]);
      }
    }
    expect(poolWindowId('claude', 'weekly')).toBe('seven-day');
    expect(poolWindowId('codex', 'weekly')).toBe('weekly');
  });

  test('an id of the other provider is not a pool window', () => {
    expect(laneOf('claude', 'weekly')).toBe('other');
    expect(laneOf('codex', 'seven-day')).toBe('other');
  });
});

describe('weekly lane when a model-scoped window resets first', () => {
  const weeklyOf = (provider: 'claude' | 'codex', body: unknown) =>
    quotaSamples(provider, 'account', body, NOW).samples.find(
      (sample) => sample.window === 'weekly'
    );

  test('collector samples: claude weekly is seven-day, not Fable', () => {
    const weekly = weeklyOf('claude', claudeBody);
    expect(weekly?.resetAtMs).toBe(WEEKLY_RESET);
    expect(weekly?.remainingPercent).toBe(70);
  });

  test('collector samples: codex weekly is the account window, not Spark', () => {
    const weekly = weeklyOf('codex', codexBody);
    expect(weekly?.resetAtMs).toBe(WEEKLY_RESET);
    expect(weekly?.remainingPercent).toBe(80);
  });

  const lane = (provider: 'claude' | 'codex', windows: unknown[], maxPeriodHours: number) =>
    buildTimelineLane({
      name: 'a.json',
      displayName: 'A',
      provider,
      quota: { status: 'success', windows } as never,
      maxPeriodHours,
    });

  test('timeline: claude weekly lane is seven-day, not Fable or Opus', () => {
    const built = buildClaudeQuotaWindows(claudeBody as never, t);
    const fortnight = lane('claude', built, 14 * 24);
    expect(fortnight.anchorMs).toBe(WEEKLY_RESET);
    expect(fortnight.remaining).toBe(70);
    // The session view still anchors on the five-hour window.
    expect(lane('claude', built, 3 * 24).anchorMs).toBe(NOW + 2 * HOUR);
  });

  test('timeline: codex weekly lane is the account window, not Spark', () => {
    const built = buildCodexQuotaWindows(codexBody as never, t);
    expect(lane('codex', built, 14 * 24).anchorMs).toBe(WEEKLY_RESET);
  });

  test('timeline: collector and timeline agree on the weekly window', () => {
    const claudeLane = lane('claude', buildClaudeQuotaWindows(claudeBody as never, t), 14 * 24);
    expect(claudeLane.anchorMs).toBe(weeklyOf('claude', claudeBody)?.resetAtMs ?? null);
  });
});
