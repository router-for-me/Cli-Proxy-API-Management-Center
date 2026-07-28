/**
 * Bounded-concurrency helpers for quota fetching.
 *
 * Quota fetching used to be an unthrottled `Promise.all` over every credential
 * in a section. That was survivable only because sections were small and loaded
 * one click at a time. The flat board loads every provider at once, and Claude
 * and Codex each make 2-3 upstream HTTP calls per credential — so an unbounded
 * fan-out turns the page into a 429 generator, which is the exact failure this
 * project exists to prevent.
 *
 * The gate is deliberately *module-scoped* rather than per-loader: there is one
 * loader instance per provider, so a per-instance limit of N would still allow
 * 5N upstream requests in flight. What needs bounding is the total.
 */

/** In-flight quota requests allowed across every provider at once. */
export const QUOTA_FETCH_CONCURRENCY = 4;

/** Non-reentrant counting semaphore. */
export class Semaphore {
  private available: number;
  private readonly waiters: (() => void)[] = [];

  constructor(permits: number) {
    this.available = Math.max(1, Math.floor(permits) || 1);
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Hand the permit straight to the next waiter rather than returning it to
      // the pool — otherwise a burst of synchronous acquires can starve them.
      next();
      return;
    }
    this.available += 1;
  }

  /** Run `task` while holding a permit; the permit is always released. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}

/** The shared gate every quota fetch passes through. */
export const quotaFetchGate = new Semaphore(QUOTA_FETCH_CONCURRENCY);

/**
 * Like `Promise.all(items.map(fn))`, but each call passes through `gate` so at
 * most `QUOTA_FETCH_CONCURRENCY` run at once across the whole board. Results
 * stay in input order.
 *
 * `fn` is expected to settle rather than throw — callers convert failures into
 * result objects — but a throw still rejects the returned promise, matching
 * `Promise.all` semantics.
 */
export function mapWithConcurrency<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  gate: Semaphore = quotaFetchGate
): Promise<R[]> {
  return Promise.all(items.map((item, index) => gate.run(() => fn(item, index))));
}
