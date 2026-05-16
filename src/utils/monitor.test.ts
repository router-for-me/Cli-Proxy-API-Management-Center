import { describe, it, expect } from 'vitest';
import {
  maskSecret,
  resolveProvider,
  formatProviderDisplay,
  getProviderDisplayParts,
  formatTimestamp,
  getTimeRangeBounds,
  parseDateInputValue,
  formatLocalDateKey,
  formatLocalHourKey,
  getHourlyRangeBounds,
  getRateClassName,
  isModelEnabled,
  createDisableState,
} from './monitor';
import type { DateRange } from './monitor';

describe('maskSecret', () => {
  it('returns dash for empty string (falsy fallback)', () => {
    expect(maskSecret('')).toBe('-');
  });

  it('returns placeholder values as-is', () => {
    expect(maskSecret('-')).toBe('-');
    expect(maskSecret('unknown')).toBe('unknown');
  });

  it('masks keys longer than 8 chars', () => {
    expect(maskSecret('sk-ant-api-1234567890abcdef')).toBe('sk-a***cdef');
  });

  it('masks keys of exactly 8 chars or fewer (short key mask)', () => {
    expect(maskSecret('sk-12345')).toBe('sk-1***');
    expect(maskSecret('12345678')).toBe('1234***');
  });
});

describe('resolveProvider', () => {
  const map = { 'sk-admin': 'Admin', 'sk-test-key': 'Test' };

  it('resolves exact match', () => {
    expect(resolveProvider('sk-admin', map)).toBe('Admin');
  });

  it('resolves prefix match', () => {
    expect(resolveProvider('sk-admin-extra', map)).toBe('Admin');
  });

  it('resolves reverse prefix match', () => {
    expect(resolveProvider('sk-test', map)).toBe('Test');
  });

  it('returns null for no match', () => {
    expect(resolveProvider('unknown-key', map)).toBeNull();
  });

  it('returns null for empty/placeholder source', () => {
    expect(resolveProvider('', map)).toBeNull();
    expect(resolveProvider('-', map)).toBeNull();
    expect(resolveProvider('unknown', map)).toBeNull();
  });
});

describe('formatProviderDisplay', () => {
  const map = { 'sk-admin': 'Admin' };

  it('formats with provider name', () => {
    const result = formatProviderDisplay('sk-admin-secret', map);
    expect(result).toContain('Admin');
    expect(result).toContain('sk-a***cret');
  });

  it('returns masked-only when no provider match', () => {
    const result = formatProviderDisplay('unknown-key-1234', {});
    expect(result).toBe('unkn***1234');
  });

  it('returns dash for empty source (falsy fallback)', () => {
    expect(formatProviderDisplay('', map)).toBe('-');
    expect(formatProviderDisplay('-', map)).toBe('-');
  });
});

describe('getProviderDisplayParts', () => {
  const map = { 'sk-admin': 'Admin' };

  it('separates provider and masked key', () => {
    const { provider, masked } = getProviderDisplayParts('sk-admin-secret', map);
    expect(provider).toBe('Admin');
    expect(masked).toBe('sk-a***cret');
  });

  it('returns null provider when no match', () => {
    const { provider, masked } = getProviderDisplayParts('unknown-key-1234', {});
    expect(provider).toBeNull();
    expect(masked).toBe('unkn***1234');
  });
});

