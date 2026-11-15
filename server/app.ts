import { readText } from './http/readJson';
import { isRecord } from '../src/utils/helpers';
import { authorized } from './http/auth';
export { authorized } from './http/auth';
import { buildDashboard } from './quota/domain';
import type { CollectionState, DashboardOptions } from './quota/domain';
import { parseResetClaimRequest, ResetClaimRefusal, type ResetClaims } from './quota/claims';
import type { QuotaStore } from './quota/store';
import { accountsVersion, buildAccounts } from './quota/accounts';
import { buildInventory, inventoryVersion, type InventorySourceStatus } from './quota/inventory';
import type { ClaudeUsageSnapshot } from '../src/types/quota';
import { DAY_MS, HOUR_MS, type InventoryChange } from './quota/types';

/** `GET /v1/inventory` re-reads the sources when the last read is older than this. */
const INVENTORY_FRESH_MS = 5000;
const MAX_SYNC_BODY_BYTES = 256 * 1024;
const MAX_DELETED_NAMES = 200;
const MAX_NAME_LENGTH = 1024;
const SYNC_REASONS = ['add', 'delete', 'change'] as const;

interface CollectorState extends Omit<CollectionState, 'historyStartedAtMs'> {
  refresh(): Promise<void>;
  refreshAccount(accountId: string): Promise<boolean>;
  /** When the 20 s per-account floor lets the next targeted read run; null when it is not held. */
  accountRetryAtMs?(accountId: string): number | null;
  balances?: ReadonlyMap<string, Pick<ClaudeUsageSnapshot, 'extraUsage' | 'dollarWindows'>>;
  credits?: ReadonlyMap<string, { balance: string | null; unlimited: boolean }>;
  syncInventory(options?: { deletedNames?: readonly string[] }): Promise<InventoryChange>;
  pollAdded(accountIds: readonly string[]): Promise<void>;
  inventorySources: readonly InventorySourceStatus[];
  inventorySyncedAtMs: number | null;
}
export interface AppDependencies {
  store: QuotaStore;
  collector: CollectorState;
  keyFile: string;
  /** Reset claims and their events; the routes exist only when it is supplied. */
  claims?: ResetClaims;
  now?: () => number;
}

export function parseOptions(params: URLSearchParams, nowMs: number): DashboardOptions {
  const choices = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const values = params.getAll(name);
    const value = values[0] ?? fallback;
    if (values.length > 1 || !allowed.includes(value as T)) throw new Error(`Invalid ${name}`);
    return value as T;
  };
  const offset = params.getAll('offsetDays');
  if (offset.length > 1 || !/^-?\d{1,2}$/.test(offset[0] ?? '0'))
    throw new Error('Invalid offsetDays');
  const offsetDays = Number(offset[0] ?? 0);
  if (offsetDays < -14 || offsetDays > 14) throw new Error('Invalid offsetDays');
  return {
    nowMs,
    window: choices('window', ['weekly', 'five-hour'], 'weekly'),
    lookbackHours: Number(choices('lookback', ['1', '3', '6'], '3')) as 1 | 3 | 6,
    multiplier: Number(choices('multiplier', ['0', '0.5', '1', '2'], '1')) as 0 | 0.5 | 1 | 2,
    offsetDays,
    reveal: choices('reveal', ['true', 'false'], 'false') === 'true',
  };
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

/** `If-None-Match` per RFC 9110: a list of entity tags (weak ones compare equal) or `*`. */
function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//, ''))
    .some((candidate) => candidate === '*' || candidate === etag);
}

type SyncRequest = { reason: (typeof SYNC_REASONS)[number]; deletedNames: string[] };
function parseSyncRequest(text: string): SyncRequest | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(body) || !SYNC_REASONS.some((reason) => reason === body.reason)) return null;
  const names = body.deletedNames ?? [];
  if (
    !Array.isArray(names) ||
    names.length > MAX_DELETED_NAMES ||
    names.some((name) => typeof name !== 'string' || !name.trim() || name.length > MAX_NAME_LENGTH)
  ) {
    return null;
  }
  return { reason: body.reason as SyncRequest['reason'], deletedNames: names as string[] };
}

