import { describe, expect, test } from 'bun:test';
import { parseMinimaxQuotaPayload } from '@/services/api/minimaxQuota';

/** Shape captured from a live /v1/token_plan/remains response. */
const livePayload = {
  model_remains: [
    {
      start_time: 1791284468072,
      end_time: 1791302468072,
      remains_time: 14914285,
      model_name: 'general',
      weekly_start_time: 1791263555641,
      weekly_end_time: 1791868355641,
      current_interval_status: 1,
      current_interval_remaining_percent: 49,
      current_weekly_status: 1,
      current_weekly_remaining_percent: 94,
    },
  ],
  base_resp: { status_code: 0, status_msg: 'success' },
};

describe('MiniMax quota parsing', () => {
  test('maps the interval and weekly windows from a live payload', () => {
    const result = parseMinimaxQuotaPayload(livePayload);
    expect(result).not.toBeNull();
    const interval = result!.windows.find((w) => w.id === 'interval');
    const weekly = result!.windows.find((w) => w.id === 'weekly');
    expect(interval?.remainingPercent).toBe(49);
    expect(interval?.resetAt).toBe(1791302468072);
    expect(interval?.modelName).toBe('general');
    expect(weekly?.remainingPercent).toBe(94);
    expect(weekly?.resetAt).toBe(1791868355641);
  });

  test('keeps the most constrained window when several models are reported', () => {
    const result = parseMinimaxQuotaPayload({
      model_remains: [
        {
          model_name: 'general',
          current_interval_remaining_percent: 80,
          current_weekly_remaining_percent: 90,
        },
        {
          model_name: 'hailuo',
          current_interval_remaining_percent: 12,
          current_weekly_remaining_percent: 95,
        },
      ],
    });
    const interval = result!.windows.find((w) => w.id === 'interval');
    const weekly = result!.windows.find((w) => w.id === 'weekly');
    expect(interval?.remainingPercent).toBe(12);
    expect(interval?.modelName).toBe('hailuo');
    expect(weekly?.remainingPercent).toBe(90);
  });

  test('clamps percentages into the 0-100 range', () => {
    const result = parseMinimaxQuotaPayload({
      model_remains: [
        { current_interval_remaining_percent: 140, current_weekly_remaining_percent: -20 },
      ],
    });
    const interval = result!.windows.find((w) => w.id === 'interval');
    const weekly = result!.windows.find((w) => w.id === 'weekly');
    expect(interval?.remainingPercent).toBe(100);
    expect(weekly?.remainingPercent).toBe(0);
  });

  test('accepts percentages delivered as strings', () => {
    const result = parseMinimaxQuotaPayload({
      model_remains: [
        { current_interval_remaining_percent: '33', current_weekly_remaining_percent: '66' },
      ],
    });
    expect(result!.windows.find((w) => w.id === 'interval')?.remainingPercent).toBe(33);
    expect(result!.windows.find((w) => w.id === 'weekly')?.remainingPercent).toBe(66);
  });

  test('omits the reset time when the upstream does not report a usable one', () => {
    const result = parseMinimaxQuotaPayload({
      model_remains: [{ current_interval_remaining_percent: 50, end_time: 0 }],
    });
    const interval = result!.windows.find((w) => w.id === 'interval');
    expect(interval?.remainingPercent).toBe(50);
    expect(interval?.resetAt).toBeUndefined();
  });

  test('rejects payloads without usable windows', () => {
    expect(parseMinimaxQuotaPayload({ model_remains: [] })).toBeNull();
    expect(parseMinimaxQuotaPayload({})).toBeNull();
    expect(parseMinimaxQuotaPayload(null)).toBeNull();
    expect(parseMinimaxQuotaPayload('nope')).toBeNull();
  });

  test('drops a window whose percentage is missing but keeps the other', () => {
    const result = parseMinimaxQuotaPayload({
      model_remains: [{ current_weekly_remaining_percent: 70 }],
    });
    expect(result!.windows.some((w) => w.id === 'interval')).toBe(false);
    expect(result!.windows.find((w) => w.id === 'weekly')?.remainingPercent).toBe(70);
  });
});

describe('MiniMax base_resp handling', () => {
  test('a zero status code leaves the payload parseable', () => {
    const result = parseMinimaxQuotaPayload({
      model_remains: [{ current_interval_remaining_percent: 50 }],
      base_resp: { status_code: 0, status_msg: 'success' },
    });
    expect(result).not.toBeNull();
  });

  test('a non-zero status code yields no windows, so the caller reports a request failure', () => {
    // MiniMax returns HTTP 200 for a rejected token and signals it here.
    const result = parseMinimaxQuotaPayload({
      model_remains: null,
      base_resp: { status_code: 1004, status_msg: 'login fail' },
    });
    expect(result).toBeNull();
  });
});
