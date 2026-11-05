import { describe, expect, test } from 'bun:test';
import i18next from 'i18next';
import en from '../src/i18n/locales/en.json';
import { formatPluginStoreRetryTime } from '@/features/plugins/storeErrors';

// The API reports retry_at in UTC. Its wall-clock time depends on the runner's zone,
// so the expectation is derived from the same instant rather than a hard-coded hour.
const RETRY_AT = '2026-11-03T16:00:00Z';
const LOCALE = 'en-GB'; // 24-hour clock, so the hour is zero-padded HH:mm.

const local = new Date(RETRY_AT);
const pad = (value: number) => String(value).padStart(2, '0');
const expectedLocalClock = `${pad(local.getHours())}:${pad(local.getMinutes())}`;

const rateLimited = (details: unknown) =>
  Object.assign(new Error('GitHub API rate limited; retry after 2026-11-03T16:00:00Z'), {
    name: 'ApiError',
    status: 429,
    apiCode: 'plugin_store_rate_limited',
    details,
  });

const translator = i18next.createInstance();
await translator.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
});

describe('formatPluginStoreRetryTime', () => {
  test('formats retry_at as the viewer-local clock time', () => {
    const result = formatPluginStoreRetryTime(
      rateLimited({ retry_at: RETRY_AT, retry_after: 120 }),
      LOCALE
    );

    expect(result).not.toBeNull();
    expect(result).toContain(expectedLocalClock);
  });

  test('the localized rate-limit message carries the same local clock time', () => {
    const time = formatPluginStoreRetryTime(rateLimited({ retry_at: RETRY_AT }), LOCALE);

    expect(translator.t('plugin_store.rate_limited', { time: time ?? '' })).toBe(
      `GitHub API rate limit reached. Retry after ${time}.`
    );
    expect(time).toContain(expectedLocalClock);
  });

  test('falls back (null) when retry_at is missing', () => {
    expect(formatPluginStoreRetryTime(rateLimited({ retry_after: 120 }), LOCALE)).toBeNull();
    expect(formatPluginStoreRetryTime(rateLimited(undefined), LOCALE)).toBeNull();
  });

  test('falls back (null) when retry_at is garbage or not a string', () => {
    expect(formatPluginStoreRetryTime(rateLimited({ retry_at: 'soon' }), LOCALE)).toBeNull();
    expect(formatPluginStoreRetryTime(rateLimited({ retry_at: '' }), LOCALE)).toBeNull();
    expect(formatPluginStoreRetryTime(rateLimited({ retry_at: 1793973920 }), LOCALE)).toBeNull();
    expect(formatPluginStoreRetryTime(rateLimited({ retry_at: null }), LOCALE)).toBeNull();
  });

  test('leaves other error codes unaffected', () => {
    const otherCode = Object.assign(new Error('download plugin archive: 404 Not Found'), {
      apiCode: 'plugin_install_failed',
      details: { retry_at: RETRY_AT },
    });

    expect(formatPluginStoreRetryTime(otherCode, LOCALE)).toBeNull();
    expect(formatPluginStoreRetryTime(new Error('network down'), LOCALE)).toBeNull();
    expect(formatPluginStoreRetryTime('plugin_store_rate_limited', LOCALE)).toBeNull();
    expect(formatPluginStoreRetryTime(undefined, LOCALE)).toBeNull();
  });
});