export function createHandler({
  store,
  collector,
  keyFile,
  claims,
  now = Date.now,
}: AppDependencies) {
  const fullRefresh = () => {
    // Collection owns single-flight behavior, rate limits and sanitized failures.
    void collector.refresh().catch(() => console.error('Quota collection failed'));
    return json(
      {
        refreshing: collector.refreshing,
        lastRefreshAtMs: collector.lastRefreshAtMs,
        nextRefreshAtMs: collector.nextRefreshAtMs,
      },
      202
    );
  };
  return (request: Request): Response | Promise<Response> => {
    const url = new URL(request.url);
    if (url.pathname === '/healthz' && request.method === 'GET') return new Response('ok\n');
    try {
      if (!authorized(request, keyFile)) return json({ error: 'Unauthorized' }, 401);
    } catch {
      return json({ error: 'Management authentication unavailable' }, 503);
    }
    if (url.pathname === '/v1/refresh' && request.method === 'POST') {
      // A body naming an account asks for that one account now; anything else (no body, an
      // empty one, or `{}` from pages loaded before this route existed) is a full refresh.
      if (!request.body) return fullRefresh();
      return (async () => {
        let accountId: string | undefined;
        let text: string;
        try {
          text = await readText(request.body!, 4096);
        } catch {
          return json({ error: 'Invalid refresh body' }, 400);
        }
        if (text.trim()) {
          let body: unknown;
          try {
            body = JSON.parse(text);
          } catch {
            return json({ error: 'Invalid refresh body' }, 400);
          }
          if (!isRecord(body)) return json({ error: 'Invalid refresh body' }, 400);
          if ('accountId' in body) {
            if (
              typeof body.accountId !== 'string' ||
              !body.accountId.trim() ||
              body.accountId.length > 512
            ) {
              return json({ error: 'Invalid accountId' }, 400);
            }
            accountId = body.accountId;
          }
        }
        if (accountId !== undefined) {
          // Held back by the per-account floor? Asked before the read, which stamps its own attempt:
          // a read that ran and failed is a failure, not "next read at".
          const floorUntil = collector.accountRetryAtMs?.(accountId) ?? null;
          let refreshed = false;
          try {
            refreshed = await collector.refreshAccount(accountId);
          } catch {
            // A failed read is not a floor: no retry time.
          }
          return json({ refreshed, retryAtMs: refreshed ? null : floorUntil });
        }
        return fullRefresh();
      })();
    }
    if (claims && url.pathname === '/v1/resets/claim' && request.method === 'POST') {
      return (async () => {
        let claim: ReturnType<typeof parseResetClaimRequest>;
        try {
          claim = parseResetClaimRequest(JSON.parse(await readText(request.body!, 4096)));
        } catch {
          claim = null;
        }
        if (!claim) return json({ error: 'Invalid reset claim' }, 400);
        try {
          return json(await claims.claim(claim));
        } catch (error) {
          if (error instanceof ResetClaimRefusal) return json(error.detail, error.httpStatus);
          console.error('Reset claim failed');
          return json({ error: 'Reset claim failed' }, 500);
        }
      })();
    }
    if (claims && url.pathname === '/v1/resets/events' && request.method === 'GET') {
      const one = (name: string) => {
        const values = url.searchParams.getAll(name);
        if (values.length > 1) throw new Error(`Invalid ${name}`);
        return values[0];
      };
      try {
        const provider = one('provider');
        const sinceMs = one('sinceMs');
        const reveal = one('reveal');
        if (provider !== undefined && provider !== 'claude' && provider !== 'codex')
          throw new Error('Invalid provider');
        if (sinceMs !== undefined && !/^\d{1,16}$/.test(sinceMs))
          throw new Error('Invalid sinceMs');
        if (reveal !== undefined && reveal !== 'true' && reveal !== 'false')
          throw new Error('Invalid reveal');
        return json({
          events: claims.events({
            provider,
            ...(sinceMs === undefined ? {} : { sinceMs: Number(sinceMs) }),
            reveal: reveal === 'true',
          }),
        });
      } catch {
        return json({ error: 'Invalid reset event filters' }, 400);
      }
    }
    if (url.pathname === '/v1/inventory' && request.method === 'GET') {
      return (async () => {
        const syncedAtMs = collector.inventorySyncedAtMs;
        if (syncedAtMs === null || now() - syncedAtMs > INVENTORY_FRESH_MS) {
          // Reconcile lazily so an outside change shows within one poll. A failed read retires
          // nothing and leaves the last known inventory in place.
          try {
            const change = await collector.syncInventory();
            void collector.pollAdded(change.added).catch(() => {});
          } catch {
            console.error('Quota inventory reconcile failed');
          }
        }
        try {
          const view = buildInventory(
            store.listAccounts(),
            collector.inventorySources,
            collector.inventorySyncedAtMs
          );
          const etag = `"${view.version}"`;
          if (etagMatches(request.headers.get('if-none-match'), etag)) {
            return new Response(null, {
              status: 304,
              headers: { ETag: etag, 'Cache-Control': 'no-store' },
            });
          }
          const response = json(view);
          response.headers.set('ETag', etag);
          return response;
        } catch {
          console.error('Quota inventory read failed');
          return json({ error: 'Credential inventory is temporarily unavailable' }, 503);
        }
      })();
    }
    if (url.pathname === '/v1/inventory/sync' && request.method === 'POST') {
      return (async () => {
        let parsed: SyncRequest | null = null;
        if (request.body) {
          try {
            parsed = parseSyncRequest(await readText(request.body, MAX_SYNC_BODY_BYTES));
          } catch {
            parsed = null;
          }
        }
        if (!parsed) return json({ error: 'Invalid inventory sync body' }, 400);
        try {
          // Only an explicit delete may purge by name; any other reason just reconciles.
          const change = await collector.syncInventory({
            deletedNames: parsed.reason === 'delete' ? parsed.deletedNames : [],
          });
          void collector.pollAdded(change.added).catch(() => {});
          if (collector.inventorySources.every((source) => source.state === 'unavailable')) {
            return json({ error: 'Credential inventory is unavailable' }, 503);
          }
          return json({
            version: inventoryVersion(store.listAccounts()),
            added: change.added.length,
            removed: change.removed.length + change.purged.length,
          });
        } catch {
          console.error('Quota inventory sync failed');
          return json({ error: 'Credential inventory is unavailable' }, 503);
        }
      })();
    }
    if (url.pathname === '/v1/accounts' && request.method === 'GET') {
      const reveal = url.searchParams.getAll('reveal');
      if (reveal.length > 1 || (reveal[0] !== undefined && !['true', 'false'].includes(reveal[0])))
        return json({ error: 'Invalid reveal' }, 400);
      try {
        const view = buildAccounts({
          accounts: store.listAccounts(),
          latestSamples: store.latestSamples(),
          windows: collector.windows ?? new Map(),
          resets: collector.resets ?? new Map(),
          billing: collector.billing ?? new Map(),
          balances: collector.balances ?? new Map(),
          credits: collector.credits,
          nowMs: now(),
          reveal: reveal[0] === 'true',
          collection: {
            lastRefreshAtMs: collector.lastRefreshAtMs,
            nextRefreshAtMs: collector.nextRefreshAtMs,
            refreshing: collector.refreshing,
          },
        });
        const version = accountsVersion(JSON.stringify(view));
        const body = JSON.stringify({ version, ...view });
        const etag = `"${version}"`;
        if (etagMatches(request.headers.get('if-none-match'), etag)) {
          return new Response(null, {
            status: 304,
            headers: { ETag: etag, 'Cache-Control': 'no-store' },
          });
        }
        const response = new Response(body, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            ETag: etag,
          },
        });
        return response;
      } catch {
        console.error('Quota accounts read failed');
        return json({ error: 'Quota accounts are temporarily unavailable' }, 503);
      }
    }
    if (url.pathname !== '/v1/pools' || request.method !== 'GET')
      return json({ error: 'Not found' }, 404);
    let options: DashboardOptions;
    try {
      options = parseOptions(url.searchParams, now());
    } catch {
      return json({ error: 'Invalid dashboard filters' }, 400);
    }
    try {
      const fromMs = Math.min(
        options.nowMs - 6 * HOUR_MS,
        Math.floor(options.nowMs / DAY_MS) * DAY_MS +
          (options.offsetDays - 3) * DAY_MS -
          6 * HOUR_MS
      );
      const firstSamples = store.firstSampleTimes();
      const accounts = store.listAccounts();
      return json({
        ...buildDashboard(
          accounts.map((account) => ({
            ...account,
            firstSampleAtMs: firstSamples.get(account.id) ?? null,
          })),
          store.listSamples(fromMs, options.nowMs, options.window),
          options,
          {
            historyStartedAtMs: store.firstSampleAtMs(),
            lastRefreshAtMs: collector.lastRefreshAtMs,
            nextRefreshAtMs: collector.nextRefreshAtMs,
            refreshing: collector.refreshing,
            issues: collector.issues,
            sources: collector.sources,
            windows: collector.windows,
            resets: collector.resets,
            billing: collector.billing,
          }
        ),
        inventoryVersion: inventoryVersion(accounts),
      });
    } catch {
      console.error('Quota dashboard read failed');
      return json({ error: 'Quota history is temporarily unavailable' }, 503);
    }
  };
}
