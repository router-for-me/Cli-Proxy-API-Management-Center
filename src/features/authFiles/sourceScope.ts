import { sourceQuotaStore } from '@/stores/sourceQuotaStores';
import { createAuthFilesApi } from '@/services/api/authFiles';
import { createSourceLease } from '@/services/api/sourceLease';
import type { SourceSession } from '@/services/api/sourceSession';

/** Feature state is private to a mounted source view; domain rules stay in the factories. */
export function createAuthFilesSourceScope(owner: SourceSession) {
  const lease = createSourceLease(owner);
  return Object.freeze({
    ...lease,
    // Shared with every other page of this source session, so closing this view keeps it.
    quotaStore: sourceQuotaStore(owner.owner),
    api: createAuthFilesApi(lease.session),
    dispose: lease.dispose,
  });
}
