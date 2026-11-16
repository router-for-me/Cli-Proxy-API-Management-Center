/**
 * The resets recorded by the quota history server (`GET /v1/resets/events`), newest first. One
 * request per provider serves every account row; a targeted re-read after a reset (any page)
 * drops the cache so the next render shows the new event.
 */
import { useEffect, useState } from 'react';
import type { PoolProviderId } from '@/domain/quotaPool/types';
import { createQuotaPoolApi, type ResetEventView } from '@/services/api/quotaPool';
import { onPoolAccountRefreshed } from './accountSync';

const CACHE_MS = 30_000;
const cache = new Map<PoolProviderId, { atMs: number; events: Promise<ResetEventView[]> }>();
const listeners = new Set<() => void>();

onPoolAccountRefreshed(() => {
  cache.clear();
  listeners.forEach((listener) => listener());
});

export function loadResetEvents(
  provider: PoolProviderId,
  api: Pick<ReturnType<typeof createQuotaPoolApi>, 'resetEvents'> = createQuotaPoolApi()
): Promise<ResetEventView[]> {
  const held = cache.get(provider);
  if (held && Date.now() - held.atMs < CACHE_MS) return held.events;
  const events = api
    .resetEvents(provider, new AbortController().signal)
    .then((body) => body.events)
    // History is a convenience on this page: a failed read shows nothing, never an error.
    .catch(() => {
      cache.delete(provider);
      return [];
    });
  cache.set(provider, { atMs: Date.now(), events });
  return events;
}

/** The newest recorded reset for one account (the pool row's stored id), or null. */
export function useLastResetEvent(
  provider: PoolProviderId,
  accountId: string
): ResetEventView | null {
  const [event, setEvent] = useState<ResetEventView | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((value) => value + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);
  useEffect(() => {
    let live = true;
    void loadResetEvents(provider).then((events) => {
      if (live) setEvent(events.find((entry) => entry.accountId === accountId) ?? null);
    });
    return () => {
      live = false;
    };
  }, [provider, accountId, version]);
  return event;
}
