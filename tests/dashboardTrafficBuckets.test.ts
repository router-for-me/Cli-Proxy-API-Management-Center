import { expect, test } from 'bun:test';
import { mergeTrafficSamples } from '../src/features/dashboard/trafficBuckets';

const bucket = (success: number, time?: string) => ({ success, failed: 0, ...(time && { time }) });
const before = '23:40-23:50';
const shared = '23:50-00:00';
const after = '00:00-00:10';

test('aligns overlapping server windows across midnight even if both responses arrive together', () => {
  const sampledAt = Date.UTC(2026, 5, 1, 16);
  const older = { sampledAt, buckets: [bucket(2, before), bucket(8, shared)] };
  const newer = { sampledAt, buckets: [bucket(3, shared), bucket(9, after)] };
  for (const samples of [
    [older, newer],
    [newer, older],
  ]) {
    expect(mergeTrafficSamples(samples)).toEqual([
      bucket(2, before),
      bucket(11, shared),
      bucket(9, after),
    ]);
  }
});

test('does not count yesterday’s cached snapshot with identical server labels', () => {
  const sampledAt = Date.UTC(2026, 5, 1);
  expect(
    mergeTrafficSamples([
      { sampledAt, buckets: [bucket(80, shared)] },
      { sampledAt: sampledAt + 86400000, buckets: [bucket(4, shared)] },
    ])
  ).toEqual([bucket(4, shared)]);
});

test('still tail-aligns legacy groups without time labels', () => {
  expect(
    mergeTrafficSamples([
      { sampledAt: 0, buckets: [bucket(1), bucket(2)] },
      { sampledAt: 86400000, buckets: [bucket(3)] },
    ])
  ).toEqual([bucket(1), bucket(5)]);
});

test('drops the expired leading bucket instead of extending a full rolling window', () => {
  const labels = Array.from({ length: 21 }, (_, index) => {
    const clock = (i: number) => `0${Math.floor(i / 6)}:${(i % 6) * 10 || '00'}`;
    return `${clock(index)}-${clock(index + 1)}`;
  });
  const merged = mergeTrafficSamples([
    { sampledAt: 0, buckets: labels.slice(0, 20).map((time, i) => bucket(i === 0 ? 99 : 1, time)) },
    { sampledAt: 600000, buckets: labels.slice(1).map((time) => bucket(2, time)) },
  ]);
  expect(merged).toEqual(labels.slice(1).map((time, i) => bucket(i === 19 ? 2 : 3, time)));
});
