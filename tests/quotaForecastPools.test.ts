import { describe, expect, test } from 'bun:test';
import { containsEmail, maskEmail, maskEmails } from '@/features/quota/emailMask';
import { buildForecastPools } from '@/features/quota/forecast/pools';
import { burnWindowDays, sanitizeForecastPrefs } from '@/features/quota/forecast/prefs';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaHistory, QuotaHistoryAccount } from '@/services/api/quotaHistory';
import type { AuthFileItem } from '@/types';

const entry = (name: string, type: string, extra: Partial<AuthFileItem> = {}): QuotaFileEntry =>
  ({ file: { name, provider: type, ...extra } as AuthFileItem, type }) as QuotaFileEntry;

const account = (
  fileName: string,
  provider: string,
  extra: Partial<QuotaHistoryAccount> = {}
): QuotaHistoryAccount => ({
  authId: fileName,
  authIndex: '',
  fileName,
  provider,
  label: '',
  email: '',
  plan: '',
  windows: [
    { id: 'seven_day', periodSeconds: 604800, points: [{ t: 1, used: 10, resetAt: null }] },
  ],
  ...extra,
});

const history = (accounts: QuotaHistoryAccount[]): QuotaHistory => ({
  enabled: true,
  now: 1,
  pollIntervalSeconds: 600,
  accounts,
});

describe('email masking', () => {
  test('masks emails inside names and keeps prefixes and extensions', () => {
    expect(maskEmail('santi@gmail.com')).toBe('s•••@g•••.com');
    expect(maskEmails('claude-team@tuta.gg.json')).toBe('claude-t•••@t•••.gg.json');
    expect(maskEmails('codex-santi@gmail.com-pro.json', 'santi@gmail.com')).toBe(
      'codex-s•••@g•••.com-pro.json'
    );
    expect(maskEmails('codex-team.json')).toBe('codex-team.json');
    expect(containsEmail('a@b.c')).toBe(true);
  });
});

describe('forecast pools', () => {
  const entries = [
    entry('claude-a@x.com.json', 'claude', { auth_index: 'idx-a' }),
    entry('claude-b@x.com.json', 'claude'),
    entry('codex-pro.json', 'codex'),
    entry('kimi.json', 'kimi'),
  ];

  test('match history by file name or auth index and count unrecorded accounts', () => {
    const pools = buildForecastPools(
      history([
        account('renamed.json', 'claude', {
          authId: 'other',
          authIndex: 'idx-a',
          email: 'a@x.com',
        }),
        account('codex-pro.json', 'codex', { plan: 'pro' }),
        account('gone.json', 'claude'),
      ]),
      entries,
      { planWeights: { 'codex:pro': 2.5 }, showEmails: false }
    );
    const [claude, codex] = pools;
    expect(claude.accounts.map((input) => input.name)).toEqual(['a•••@x•••.com']);
    expect(claude.unrecordedCount).toBe(1);
    expect(codex.accounts[0].weight).toBe(2.5);
    expect(codex.plans).toEqual([{ key: 'codex:pro', plan: 'pro', weight: 2.5, count: 1 }]);
  });

  test('mask emails until shown and keep non-email labels', () => {
    const recorded = history([
      account('claude-a@x.com.json', 'claude', { email: 'a@x.com' }),
      account('claude-b@x.com.json', 'claude', { label: 'team seat' }),
    ]);
    const shown = buildForecastPools(recorded, entries, {
      planWeights: {},
      showEmails: true,
    });
    const hidden = buildForecastPools(recorded, entries, {
      planWeights: {},
      showEmails: false,
    });
    expect(shown[0].accounts.map((input) => input.name)).toEqual(['a@x.com', 'team seat']);
    expect(hidden[0].accounts.map((input) => input.name)).toEqual(['a•••@x•••.com', 'team seat']);
  });
});

describe('forecast preferences', () => {
  test('offer one- and three-day burn windows, labelled in days', () => {
    expect(sanitizeForecastPrefs({ burnWindowHours: 24 }).burnWindowHours).toBe(24);
    expect(sanitizeForecastPrefs({ burnWindowHours: 72 }).burnWindowHours).toBe(72);
    expect(sanitizeForecastPrefs({ burnWindowHours: 48 }).burnWindowHours).toBe(3);
    expect([1, 3, 6, 24, 72].map(burnWindowDays)).toEqual([null, null, null, 1, 3]);
  });

  test('fall back to defaults for unknown or malformed values', () => {
    const prefs = sanitizeForecastPrefs({
      view: 'pie',
      burnWindowHours: 2,
      futureUsage: 'double',
      showAccounts: 'yes',
      planWeights: { 'codex:pro': 2.5, 'claude:max': -1, bad: 'x' },
    });
    expect(prefs.view).toBe('remaining');
    expect(prefs.burnWindowHours).toBe(3);
    expect(prefs.futureUsage).toBe('double');
    expect(prefs.showAccounts).toBe(false);
    expect(prefs.planWeights).toEqual({ 'codex:pro': 2.5 });
  });
});
