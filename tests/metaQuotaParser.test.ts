import { describe, expect, test } from 'bun:test';
import { hasMetaQuotaData, parseMetaQuotaPayload } from '@/services/api/metaQuota';

const fixture = {
  subs_tier_name: 'Muse Pro',
  is_subs_active: true,
  subs_usage: {
    window: {
      used_percent: 0,
      window_duration_mins: 300,
      resets_at: 1789485534,
    },
    weekly: { used_percent: 1, resets_at: 1789948800 },
    tier: 'fixture-tier',
  },
  api_key: 'secret-api-key',
  email: 'private@example.test',
  user: { name: 'Private Person' },
};

describe('Meta Muse quota parser', () => {
  test('whitelists subscription and quota fields without retaining secrets or PII', () => {
    const quota = parseMetaQuotaPayload(fixture);

    expect(quota).toEqual({
      planName: 'Muse Pro',
      isSubscriptionActive: true,
      windows: [
        {
          id: 'window',
          usedPercent: 0,
          resetAt: 1789485534,
          durationMinutes: 300,
        },
        { id: 'weekly', usedPercent: 1, resetAt: 1789948800 },
      ],
    });
    const serialized = JSON.stringify(quota);
    expect(serialized).not.toContain('secret-api-key');
    expect(serialized).not.toContain('private@example.test');
    expect(serialized).not.toContain('Private Person');
  });

  test('falls back to usage tier and parses a JSON string', () => {
    const quota = parseMetaQuotaPayload(
      JSON.stringify({ subs_usage: { tier: ' fixture-tier ', weekly: { used_percent: '25' } } })
    );

    expect(quota.planName).toBe('fixture-tier');
    expect(quota.windows[1]?.usedPercent).toBe(25);
    expect(hasMetaQuotaData(quota)).toBe(true);
  });

  test('clamps finite percentages and never turns missing or invalid values into zero', () => {
    const quota = parseMetaQuotaPayload({
      subs_usage: {
        window: { used_percent: -4, resets_at: 0, window_duration_mins: 'bad' },
        weekly: { used_percent: 120, resets_at: Number.NaN },
      },
    });

    expect(quota.windows).toEqual([
      { id: 'window', usedPercent: 0 },
      { id: 'weekly', usedPercent: 100 },
    ]);
    expect(parseMetaQuotaPayload({}).windows.map((window) => window.usedPercent)).toEqual([
      null,
      null,
    ]);
    expect(hasMetaQuotaData(parseMetaQuotaPayload('{not-json'))).toBe(false);
  });

  test('accepts an explicit false subscription state as useful data', () => {
    const quota = parseMetaQuotaPayload({ is_subs_active: false });
    expect(quota.isSubscriptionActive).toBe(false);
    expect(hasMetaQuotaData(quota)).toBe(true);
  });
});
