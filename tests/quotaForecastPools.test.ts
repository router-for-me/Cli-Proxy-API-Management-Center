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
    {
      id: 'seven_day',
      periodSeconds: 604800,
      points: [{ t: 1, used: 10, resetAt: null }],
      droppedAt: null,
    },
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
    expect(codex.plans).toEqual([
      { key: 'codex:pro', plan: 'pro', weight: 2.5, defaultWeight: 1, count: 1 },
    ]);
  });

  test('weigh Claude plans by weekly quota, the largest plan counting 1', () => {
    const claudeEntries = ['u1', 'u2', 'u3', 'u4', 'p', 'm', 'x'].map((name) =>
      entry(`${name}.json`, 'claude')
    );
    const plans: Record<string, string> = {
      u1: 'max20',
      u2: 'max20',
      u3: 'max20',
      u4: 'max20',
      p: 'pro',
      m: 'max5',
      x: 'max',
    };
    const recorded = (names: string[]) =>
      history(names.map((name) => account(`${name}.json`, 'claude', { plan: plans[name] })));
    const weightsOf = (pool: { accounts: { key: string; weight: number }[] }) =>
      Object.fromEntries(pool.accounts.map((input) => [input.key, input.weight]));

    const [ultraPool] = buildForecastPools(recorded(['u1', 'u2', 'u3', 'u4', 'p']), claudeEntries, {
      planWeights: {},
      showEmails: false,
    });
    expect(weightsOf(ultraPool)).toEqual({
      'p.json': 0.1,
      'u1.json': 1,
      'u2.json': 1,
      'u3.json': 1,
      'u4.json': 1,
    });
    const capacity = ultraPool.accounts.reduce((sum, input) => sum + input.weight * 100, 0);
    expect(capacity).toBeCloseTo(410);
    expect(ultraPool.plans.find((plan) => plan.plan === 'pro')).toMatchObject({
      key: 'claude:pro',
      weight: 0.1,
      defaultWeight: 0.1,
    });

    // Without Ultra accounts, Max counts 1; an unknown tier keeps 1; a set weight wins.
    const [maxPool] = buildForecastPools(recorded(['p', 'm', 'x']), claudeEntries, {
      planWeights: { 'claude:pro': 0.25 },
      showEmails: false,
    });
    expect(weightsOf(maxPool)).toEqual({ 'm.json': 1, 'p.json': 0.25, 'x.json': 1 });
    expect(maxPool.plans.find((plan) => plan.plan === 'pro')?.defaultWeight).toBe(0.2);
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
