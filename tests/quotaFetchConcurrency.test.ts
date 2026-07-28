import { describe, expect, test } from 'bun:test';
import {
  mapWithConcurrency,
  QUOTA_FETCH_CONCURRENCY,
  Semaphore,
} from '../src/utils/quota/concurrency';

/** Resolvable-on-demand task that records how many peers ran alongside it. */
const makeTracker = () => {
  let inFlight = 0;
  let peak = 0;
  const releases: (() => void)[] = [];

  const task = async <T>(value: T): Promise<T> => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise<void>((resolve) => releases.push(resolve));
    inFlight -= 1;
    return value;
  };

  /**
   * Release waiting tasks until `settled` flips. Yields on a macrotask each
   * round so the gate's hand-off microtasks fully drain before we re-check —
   * a microtask-only yield can observe an empty queue mid-hand-off and stop
   * early, leaving the mapped promise pending forever.
   */
  const drainUntil = async (settled: () => boolean) => {
    for (let round = 0; round < 200 && !settled(); round += 1) {
      releases.splice(0).forEach((release) => release());
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  /** Yield long enough for every started task to have registered. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  return { task, drainUntil, settle, peak: () => peak, waiting: () => releases.length };
};

describe('quota fetch concurrency', () => {
  test('never exceeds the configured number of in-flight requests', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const tracker = makeTracker();
    const gate = new Semaphore(QUOTA_FETCH_CONCURRENCY);

    let done = false;
    const pending = mapWithConcurrency(items, (item) => tracker.task(item), gate).then((r) => {
      done = true;
      return r;
    });
    await tracker.settle();

    expect(tracker.waiting()).toBe(QUOTA_FETCH_CONCURRENCY);

    await tracker.drainUntil(() => done);
    expect(await pending).toEqual(items);

    expect(tracker.peak()).toBe(QUOTA_FETCH_CONCURRENCY);
  });

  test('preserves input order regardless of completion order', async () => {
    const gate = new Semaphore(3);
    const items = [30, 10, 20, 5, 40];

    const results = await mapWithConcurrency(
      items,
      async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
        return ms;
      },
      gate
    );

    expect(results).toEqual(items);
  });

  test('releases its permit when a task rejects, so the gate does not deadlock', async () => {
    const gate = new Semaphore(1);

    await expect(gate.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

    // A leaked permit would leave this pending forever.
    await expect(gate.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  test('an empty target list resolves immediately', async () => {
    expect(await mapWithConcurrency([], async () => 1, new Semaphore(4))).toEqual([]);
  });

  test('a shared gate bounds the total across concurrent provider loads', async () => {
    // Five providers loading at once must not multiply the limit by five.
    const tracker = makeTracker();
    const gate = new Semaphore(QUOTA_FETCH_CONCURRENCY);

    let done = false;
    const providers = Promise.all(
      Array.from({ length: 5 }, () =>
        mapWithConcurrency([1, 2, 3, 4], (item) => tracker.task(item), gate)
      )
    ).then((r) => {
      done = true;
      return r;
    });
    await tracker.settle();

    expect(tracker.waiting()).toBe(QUOTA_FETCH_CONCURRENCY);

    await tracker.drainUntil(() => done);
    await providers;

    expect(tracker.peak()).toBe(QUOTA_FETCH_CONCURRENCY);
  });
});
