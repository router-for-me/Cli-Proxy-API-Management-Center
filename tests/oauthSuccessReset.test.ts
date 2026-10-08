import { describe, expect, test } from 'bun:test';
import { createOAuthAttempts } from '@/pages/oauthAttempts';
import { scheduleSuccessReset } from '@/pages/oauthSuccessReset';

const DELAY = 5000;

function setup(initiallyHidden: boolean) {
  let now = 0;
  let nextId = 0;
  let hidden = initiallyHidden;
  let resets = 0;
  const tasks = new Map<number, { callback: () => void; at: number }>();
  const listeners = new Set<() => void>();
  const attempts = createOAuthAttempts({ setTimeout: () => 0, clearTimeout: () => {} });
  const attempt = attempts.begin('codex');
  scheduleSuccessReset(
    attempt,
    () => resets++,
    DELAY,
    {
      isHidden: () => hidden,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    {
      now: () => now,
      schedule(callback, delay) {
        const id = ++nextId;
        tasks.set(id, { callback, at: now + delay });
        return id;
      },
      cancel(id) {
        tasks.delete(id as number);
      },
    }
  );
  return {
    attempts,
    resets: () => resets,
    pending: () => tasks.size,
    listeners: () => listeners.size,
    setHidden(value: boolean) {
      hidden = value;
      for (const listener of [...listeners]) listener();
    },
    advance(ms: number) {
      now += ms;
      for (const [id, task] of [...tasks]) {
        if (task.at <= now) {
          tasks.delete(id);
          task.callback();
        }
      }
    },
  };
}

describe('OAuth success reset', () => {
  test('resets after the delay when the page stays visible', () => {
    const page = setup(false);
    page.advance(DELAY - 1);
    expect(page.resets()).toBe(0);
    page.advance(1);
    expect(page.resets()).toBe(1);
    expect(page.listeners()).toBe(0);
    page.advance(DELAY);
    expect(page.resets()).toBe(1);
  });

  test('keeps a result reported in a background tab until the user has seen it', () => {
    const page = setup(true);
    page.advance(60_000);
    expect(page.resets()).toBe(0);
    expect(page.pending()).toBe(0);
    page.setHidden(false);
    page.advance(DELAY - 1);
    expect(page.resets()).toBe(0);
    page.advance(1);
    expect(page.resets()).toBe(1);
  });

  test('switching away part-way keeps the remaining visible time', () => {
    const page = setup(false);
    page.advance(2000);
    page.setHidden(true);
    page.advance(30_000);
    expect(page.resets()).toBe(0);
    page.setHidden(false);
    page.advance(2999);
    expect(page.resets()).toBe(0);
    page.advance(1);
    expect(page.resets()).toBe(1);
  });

  test('a new login or leaving the page cancels the reset and its listener', () => {
    for (const end of ['new login', 'unmount'] as const) {
      const page = setup(true);
      if (end === 'new login') page.attempts.begin('codex');
      else page.attempts.invalidateAll();
      expect(page.listeners()).toBe(0);
      page.setHidden(false);
      page.advance(DELAY * 2);
      expect(page.resets()).toBe(0);
      expect(page.pending()).toBe(0);
    }
  });

  test('does nothing for an attempt that is no longer current', () => {
    const attempts = createOAuthAttempts({ setTimeout: () => 0, clearTimeout: () => {} });
    const stale = attempts.begin('codex');
    attempts.begin('codex');
    let subscribed = 0;
    scheduleSuccessReset(stale, () => {}, DELAY, {
      isHidden: () => false,
      subscribe: () => {
        subscribed++;
        return () => {};
      },
    });
    expect(subscribed).toBe(0);
  });
});
