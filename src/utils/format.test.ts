import { describe, it, expect } from 'vitest';
import { maskApiKey, formatFileSize, formatNumber, truncateText, formatUnixTimestamp } from './format';
import { formatDateTime } from './format';

describe('maskApiKey', () => {
  it('masks middle portion of a normal-length key', () => {
    const result = maskApiKey('sk-abc123xyz');
    // visibleChars=2, maskedLength = max(10-4,1) = 6
    expect(result).toBe('sk******yz');
  });

  it('returns empty string for empty input', () => {
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey('  ')).toBe('');
    expect(maskApiKey(null as unknown as string)).toBe('');
    expect(maskApiKey(undefined as unknown as string)).toBe('');
  });

  it('handles keys shorter than 4 characters', () => {
    // visibleChars = 1 when length < 4
    const result = maskApiKey('ab');
    expect(result).toContain('a');
    expect(result).toContain('b');
    expect(result).toHaveLength(10); // MASKED_LENGTH
  });
});

describe('formatFileSize', () => {
  it('returns "0 B" for zero', () => {
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('formats bytes', () => {
    expect(formatFileSize(500)).toBe('500.00 B');
  });

  it('formats KB', () => {
    const result = formatFileSize(2048);
    expect(result).toContain('KB');
  });

  it('formats MB', () => {
    const result = formatFileSize(1048576);
    expect(result).toContain('MB');
  });

  it('formats GB', () => {
    const result = formatFileSize(1073741824);
    expect(result).toContain('GB');
  });
});

describe('formatNumber', () => {
  it('returns number with locale formatting', () => {
    const result = formatNumber(1234567, 'en-US');
    expect(result).toBe('1,234,567');
  });

  it('handles zero', () => {
    expect(formatNumber(0, 'en-US')).toBe('0');
  });

  it('handles negative numbers', () => {
    expect(formatNumber(-1000, 'en-US')).toBe('-1,000');
  });
});

describe('formatDateTime', () => {
  it('formats a valid date string', () => {
    const result = formatDateTime('2025-06-15T10:30:00Z', 'en-US');
    expect(result).toContain('2025');
    expect(result).toContain('06');
    expect(result).toContain('15');
  });

  it('formats a Date object', () => {
    const result = formatDateTime(new Date(2025, 0, 1), 'en-US');
    expect(result).toContain('2025');
  });

  it('returns "Invalid Date" for invalid input', () => {
    expect(formatDateTime('not-a-date', 'en-US')).toBe('Invalid Date');
  });
});

describe('truncateText', () => {
  it('returns full text when within maxLength', () => {
    expect(truncateText('hello', 10)).toBe('hello');
  });

  it('truncates and appends ellipsis when over maxLength', () => {
    expect(truncateText('hello world this is long', 10)).toBe('hello worl...');
  });

  it('handles empty string', () => {
    expect(truncateText('', 5)).toBe('');
  });
});

describe('formatUnixTimestamp', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(formatUnixTimestamp(null)).toBe('');
    expect(formatUnixTimestamp(undefined)).toBe('');
    expect(formatUnixTimestamp('')).toBe('');
  });

  it('parses seconds (10-digit, ~1e9)', () => {
    const result = formatUnixTimestamp(1700000000);
    expect(result).not.toBe('');
    expect(result).toContain('202');
  });

  it('parses milliseconds (13-digit, ~1e12)', () => {
    const result = formatUnixTimestamp(1700000000000);
    expect(result).not.toBe('');
  });

  it('parses microseconds (16-digit, ~1e15)', () => {
    const result = formatUnixTimestamp(1700000000000000);
    expect(result).not.toBe('');
  });

  it('parses nanoseconds (19-digit, ~1e18)', () => {
    const result = formatUnixTimestamp(1700000000000000000);
    expect(result).not.toBe('');
  });

  it('returns empty string for NaN', () => {
    expect(formatUnixTimestamp(NaN)).toBe('');
  });

  it('parses numeric string as number', () => {
    const result = formatUnixTimestamp('1700000000');
    expect(result).not.toBe('');
  });

  it('returns locale-formatted string when locale provided', () => {
    const result = formatUnixTimestamp(1700000000000, 'en-US');
    expect(result).not.toBe('');
  });
});
