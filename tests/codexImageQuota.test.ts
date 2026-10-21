import { afterEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { CODEX_CONFIG, buildCodexImageQuotaWindows } from '@/features/quota/providers/codex/data';
import { apiCallApi, type ApiCallResult } from '@/services/api';
import type { AuthFileItem } from '@/types';
import { CODEX_RATE_LIMIT_RESET_CREDITS_URL, CODEX_USAGE_URL } from '@/utils/quota';

const t = ((key: string) => key) as TFunction;
const originalApiCallRequest = apiCallApi.request;

afterEach(() => {
  apiCallApi.request = originalApiCallRequest;
});

const OBSERVED_AT = '2026-10-21T23:00:19.099736+08:00';
const OBSERVED_AT_MS = Date.parse('2026-10-21T15:00:19.099Z');
const RESET_AT_SECONDS = 1792670510;

// Signals as the backend stores them from an images/generations response.
const IMAGE_SIGNALS = {
  'X-Codex-Active-Limit': 'imagegen_premium',
  'X-Codex-Plan-Type': 'plus',
  'X-Codex-Primary-Used-Percent': '5',
  'X-Codex-Primary-Window-Minutes': '1440',
  'X-Codex-Primary-Reset-At': String(RESET_AT_SECONDS),
  'X-Codex-Primary-Reset-After-Seconds': '75716',
  'X-Codex-Secondary-Window-Minutes': '0',
};

// Chat models also name an active limit; it mirrors the 5-hour and weekly bars.
const CHAT_SIGNALS = {
  'X-Codex-Active-Limit': 'premium',
  'X-Codex-Primary-Used-Percent': '19',
  'X-Codex-Primary-Window-Minutes': '300',
  'X-Codex-Primary-Reset-At': '1792531179',
};

const codexFile = (modelQuotas: unknown): AuthFileItem => ({
  name: 'codex.json',
  type: 'codex',
  auth_index: 'codex:1',
  model_quotas: modelQuotas,
});

describe('Codex image generation limit', () => {
  test('builds a 24-hour window from the image reading and ignores chat readings', () => {
    const windows = buildCodexImageQuotaWindows(
      codexFile({
        'gpt-6.1-sol': { observed_at: OBSERVED_AT, signals: CHAT_SIGNALS },
        'gpt-image-2': { observed_at: OBSERVED_AT, signals: IMAGE_SIGNALS },
      }),
      t,
      OBSERVED_AT_MS + 60_000
    );

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      id: 'image-imagegen-premium',
      labelKey: 'codex_quota.image_window',
      labelParams: { hours: 24 },
      usedPercent: 5,
      resetAtMs: RESET_AT_SECONDS * 1000,
      periodHours: 24,
      observedAtMs: OBSERVED_AT_MS,
    });
    expect(windows[0].resetLabel).not.toBe('-');
  });

  test('counts Reset-After from the observation when Reset-At is absent', () => {
    const signals: Record<string, string> = { ...IMAGE_SIGNALS };
    delete signals['X-Codex-Primary-Reset-At'];
    const [window] = buildCodexImageQuotaWindows(
      codexFile({ 'gpt-image-2': { observed_at: OBSERVED_AT, signals } }),
      t,
      OBSERVED_AT_MS + 3_600_000
    );

    expect(window.resetAtMs).toBe(OBSERVED_AT_MS + 75716 * 1000);
  });

  test('treats usage as unknown once the window has reset since the reading', () => {
    const [window] = buildCodexImageQuotaWindows(
      codexFile({ 'gpt-image-2': { observed_at: OBSERVED_AT, signals: IMAGE_SIGNALS } }),
      t,
      RESET_AT_SECONDS * 1000 + 1
    );

    expect(window.usedPercent).toBeNull();
    expect(window.resetAtMs).toBeNull();
    expect(window.resetLabel).toBe('-');
    expect(window.observedAtMs).toBe(OBSERVED_AT_MS);
  });

  test('keeps the newest reading when two image models share a limit', () => {
    const windows = buildCodexImageQuotaWindows(
      codexFile({
        'gpt-image-1.5': {
          observed_at: '2026-10-21T10:00:00Z',
          signals: { ...IMAGE_SIGNALS, 'X-Codex-Primary-Used-Percent': '2' },
        },
        'gpt-image-2': { observed_at: OBSERVED_AT, signals: IMAGE_SIGNALS },
      }),
      t,
      OBSERVED_AT_MS
    );

    expect(windows).toHaveLength(1);
    expect(windows[0].usedPercent).toBe(5);
  });

  test('returns nothing without an image reading', () => {
    expect(buildCodexImageQuotaWindows(codexFile(undefined), t)).toEqual([]);
    expect(
      buildCodexImageQuotaWindows(
        codexFile({ 'gpt-6.1-sol': { observed_at: OBSERVED_AT, signals: CHAT_SIGNALS } }),
        t
      )
    ).toEqual([]);
  });

  test('appends the image window after the live usage windows', async () => {
    apiCallApi.request = async (payload) => {
      const ok = (body: unknown): ApiCallResult => ({
        statusCode: 200,
        header: {},
        bodyText: JSON.stringify(body),
        body,
      });
      if (payload.url === CODEX_USAGE_URL) {
        return ok({
          plan_type: 'plus',
          rate_limit: {
            primary_window: { used_percent: 13, limit_window_seconds: 18000, reset_at: 1792609590 },
            secondary_window: { used_percent: 21, limit_window_seconds: 604800 },
          },
        });
      }
      if (payload.url === CODEX_RATE_LIMIT_RESET_CREDITS_URL) return ok({ credits: [] });
      throw new Error(`Unexpected URL: ${payload.url}`);
    };

    const data = await CODEX_CONFIG.fetchQuota(
      codexFile({ 'gpt-image-2': { observed_at: OBSERVED_AT, signals: IMAGE_SIGNALS } }),
      t
    );

    expect(data.windows.map(({ id }) => id)).toEqual([
      'five-hour',
      'weekly',
      'image-imagegen-premium',
    ]);
  });
});
