import { describe, expect, test } from 'bun:test';
import {
  BUCKET_MS,
  buildAccountRows,
  buildTraffic,
  signalReadings,
} from '@/features/dashboard/prox/model';
import type { QuotaHistory } from '@/services/api/quotaHistory';
import type { AuthFileItem } from '@/types/authFile';

const H = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 27, 17, 47, 12);
const sec = (ms: number) => String(Math.floor(ms / 1000));
const bucket = (success: number, failed = 0) => ({ success, failed });

const claudeQuota = (fiveUsed: number, weekUsed: number, weekReset: number, observed = NOW) => ({
  observed_at: new Date(observed).toISOString(),
  signals: {
    'Anthropic-Ratelimit-Unified-5h-Utilization': String(fiveUsed),
    'Anthropic-Ratelimit-Unified-5h-Reset': sec(NOW + 2 * H),
    'Anthropic-Ratelimit-Unified-7d-Utilization': String(weekUsed),
    'Anthropic-Ratelimit-Unified-7d-Reset': sec(weekReset),
  },
});

const file = (name: string, extra: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name,
  type: 'claude',
  email: `${name}@example.com`,
  ...extra,
});

describe('traffic', () => {
  test('aligns sources on the newest bucket and stamps epoch-aligned starts', () => {
    const traffic = buildTraffic(
      [
        { provider: 'claude', buckets: [bucket(1), bucket(2), bucket(3, 1)] },
        { provider: 'codex', buckets: [bucket(5)] },
      ],
      NOW
    );
    const lastStart = Math.floor(NOW / BUCKET_MS) * BUCKET_MS;
    expect(traffic.points.map((point) => point.start)).toEqual([
      lastStart - 2 * BUCKET_MS,
      lastStart - BUCKET_MS,
      lastStart,
    ]);
    expect(traffic.points[2]).toMatchObject({
      success: 8,
      failed: 1,
      total: 9,
      byProvider: { claude: 4, codex: 5 },
    });
    expect(traffic.total).toBe(12);
    expect(traffic.providers).toEqual(['claude', 'codex']);
    expect(traffic.successRate).toBeCloseTo((11 / 12) * 100);
  });

  test('has no rate and no providers without requests', () => {
    const traffic = buildTraffic([{ provider: 'claude', buckets: [bucket(0), bucket(0)] }], NOW);
    expect(traffic.points).toHaveLength(2);
    expect(traffic.successRate).toBeNull();
    expect(traffic.providers).toEqual([]);
  });
});

describe('quota headers', () => {
  test('reads Claude utilization fractions as percentages', () => {
    const { fiveHour, weekly } = signalReadings('claude', claudeQuota(0.36, 0.48, NOW + 30 * H));
    expect(fiveHour?.used).toBeCloseTo(36);
    expect(weekly?.used).toBeCloseTo(48);
    expect(weekly?.resetAt).toBe(Number(sec(NOW + 30 * H)) * 1000);
  });

  test('maps Codex windows by length, not by slot', () => {
    const { fiveHour, weekly } = signalReadings('codex', {
      observed_at: new Date(NOW).toISOString(),
      signals: {
        'X-Codex-Primary-Window-Minutes': '10080',
        'X-Codex-Primary-Used-Percent': '19',
        'X-Codex-Primary-Reset-At': sec(NOW + 100 * H),
        'X-Codex-Secondary-Window-Minutes': '0',
        'X-Codex-Secondary-Used-Percent': '0',
      },
    });
    expect(fiveHour).toBeNull();
    expect(weekly).toMatchObject({ used: 19, resetAt: Number(sec(NOW + 100 * H)) * 1000 });
  });
});

describe('account rows', () => {
  test('flags priority only for serving accounts with a weekly reset under 36 hours', () => {
    const rows = buildAccountRows(
      [
        file('soon', { quota: claudeQuota(0.1, 0.5, NOW + 20 * H) }),
        file('later', { quota: claudeQuota(0.1, 0.5, NOW + 60 * H) }),
        file('benched', {
          quota: claudeQuota(0.8, 1, NOW + 7 * H),
          cooldownSnapshot: {
            receivedAtMs: NOW,
            records: [
              { scope: 'credential', reason: 'quota', retryAt: '', remainingSeconds: 7 * 3600 },
            ],
          },
        }),
      ],
      null,
      'weekly-reset-weighted-round-robin',
      NOW
    );
    expect(rows.map((row) => [row.name, row.status, row.priority])).toEqual([
      ['benched@example.com', 'cooling', false],
      ['soon@example.com', 'serving', true],
      ['later@example.com', 'serving', false],
    ]);
    expect(rows[0].statusUntil).toBe(NOW + 7 * H);
  });

  test('never flags priority under another routing strategy', () => {
    const rows = buildAccountRows(
      [file('soon', { quota: claudeQuota(0.1, 0.5, NOW + 20 * H) })],
      null,
      'round-robin',
      NOW
    );
    expect(rows[0].priority).toBe(false);
  });

  test('prefers the newer of the quota headers and the recorded history', () => {
    const history: QuotaHistory = {
      enabled: true,
      now: NOW,
      pollIntervalSeconds: 600,
      accounts: [
        {
          authId: 'a',
          authIndex: 'idx-1',
          fileName: 'a',
          provider: 'claude',
          label: '',
          email: '',
          plan: '',
          windows: [
            {
              id: 'seven_day',
              periodSeconds: 7 * 24 * 3600,
              points: [{ t: NOW - 5 * 60 * 1000, used: 70, resetAt: NOW + 50 * H }],
            },
          ],
        },
      ],
    };
    const rows = buildAccountRows(
      [file('a', { authIndex: 'idx-1', quota: claudeQuota(0.1, 0.4, NOW + 50 * H, NOW - H) })],
      history,
      'round-robin',
      NOW
    );
    expect(rows[0].weekly?.used).toBe(70);
    expect(rows[0].fiveHour?.used).toBeCloseTo(10);
  });

  test('treats a passed reset as an empty window', () => {
    const rows = buildAccountRows(
      [file('a', { quota: claudeQuota(0.9, 1, NOW - H, NOW - 3 * H) })],
      null,
      'weekly-reset-weighted-round-robin',
      NOW
    );
    expect(rows[0].weekly?.used).toBe(0);
    expect(rows[0].weekly?.resetAt).toBe(Number(sec(NOW - H)) * 1000 + 7 * 24 * H);
    expect(rows[0].priority).toBe(false);
  });

  test('sums recent requests and reports disabled and unavailable credentials', () => {
    const rows = buildAccountRows(
      [
        file('off', { disabled: true, recentRequests: [bucket(3, 1), bucket(2)] }),
        file('down', { unavailable: true }),
      ],
      null,
      '',
      NOW
    );
    const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
    expect(byName['off@example.com']).toMatchObject({
      status: 'disabled',
      success: 5,
      failed: 1,
      total: 6,
    });
    expect(byName['down@example.com'].status).toBe('unavailable');
  });
});
