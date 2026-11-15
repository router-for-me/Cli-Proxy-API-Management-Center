/**
 * Mixed-provider batch quota loading for one source. The rules (queueing, the 60 s reuse, the
 * per-source read limit, cache-generation guards) live in ../quotaBatch.ts; this hook only binds
 * them to a source session and reports whether a batch is running.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuotaStore, type QuotaStore } from '@/stores/useQuotaStore';
import type { SourceSession } from '@/services/api/sourceSession';
import { isQuotaSourceCurrent } from '../sourceCurrent';
import type { QuotaAdapter } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import { createQuotaBatchLoader } from '../quotaBatch';
import { useServerAccountsStore } from '@/stores/useServerAccountsStore';
import { isServedFile, refreshServedPage } from '@/features/quotaPool/serverQuota';

export function useQuotaBatchLoader(
  adapters: Record<QuotaProviderType, QuotaAdapter>,
  store: QuotaStore = useQuotaStore,
  session?: SourceSession
) {
  const { t } = useTranslation();
  const [batchLoading, setBatchLoading] = useState(false);
  const loadQuota = useMemo(
    () =>
      createQuotaBatchLoader({
        adapters,
        store,
        t,
        isCurrent: () => isQuotaSourceCurrent(session),
        // Credentials the history server serves are never read on the hub here.
        served: (entry) =>
          session !== undefined &&
          isServedFile(
            useServerAccountsStore.getState().routing,
            session.owner.instanceId,
            entry.file
          ),
        refreshServed: async (entries) =>
          (await refreshServedPage({ files: entries.map((entry) => entry.file), store })).kind !==
          'failed',
        onBusyChange: setBatchLoading,
      }),
    [adapters, store, session, t]
  );
  return { batchLoading, loadQuota };
}
