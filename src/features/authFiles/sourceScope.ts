import { sourceQuotaStore } from '@/stores/sourceQuotaStores';
import { createAuthFilesApi } from '@/services/api/authFiles';
import { createSourceLease } from '@/services/api/sourceLease';
import type { SourceSession } from '@/services/api/sourceSession';

/** Feature state is private to a mounted source view; domain rules stay in the factories. */
export function createAuthFilesSourceScope(owner: SourceSession) {
  const lease = createSourceLease(owner);
  const quotaStore = sourceQuotaStore(owner.owner);
  return Object.freeze({
    ...lease,
    // Shared with every other page of this source session, so closing this view keeps its
    // finished readings; only the reads it left running are forgotten.
    quotaStore,
    api: createAuthFilesApi(lease.session),
    dispose: () => {
      lease.dispose();
      quotaStore.getState().releaseLoading();
    },
  });
}
