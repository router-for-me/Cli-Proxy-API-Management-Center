import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { ResetsCell, type ResetLine } from '@/features/quota/accounts/ResetsCell';
import {
  compactRemaining,
  fableUsedUp,
  meterTone,
  timeLeftParts,
} from '@/features/quota/accounts/rowModel';
import { summarizePools, type ForecastPool } from '@/features/quota/forecast/pools';
import type { PoolForecast } from '@/features/quota/forecast/model';
import { resetGrantKind, resetGrantLines } from '@/features/quota/providers/claude/resetGrantKinds';
import { selectResetGrant } from '@/features/quota/providers/claude/selectResetGrant';
import {
  parseAnthropicResetGrantStatus,
  parseSavedResetGrantStatus,
  type AnthropicResetGrant,
} from '@/services/api/claudeResetGrants';

const H = 60 * 60 * 1000;
const D = 24 * H;
const NOW = Date.UTC(2026, 10, 11, 8);
const iso = (ms: number) => new Date(ms).toISOString();

const grant = (overrides: Partial<AnthropicResetGrant> = {}): AnthropicResetGrant => ({
  id: 'general-a',
  label: '',
  resetsTotal: 1,
  resetsLeft: 1,
  startsAt: null,
  endsAt: iso(NOW + 35 * D),
  clears: ['five_hour', 'seven_day'],
  paused: false,
  usableNow: true,
  useRequiresLimit: false,
  givesBackWeekly: false,
  percentUsed: {},
  ...overrides,
});
const fable = (overrides: Partial<AnthropicResetGrant> = {}) =>
  grant({ id: 'fable-a', givesBackWeekly: true, endsAt: iso(NOW + 118 * D), ...overrides });

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('Claude reset kinds', () => {
  test('reads the Fable flag and rejects an unreadable one', () => {
    const raw = { id: 'g', resets_total: 1, resets_left: 1, usable_now: true };
    const parse = (fields: Record<string, unknown>) =>
      parseAnthropicResetGrantStatus({ eligible: true, grants: [{ ...raw, ...fields }] });
    expect(parse({})!.grants[0].givesBackWeekly).toBe(false);
    expect(parse({ gives_back_weekly: null })!.grants[0].givesBackWeekly).toBe(false);
    expect(parse({ gives_back_weekly: true })!.grants[0].givesBackWeekly).toBe(true);
    expect(parse({ gives_back_weekly: 'true' })).toBeNull();
    expect(resetGrantKind(parse({ gives_back_weekly: true })!.grants[0])).toBe('fable');
    expect(resetGrantKind(parse({})!.grants[0])).toBe('general');
  });

  test('groups banked resets by kind, general first, with the first expiry', () => {
    const lines = resetGrantLines(
      [
        fable({ resetsLeft: 2 }),
        fable({ id: 'fable-b', endsAt: iso(NOW + 20 * D) }),
        grant(),
        grant({ id: 'general-open', endsAt: null }),
      ],
      NOW
    );
    expect(lines).toEqual([
      { kind: 'general', count: 2, expiresAtMs: NOW + 35 * D },
      { kind: 'fable', count: 3, expiresAtMs: NOW + 20 * D },
    ]);
  });

  test('leaves out spent and expired grants, and a kind with nothing left', () => {
    expect(
      resetGrantLines([grant({ resetsLeft: 0 }), fable({ endsAt: iso(NOW - H) })], NOW)
    ).toEqual([]);
    expect(resetGrantLines([fable({ endsAt: null })], NOW)).toEqual([
      { kind: 'fable', count: 1, expiresAtMs: null },
    ]);
  });

  test('selects a grant of the requested kind only', () => {
    const status = {
      eligible: true,
      ineligibleReason: null,
      atLimit: true,
      grants: [fable(), grant(), grant({ id: 'general-b' })],
      nextGrantId: 'fable-a',
      weeklyResetsAt: null,
      cooldownUntil: null,
    };
    expect(selectResetGrant(status, NOW)?.id).toBe('fable-a');
    expect(selectResetGrant(status, NOW, 'fable')?.id).toBe('fable-a');
    // The recommendation is a Fable grant, so the general button falls back to ID order.
    expect(selectResetGrant(status, NOW, 'general')?.id).toBe('general-a');
    expect(selectResetGrant({ ...status, nextGrantId: 'general-b' }, NOW, 'general')?.id).toBe(
      'general-b'
    );
    expect(
      selectResetGrant({ ...status, grants: [grant()], nextGrantId: null }, NOW, 'fable')
    ).toBeUndefined();
  });
});

