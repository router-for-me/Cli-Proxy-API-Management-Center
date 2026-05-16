import { describe, it, expect } from 'vitest';
import { isRecord, getErrorMessage } from './error';

describe('isRecord', () => {
  it('returns true for plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it('returns true for arrays', () => {
    expect(isRecord([])).toBe(true);
  });

  it('returns false for null', () => {
    expect(isRecord(null)).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord(0)).toBe(false);
    expect(isRecord('')).toBe(false);
    expect(isRecord(true)).toBe(false);
  });

  it('returns false for functions', () => {
    expect(isRecord(() => {})).toBe(false);
  });
});

describe('getErrorMessage', () => {
  it('extracts message from Error instances', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
    expect(getErrorMessage(new TypeError('type boom'))).toBe('type boom');
  });

  it('returns string input as-is', () => {
    expect(getErrorMessage('plain text')).toBe('plain text');
  });

  it('extracts message property from plain objects', () => {
    expect(getErrorMessage({ message: 'obj message' })).toBe('obj message');
  });

  it('returns empty string for unrecognized types', () => {
    expect(getErrorMessage(42)).toBe('');
    expect(getErrorMessage(null)).toBe('');
    expect(getErrorMessage(undefined)).toBe('');
    expect(getErrorMessage({})).toBe('');
  });

  it('returns empty string when message prop is not a string', () => {
    expect(getErrorMessage({ message: 123 })).toBe('');
  });
});