describe('formatTimestamp', () => {
  it('returns dash for empty input', () => {
    expect(formatTimestamp('')).toBe('-');
    expect(formatTimestamp(0)).toBe('-');
  });

  it('formats millisecond number', () => {
    const result = formatTimestamp(1700000000000);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('formats ISO string', () => {
    const result = formatTimestamp('2024-01-15T08:30:00.000Z');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('getTimeRangeBounds', () => {
  const now = new Date('2024-06-15T12:00:00Z');

  it('returns 7-day range by default', () => {
    const { start, end } = getTimeRangeBounds(7, undefined, now);
    expect(start.getHours()).toBe(0);
    expect(end.getHours()).toBe(23);
    // 7-day range: start (today-6) 00:00 to end (today) 23:59:59 = ~7 calendar days
    const diffMs = end.getTime() - start.getTime();
    const diffDays = Math.round(diffMs / (24 * 3600 * 1000));
    expect(diffDays).toBe(7);
  });

  it('returns custom range when provided', () => {
    const custom: DateRange = { start: new Date('2024-06-01'), end: new Date('2024-06-10') };
    const { start, end } = getTimeRangeBounds('custom', custom, now);
    expect(start.toISOString()).toBe(custom.start.toISOString());
    expect(end.toISOString()).toBe(custom.end.toISOString());
  });

  it('clamps invalid range to default 7', () => {
    const { start, end } = getTimeRangeBounds(0, undefined, now);
    const diffMs = end.getTime() - start.getTime();
    const diffDays = Math.round(diffMs / (24 * 3600 * 1000));
    expect(diffDays).toBe(7);
  });
});

describe('parseDateInputValue', () => {
  it('parses valid YYYY-MM-DD', () => {
    const result = parseDateInputValue('2024-06-15');
    expect(result).not.toBeNull();
    expect(result!.getFullYear()).toBe(2024);
    expect(result!.getMonth()).toBe(5);
    expect(result!.getDate()).toBe(15);
  });

  it('returns null for invalid format', () => {
    expect(parseDateInputValue('06/15/2024')).toBeNull();
    expect(parseDateInputValue('abc')).toBeNull();
    expect(parseDateInputValue('')).toBeNull();
  });

  it('returns null for invalid date', () => {
    expect(parseDateInputValue('2024-02-30')).toBeNull();
    expect(parseDateInputValue('2024-13-01')).toBeNull();
  });
});

describe('formatLocalDateKey', () => {
  it('formats date as YYYY-MM-DD', () => {
    expect(formatLocalDateKey(new Date('2024-06-15T12:00:00Z'))).toBe('2024-06-15');
  });
});

describe('formatLocalHourKey', () => {
  it('formats date as YYYY-MM-DDTHH', () => {
    const key = formatLocalHourKey(new Date('2024-06-15T14:30:00Z'));
    expect(key).toMatch(/^2024-06-15T\d{2}$/);
  });
});

describe('getHourlyRangeBounds', () => {
  const now = new Date('2024-06-15T14:30:00Z');

  it('returns correct bucket count', () => {
    const { bucketCount, start, end } = getHourlyRangeBounds(24, now);
    expect(bucketCount).toBe(24);
    expect(end.getMinutes()).toBe(0);
    expect(start < end).toBe(true);
  });

  it('clamps invalid range to 24', () => {
    expect(getHourlyRangeBounds(-1, now).bucketCount).toBe(24);
  });
});

describe('getRateClassName', () => {
  const styles = { rateHigh: 'high', rateMedium: 'mid', rateLow: 'low' };

  it('returns high for >=90', () => {
    expect(getRateClassName(95, styles)).toBe('high');
    expect(getRateClassName(90, styles)).toBe('high');
  });

  it('returns medium for >=70', () => {
    expect(getRateClassName(80, styles)).toBe('mid');
  });

  it('returns low for <70', () => {
    expect(getRateClassName(50, styles)).toBe('low');
    expect(getRateClassName(0, styles)).toBe('low');
  });

  it('returns empty string when styles missing', () => {
    expect(getRateClassName(95, {})).toBe('');
  });
});

describe('isModelEnabled', () => {
  const models: Record<string, Set<string>> = {
    'sk-admin': new Set(['gpt-4', 'claude-3']),
    'sk-test': new Set(['gemini-pro']),
  };

  it('returns true for enabled model', () => {
    expect(isModelEnabled('sk-admin', 'gpt-4', models)).toBe(true);
  });

  it('returns false for missing model', () => {
    expect(isModelEnabled('sk-admin', 'gpt-5', models)).toBe(false);
  });

  it('returns true for unknown source (default visible)', () => {
    expect(isModelEnabled('', 'gpt-4', models)).toBe(true);
  });

  it('matches via prefix when key starts with source', () => {
    expect(isModelEnabled('sk-admin-extra', 'gpt-4', models)).toBe(true);
  });
});

describe('createDisableState', () => {
  it('creates state with provider display', () => {
    const state = createDisableState('sk-admin', 'gpt-4', { 'sk-admin': 'Admin' });
    expect(state.source).toBe('sk-admin');
    expect(state.model).toBe('gpt-4');
    expect(state.displayName).toContain('Admin');
    expect(state.displayName).toContain('gpt-4');
    expect(state.step).toBe(1);
  });

  it('creates state with masked key when no provider', () => {
    const state = createDisableState('unknown-key-1234', 'm', {});
    expect(state.displayName).toContain('m');
  });
});