describe('saved reset grants', () => {
  // The backend's reset-grants.json record: times in Unix ms, no live usability flags.
  const saved = {
    checked_at: NOW,
    eligible: true,
    cooldown_until: 0,
    grants: [
      {
        id: 'general-a',
        resets_total: 1,
        resets_left: 1,
        ends_at: NOW + 35 * D,
        clears: ['seven_day'],
      },
      {
        id: 'fable-a',
        resets_total: 1,
        resets_left: 1,
        ends_at: NOW + 118 * D,
        gives_back_weekly: true,
      },
      { id: 'fable-b', resets_total: 1, resets_left: 0, gives_back_weekly: true, paused: true },
    ],
  };

  test('shows the saved grants by kind before any live read', () => {
    const status = parseSavedResetGrantStatus(saved);
    expect(status).not.toBeNull();
    expect(resetGrantLines(status!.grants, NOW)).toEqual([
      { kind: 'general', count: 1, expiresAtMs: NOW + 35 * D },
      { kind: 'fable', count: 1, expiresAtMs: NOW + 118 * D },
    ]);
    expect(selectResetGrant(status!, NOW, 'fable')?.id).toBe('fable-a');
  });

  test('ignores a record a claim made out of date, and malformed ones', () => {
    expect(parseSavedResetGrantStatus({ ...saved, stale: true })).toBeNull();
    expect(parseSavedResetGrantStatus(undefined)).toBeNull();
    expect(parseSavedResetGrantStatus({ ...saved, grants: [{ id: 'BAD ID' }] })).toBeNull();
  });
});

describe('compact time left', () => {
  test('whole days from two days, hours below, never more than remains', () => {
    expect(compactRemaining(118 * D + 5 * H)).toEqual({ unit: 'day', value: 118, under: false });
    expect(compactRemaining(2 * D)).toEqual({ unit: 'day', value: 2, under: false });
    expect(compactRemaining(2 * D - 1)).toEqual({ unit: 'hour', value: 47, under: false });
    expect(compactRemaining(H)).toEqual({ unit: 'hour', value: 1, under: false });
    expect(compactRemaining(H - 1)).toEqual({ unit: 'hour', value: 1, under: true });
    expect(compactRemaining(-H)).toEqual({ unit: 'hour', value: 1, under: true });
  });
});

