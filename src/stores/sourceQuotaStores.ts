/**
 * The one client-side quota store per hub source session.
 *
 * Auth Files, the Quota page (/quota/accounts) and the Quota Management reset panel all read and
 * write the store returned here, so a read, claim or reset made on one page is what every other
 * page shows. The store belongs to the authenticated session (SourceOwner), not to a page: leaving
 * a page keeps it, and a replacement session (sign-out, sign-in, a changed connection) is a new
 * owner with an empty store. The old owner's store is released with the old session, and its
 * in-flight reads can only commit into it, never into the new one.
 */
import { createQuotaStore, type QuotaStore } from '@/stores/useQuotaStore';
import type { SourceOwner } from '@/services/api/sourceSession';

const stores = new WeakMap<SourceOwner, QuotaStore>();

export function sourceQuotaStore(owner: SourceOwner): QuotaStore {
  let store = stores.get(owner);
  if (!store) {
    store = createQuotaStore();
    stores.set(owner, store);
  }
  return store;
}
