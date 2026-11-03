import { describe, expect, test } from 'bun:test';
import { formatResetHintFromMessage } from '@/features/authFiles/logic';

// 1793973920 is 2026-11-06T14:05:20Z. Its wall-clock hour depends on the runner's zone,
// so the expectation is derived from the same instant rather than a hard-coded hour.
const RESET_EPOCH = 1793973920;
const CODEX_BODY =
  '{"error":{"type":"usage_limit_reached","message":"The usage limit has been reached","plan_type":"plus","resets_at":1793973920,"resets_in_seconds":252096}}';

const local = new Date(RESET_EPOCH * 1000);
const pad = (value: number) => String(value).padStart(2, '0');
const expectedLocalClock = `${pad(local.getHours())}:${pad(local.getMinutes())}`;

// The date format is locale-dependent; assert only the converted clock time.
const expectLocalReset = (result: string | null) => {
  expect(result).toContain(expectedLocalClock);
};

describe('formatResetHintFromMessage', () => {
  test('formats resets_at from a nested Codex error body in local time', () => {
    expectLocalReset(formatResetHintFromMessage(CODEX_BODY));
  });

  test('treats epoch values above 1e12 as milliseconds', () => {
    expectLocalReset(formatResetHintFromMessage('{"resets_at":1793973920000}'));
  });

  test('reads resets_at, reset_at and resetsAt at the top level', () => {
    expectLocalReset(formatResetHintFromMessage('{"resets_at":1793973920}'));
    expectLocalReset(formatResetHintFromMessage('{"reset_at":1793973920}'));
    expectLocalReset(formatResetHintFromMessage('{"resetsAt":1793973920}'));
  });

  test('reads resets_at nested under error', () => {
    expectLocalReset(formatResetHintFromMessage('{"error":{"resetsAt":1793973920}}'));
  });

  test('accepts numeric strings as epochs', () => {
    expectLocalReset(formatResetHintFromMessage('{"resets_at":"1793973920"}'));
  });

  test('returns null for epochs outside 2000..2100', () => {
    expect(formatResetHintFromMessage('{"resets_at":100000000000}')).toBeNull();
    expect(formatResetHintFromMessage('{"resets_at":12}')).toBeNull();
    expect(formatResetHintFromMessage('{"resets_at":5000000000}')).toBeNull();
  });

  test('returns null for non-JSON text', () => {
    expect(formatResetHintFromMessage('quota exceeded, try later')).toBeNull();
    expect(formatResetHintFromMessage('{"error":')).toBeNull();
    expect(formatResetHintFromMessage('')).toBeNull();
  });

  test('returns null when no reset field is present', () => {
    expect(
      formatResetHintFromMessage('{"error":{"type":"usage_limit_reached","message":"limit"}}')
    ).toBeNull();
    expect(formatResetHintFromMessage('[1793973920]')).toBeNull();
    expect(formatResetHintFromMessage('1793973920')).toBeNull();
  });

  test('skips an out-of-range top-level value and uses the nested error reset', () => {
    const hint = formatResetHintFromMessage(`{"resets_at":1,"error":{"resets_at":${RESET_EPOCH}}}`);
    expect(hint).toContain(expectedLocalClock);
  });
});