describe('window meters', () => {
  test('plain until low, a warning while low, spent only at nothing left', () => {
    expect(meterTone(null)).toBe('normal');
    expect(meterTone(100)).toBe('normal');
    expect(meterTone(55)).toBe('normal');
    expect(meterTone(22)).toBe('normal');
    expect(meterTone(20)).toBe('normal');
    expect(meterTone(19.9)).toBe('low');
    expect(meterTone(11)).toBe('low');
    expect(meterTone(0.5)).toBe('low');
    // Shown as "0% left", so it reads as spent.
    expect(meterTone(0.4)).toBe('empty');
    expect(meterTone(0)).toBe('empty');
  });

  test('time left in its two largest units, never more than remains', () => {
    const M = 60 * 1000;
    expect(timeLeftParts(19 * H + 12 * M + 59_000)).toEqual({ days: 0, hours: 19, minutes: 12 });
    expect(timeLeftParts(2 * D)).toEqual({ days: 2, hours: 0, minutes: 0 });
    expect(timeLeftParts(5 * D + 10 * H + 59 * M)).toEqual({ days: 5, hours: 10, minutes: 59 });
    expect(timeLeftParts(59_000)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(timeLeftParts(-H)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });
});

describe('pool figures for the provider headers', () => {
  const pool = (provider: 'claude' | 'codex', accounts: number): ForecastPool => ({
    provider,
    accounts: Array.from({ length: accounts }, (_, index) => ({
      key: `${provider}-${index}`,
      name: `${provider}-${index}`,
      weight: 1,
      periodMs: 7 * D,
      samples: [],
      sessionLimited: false,
      sessionShare: null,
    })),
    plans: [],
    unrecordedCount: 0,
  });
  const forecast = (fields: Partial<PoolForecast>) => fields as PoolForecast;

  test('keeps what is left, the size and the next reset of each recorded pool', () => {
    expect(
      summarizePools([
        {
          pool: pool('claude', 6),
          forecast: forecast({
            remaining: 464,
            capacity: 600,
            nextReset: { t: NOW + 7 * H, amount: 91, keys: ['claude-3'] },
          }),
        },
        { pool: pool('codex', 0), forecast: forecast({ remaining: 0, capacity: 0 }) },
      ])
    ).toEqual({
      claude: { remaining: 464, capacity: 600, nextReset: { t: NOW + 7 * H, amount: 91 } },
    });
    expect(
      summarizePools([
        {
          pool: pool('codex', 2),
          forecast: forecast({ remaining: 121, capacity: 200, nextReset: null }),
        },
      ])
    ).toEqual({ codex: { remaining: 121, capacity: 200, nextReset: null } });
  });
});

describe('resets cell', () => {
  const line = (overrides: Partial<ResetLine> = {}): ResetLine => ({
    key: 'general',
    count: 1,
    label: 'general',
    expiresAtMs: NOW + 35 * D,
    action: { label: 'Use a general reset', disabled: false, busy: false, onClick: () => {} },
    ...overrides,
  });
  const render = (lines: ResetLine[], known = true) =>
    renderToStaticMarkup(createElement(ResetsCell, { lines, known, now: NOW, locale: 'en' }));

  test('one line and one named icon button per kind', () => {
    const markup = render([
      line(),
      line({
        key: 'fable',
        count: 3,
        label: 'Fable',
        expiresAtMs: NOW + 118 * D,
        action: { label: 'Use a Fable reset', disabled: true, busy: false, onClick: () => {} },
      }),
    ]);
    expect(markup).toContain('>35d<');
    expect(markup).toContain('>118d<');
    expect(markup).toContain('Next expires in 35 days');
    expect(markup.match(/<button/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="Use a general reset"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Use a Fable reset"/);
    expect(markup.indexOf('general')).toBeLessThan(markup.indexOf('Fable'));
  });

  test('lights up a reset worth spending now', () => {
    const ready = render([
      line({
        key: 'fable',
        action: {
          label: 'Use it now',
          disabled: false,
          busy: false,
          ready: true,
          onClick: () => {},
        },
      }),
    ]);
    expect(ready).toMatch(/<button[^>]*data-ready="true"[^>]*aria-label="Use it now"/);
    expect(render([line()])).not.toContain('data-ready');
  });

  test('Fable counts as used up only when nothing is left', () => {
    const cell = (remaining: number | null) => [
      { id: 'seven-day', label: 'Weekly', remaining: 50, resetAtMs: null },
      { id: 'seven-day-fable', label: 'Fable', remaining, resetAtMs: null },
    ];
    expect(fableUsedUp(cell(0))).toBe(true);
    expect(fableUsedUp(cell(0.2))).toBe(true);
    expect(fableUsedUp(cell(1))).toBe(false);
    expect(fableUsedUp(cell(null))).toBe(false);
    expect(fableUsedUp(cell(0).slice(0, 1))).toBe(false);
  });

  test('tells "none banked" from "not read yet", and omits a passed expiry', () => {
    expect(render([], true)).toContain('None');
    expect(render([], false)).toContain('—');
    expect(render([], false)).not.toContain('None');
    const markup = render([line({ expiresAtMs: NOW - H, action: null })]);
    expect(markup).not.toContain('Next expires');
    expect(markup).not.toContain('<button');
  });

  test('every locale names the kinds, the column and the actions', async () => {
    for (const language of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr']) {
      const locale = await Bun.file(`src/i18n/locales/${language}.json`).json();
      for (const key of [
        'col_account',
        'col_resets',
        'low',
        'reset_general',
        'reset_fable',
        'reset_available',
        'resets_none',
        'use_reset',
        'use_reset_general',
        'use_reset_fable',
        'use_reset_fable_ready',
        'next_expires',
        'pool_capacity',
      ]) {
        expect(typeof locale.quota_accounts[key]).toBe('string');
      }
      expect(locale.quota_accounts.resets_in).toContain('{{duration}}');
      expect(locale.quota_accounts.pool_capacity).toContain('{{capacity}}');
      expect(locale.claude_quota.seven_day_fable).not.toContain('Fable 5');
      expect(locale.claude_reset.confirm_text_fable).toContain('{{name}}');
      expect(locale.claude_reset.confirm_text_fable).toContain('Fable');
    }
    const en = await Bun.file('src/i18n/locales/en.json').json();
    expect(en.quota_accounts.reset_general).toBe('General');
    expect(en.claude_quota.seven_day_fable).toBe('Weekly Fable limit');
  });
});

describe('account rows mirror the quota card actions', () => {
  test('each kind has its own button, so a reset line spends its grant without a choice', async () => {
    const row = await Bun.file('src/features/quota/accounts/AccountRow.tsx').text();
    const hook = await Bun.file('src/features/quota/providers/claude/ClaudeResetGrants.tsx').text();
    expect(row).not.toContain('<ClaudeResetGrantDialog');
    expect(row).toContain('onClick: line.confirm');
    expect(hook).toContain('selectResetGrant(status, now, kind)');
    expect(hook).toContain("'claude_reset.confirm_text_fable'");
  });

  test('Codex rows carry the card credit setting and its dialog', async () => {
    const row = await Bun.file('src/features/quota/accounts/AccountRow.tsx').text();
    const page = await Bun.file('src/features/quota/QuotaPage.tsx').text();
    expect(row).toContain('useCodexCreditOverage(');
    expect(row).toContain('<CodexCreditOverageRow');
    expect(row).toContain('<CodexCreditOverageDialog');
    expect(row).toContain('sharedCredentialCount={creditOverageSharedCount}');
    expect(page).toContain('countCodexCreditOverageKeys(');
    expect(page).toContain('creditOverageCountFor={creditOverageCountFor}');
  });
});
