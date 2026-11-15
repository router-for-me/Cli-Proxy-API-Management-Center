import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { ServerAccount } from '@/domain/quotaPool/accounts';
import type { SourceSession } from '@/services/api/sourceSession';
import { sourceQuotaStore } from '@/stores/sourceQuotaStores';
import { servedByServer, useServerAccountsStore } from '@/stores/useServerAccountsStore';
import type { AuthFileItem } from '@/types';
import { onPoolAccountRefreshed } from './accountSync';
import { projectServerAccounts, serverAccountFor } from './serverQuota';

/**
 * Holds the one accounts poller while a page is mounted (about 30 s while visible, and on focus).
 * A claim from any page has the server re-read the account (accountSync.ts), and the readings
 * are fetched again right after.
 */
export function useServerAccountsPoller() {
  useEffect(() => {
    const release = useServerAccountsStore.getState().acquire();
    const unlisten = onPoolAccountRefreshed(
      () => void useServerAccountsStore.getState().pollFresh()
    );
    return () => {
      unlisten();
      release();
    };
  }, []);
}

/**
 * Mount on a page that shows a source's credentials: it holds the poller and writes the server's
 * readings of the served credentials into the source session's shared quota store.
 */
export function useServerQuota(session: SourceSession, files: readonly AuthFileItem[] | undefined) {
  const { t } = useTranslation();
  const routing = useServerAccountsStore((state) => state.routing);
  const accounts = useServerAccountsStore((state) => state.accounts);
  useServerAccountsPoller();
  useEffect(() => {
    if (!files) return;
    projectServerAccounts({
      owner: session.owner,
      files,
      routing,
      accounts,
      store: sourceQuotaStore(session.owner),
      t,
    });
  }, [files, routing, accounts, session.owner, t]);
}

/** Whether this source's credentials of `provider` are served from the history server. */
export function useServedByServer(instanceId: string | undefined, provider: string): boolean {
  return useServerAccountsStore((state) => servedByServer(state.routing, instanceId, provider));
}

/** The history server's account for one credential, when it serves it and has read it. */
export function useServerAccount(
  instanceId: string | undefined,
  provider: string,
  file: AuthFileItem
): ServerAccount | undefined {
  return useServerAccountsStore((state) =>
    serverAccountFor(state.routing, state.accounts, instanceId, provider, file)
  );
}
