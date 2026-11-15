import type {
  AccountRefreshResult,
  ServerAccount,
  ServerAccounts,
} from '@/domain/quotaPool/accounts';
import { isRecord } from '@/utils/helpers';
import { apiClient } from './client';

/** One source/provider pair prox-history inventories (`GET /prox/inventory`). */
export interface InventorySourceEntry {
  instanceId: string;
  provider: string;
}

export type AccountsRead =
  { status: 'unchanged' } | { status: 'changed'; accounts: ServerAccounts };

const isAccount = (value: unknown): value is ServerAccount =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  (value.provider === 'claude' || value.provider === 'codex') &&
  Array.isArray(value.windows) &&
  (value.sourceAccountId === null || typeof value.sourceAccountId === 'string');

/** prox-history's account read model and the inventory that says which sources it covers. */
export function createQuotaAccountsApi() {
  const client = apiClient.captureConnection();
  return {
    /** The sources prox-history inventories; throws when it is absent or rejects the key. */
    inventory: async (signal?: AbortSignal): Promise<InventorySourceEntry[]> => {
      const body = await client.get<unknown>('/prox/inventory', { signal });
      if (!isRecord(body) || !Array.isArray(body.sources)) {
        throw new Error('Invalid credential inventory');
      }
      return body.sources.flatMap((source: unknown) =>
        isRecord(source) &&
        typeof source.instanceId === 'string' &&
        typeof source.provider === 'string'
          ? [{ instanceId: source.instanceId, provider: source.provider }]
          : []
      );
    },
    /** Conditional read: with the version already held, an unchanged read answers 304. */
    read: async (known: string | null, signal?: AbortSignal): Promise<AccountsRead> => {
      const response = await client.getRaw('/prox/accounts', {
        headers: known ? { 'If-None-Match': `"${known}"` } : {},
        signal,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 304,
      });
      if (response.status === 304) return { status: 'unchanged' };
      const body: unknown = response.data;
      if (
        !isRecord(body) ||
        typeof body.version !== 'string' ||
        !Array.isArray(body.accounts) ||
        !body.accounts.every(isAccount)
      ) {
        throw new Error('Invalid quota accounts');
      }
      return { status: 'changed', accounts: body as unknown as ServerAccounts };
    },
    /**
     * The page-wide refresh. `refreshing` is true when a collection is now running; false means
     * the 4 minute floor skipped it, and `nextRefreshAtMs` is when the next one is due.
     */
    refreshAll: async (signal?: AbortSignal) => {
      const body = await client.post<{ refreshing?: boolean; nextRefreshAtMs?: number }>(
        '/prox/refresh',
        undefined,
        { signal }
      );
      return {
        refreshing: body?.refreshing === true,
        nextRefreshAtMs: typeof body?.nextRefreshAtMs === 'number' ? body.nextRefreshAtMs : null,
      };
    },
    /** One targeted read; `retryAtMs` says when the server's 20 s floor lets the next one run. */
    refreshAccount: async (
      accountId: string,
      signal?: AbortSignal
    ): Promise<AccountRefreshResult> => {
      const body = await client.post<{ refreshed?: boolean; retryAtMs?: number | null }>(
        '/prox/refresh',
        { accountId },
        { signal }
      );
      return {
        refreshed: body?.refreshed === true,
        retryAtMs: typeof body?.retryAtMs === 'number' ? body.retryAtMs : null,
      };
    },
  };
}
