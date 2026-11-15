import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { createQuotaBatchLoader, QUOTA_READ_CONCURRENCY } from '../src/features/quota/quotaBatch';
import type { QuotaAdapter, QuotaCardState } from '../src/features/quota/providers';
import type { QuotaProviderType } from '../src/features/quota/providers/types';
import { createQuotaStore } from '../src/stores/useQuotaStore';
import type { AuthFileItem } from '../src/types';

const t = ((key: string) => key) as unknown as TFunction;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A codex adapter whose reads the test answers by hand. */
function harness(now: () => number = () => 1_000, isCurrent: () => boolean = () => true) {
  const store = createQuotaStore(now);
  const reads: Array<{ name: string; answer: () => void; fail: () => void }> = [];
  const adapter = {
    type: 'codex',
    storeSetter: 'setCodexQuota',
    storeSelector: (state: { codexQuota: Record<string, QuotaCardState> }) => state.codexQuota,
    buildLoadingState: () => ({ status: 'loading' }),
    buildSuccessState: () => ({ status: 'success' }),
    buildErrorState: (error: string) => ({ status: 'error', error }),
    fetchQuota: (file: AuthFileItem) =>
      new Promise((resolve, reject) => {
        reads.push({
          name: file.name,
          answer: () => resolve({}),
          fail: () => reject(new Error('boom')),
        });
      }),
  } as unknown as QuotaAdapter;
  const adapters = { codex: adapter } as unknown as Record<QuotaProviderType, QuotaAdapter>;
  const busy: boolean[] = [];
  const load = createQuotaBatchLoader({
    adapters,
    store,
    t,
    now,
    isCurrent,
    onBusyChange: (value) => busy.push(value),
  });
  const entry = (name: string) => ({
    file: { name, type: 'codex' } as AuthFileItem,
    type: 'codex' as const,
  });
  /** Answers every read that is open now, then lets the loader move on. */
  const answerOpen = async () => {
    const open = reads.filter((read) => !(read as { done?: boolean }).done);
    open.forEach((read) => {
      (read as { done?: boolean }).done = true;
      read.answer();
    });
    await tick();
  };
  return { store, reads, load, entry, busy, answerOpen };
}

describe('quota batch loader', () => {
  test('a view closing mid-read gives its loading entries back, keeping earlier readings', async () => {
    let current = true;
    const { store, reads, load, entry, answerOpen } = harness(
      () => 1_000,
      () => current
    );
    const earlier = { status: 'success' } as QuotaCardState;
    store.getState().setCodexQuota({ 'old.json': earlier });
    const running = load([entry('old.json'), entry('fresh.json')]);
    await tick();
    expect(reads).toHaveLength(2);
    expect(store.getState().codexQuota['fresh.json']?.status).toBe('loading');
    current = false;
    await answerOpen();
    await running;
    expect(store.getState().codexQuota['old.json']).toBe(earlier);
    expect(store.getState().codexQuota['fresh.json']).toBeUndefined();
  });

  test('a refresh that arrives while a batch runs is queued, and every target is read', async () => {
    const { reads, load, entry, answerOpen, store } = harness();
    const first = load([entry('a.json'), entry('b.json')]);
    await tick();
    // the old loader returned here without reading anything
    const second = load([entry('c.json'), entry('d.json')]);
    await tick();
    expect(reads.map((read) => read.name)).toEqual(['a.json', 'b.json']);
    await answerOpen();
    await first;
    await tick();
    expect(reads.map((read) => read.name)).toEqual(['a.json', 'b.json', 'c.json', 'd.json']);
    await answerOpen();
    await second;
    expect(Object.keys(store.getState().fetchedAt).sort()).toEqual([
      'a.json',
      'b.json',
      'c.json',
      'd.json',
    ]);
  });

  test('a queued refresh of the same cards reuses what the running batch just read', async () => {
    const { reads, load, entry, answerOpen } = harness();
    const settled: boolean[] = [];
    const first = load([entry('a.json')]);
    const second = load([entry('a.json'), entry('b.json')], (ok) => settled.push(ok));
    await tick();
    await answerOpen();
    await first;
    await tick();
    await answerOpen();
    await second;
    expect(reads.map((read) => read.name)).toEqual(['a.json', 'b.json']);
    // the reused card still counts as settled for the caller's progress
    expect(settled).toEqual([true, true]);
  });

  test('reads under 60 s old are reused; after the window they are read again', async () => {
    let now = 10_000;
    const { reads, load, entry, answerOpen } = harness(() => now);
    const one = load([entry('a.json'), entry('b.json')]);
    await tick();
    await answerOpen();
    await one;
    now += 59_000;
    await load([entry('a.json'), entry('b.json')]);
    expect(reads).toHaveLength(2);
    now += 1_000;
    const three = load([entry('a.json'), entry('b.json')]);
    await tick();
    await answerOpen();
    await three;
    expect(reads).toHaveLength(4);
  });

  test('a failed read is read again on the next refresh, even inside the window', async () => {
    const { reads, load, entry } = harness();
    const one = load([entry('a.json')]);
    await tick();
    reads[0].fail();
    await one;
    const two = load([entry('a.json')]);
    await tick();
    expect(reads).toHaveLength(2);
    reads[1].answer();
    await two;
  });

  test(`at most ${QUOTA_READ_CONCURRENCY} reads are open at once`, async () => {
    const { reads, load, entry, answerOpen } = harness();
    const names = Array.from({ length: 10 }, (_, index) => `${index}.json`);
    const run = load(names.map(entry));
    await tick();
    expect(reads).toHaveLength(QUOTA_READ_CONCURRENCY);
    while (reads.length < names.length) await answerOpen();
    await answerOpen();
    await run;
    expect(reads.map((read) => read.name)).toEqual(names);
  });

  test('busy covers the running batch and everything queued behind it', async () => {
    const { load, entry, answerOpen, busy } = harness();
    const one = load([entry('a.json')]);
    const two = load([entry('b.json')]);
    await tick();
    await answerOpen();
    await one;
    expect(busy).toEqual([true]);
    await tick();
    await answerOpen();
    await two;
    expect(busy).toEqual([true, false]);
  });
});
