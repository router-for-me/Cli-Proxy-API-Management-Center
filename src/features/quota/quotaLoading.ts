/**
 * A read that starts marks its cards loading in the source's shared quota store. If the view that
 * started it closes first, the request is cancelled and can no longer settle, and a card refuses to
 * read again while it is loading, so the read gives its entries back (release). Only an entry that
 * is still that read's own is touched: a newer read of the same card, from any page, keeps its own.
 */
import type { QuotaStore } from '@/stores/useQuotaStore';
import { getQuotaMap, getQuotaSetter, type QuotaAdapter, type QuotaCardState } from './providers';

/** Marks `keys` loading; returns the release for the entries this call just wrote. */
export function beginLoading(adapter: QuotaAdapter, store: QuotaStore, keys: string[]) {
  const setQuota = getQuotaSetter(adapter, store);
  const before = getQuotaMap(adapter, store);
  const previous = new Map(keys.map((key) => [key, before[key]]));
  const readAt = new Map(keys.map((key) => [key, store.getState().fetchedAt[key]]));
  setQuota((prev) => {
    const next = { ...prev };
    keys.forEach((key) => {
      next[key] = adapter.buildLoadingState();
    });
    return next;
  });
  // Read back what the store kept (it may wrap a loading entry that retains a Claude reading).
  const mine = new Map<string, QuotaCardState | undefined>(
    keys.map((key) => [key, getQuotaMap(adapter, store)[key]])
  );
  return () => {
    const given: string[] = [];
    setQuota((prev) => {
      let next = prev;
      keys.forEach((key) => {
        if (prev[key] !== mine.get(key)) return;
        if (next === prev) next = { ...prev };
        const last = previous.get(key);
        // The reading it replaced comes back, so the other pages keep showing it.
        if (last && last.status !== 'loading') next[key] = last;
        else delete next[key];
        given.push(key);
      });
      return next;
    });
    if (given.length === 0) return;
    // Restoring is not a read: each card keeps the time of the reading it shows, so the 60 s
    // reuse never takes an old reading for a fresh one.
    store.setState((state) => {
      const fetchedAt = { ...state.fetchedAt };
      given.forEach((key) => {
        const at = readAt.get(key);
        if (at === undefined) delete fetchedAt[key];
        else fetchedAt[key] = at;
      });
      return { fetchedAt };
    });
  };
}
