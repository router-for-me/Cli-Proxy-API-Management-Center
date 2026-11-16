/**
 * The resets recorded by the quota history server (`GET /v1/resets/events`), newest first. Rows
 * that mount together share one in-flight request per provider; nothing is kept after it settles,
 * so a later page or another connection always reads its own. (A request captured on a connection
 * the user has left is refused by its client.) A targeted re-read after a reset (any page) makes
 * mounted rows read again.
 */
import { useEffect, useState } from 'react';
import type { PoolProviderId } from '@/domain/quotaPool/types';
import { createQuotaPoolApi, type ResetEventView } from '@/services/api/quotaPool';
import { onPoolAccountRefreshed } from './accountSync';

const inFlight = new Map<string, Promise<ResetEventView[]>>();
const listeners = new Set<() => void>();

onPoolAccountRefreshed(() => listeners.forEach((listener) => listener()));

export function loadResetEvents(
  provider: PoolProviderId,
  api: Pick<ReturnType<typeof createQuotaPoolApi>, 'resetEvents'> = createQuotaPoolApi()
): Promise<ResetEventView[]> {
  const key = provider;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const events = api
    .resetEvents(provider, new AbortController().signal)
    .then((body) => body.events)
    // History is a convenience on this page: a failed read shows nothing, never an error.
    .catch(() => [])
    .finally(() => inFlight.delete(key));
  inFlight.set(key, events);
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
