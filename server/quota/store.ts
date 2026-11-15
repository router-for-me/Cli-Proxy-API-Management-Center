import { Database } from 'bun:sqlite';
import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { PoolProviderId, PoolWindow } from '../../src/domain/quotaPool/types';
import {
  DAY_MS,
  RETIRED_ACCOUNT_NAME,
  RETIRED_GRACE_MS,
  type InventoryChange,
  type QuotaSample,
  type ResetEvent,
  type ResetReading,
  type StoredAccount,
} from './types';
import { legacyAccountId, sourceAccountId, type LegacySourceMapping } from './identity';

type AccountRow = Omit<
  StoredAccount,
  'disabled' | 'retired' | 'retiredAtMs' | 'instanceId' | 'plan' | 'planObservedAtMs'
> & {
  disabled: number;
  retired: number;
  retiredAtMs: number | null;
};

/** Owns durable account metadata and normalized quota observations; never stores credentials. */
export class QuotaStore {
  private readonly db: Database;

  constructor(
    databasePath: string,
    private readonly now: () => number = Date.now
  ) {
    if (databasePath !== ':memory:') {
      const path = resolve(databasePath);
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      chmodSync(dirname(path), 0o700);
      closeSync(openSync(path, 'a', 0o600));
      chmodSync(path, 0o600);
    }
    this.db = new Database(databasePath, { create: true, strict: true });
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      -- WAL stays consistent with NORMAL; a power loss can drop the last commits, which the
      -- next collection re-reads. FULL fsyncs every commit on the thread serving analytics.
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS quota_accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex')),
        name TEXT NOT NULL,
        email TEXT,
        disabled INTEGER NOT NULL CHECK (disabled IN (0, 1)),
        retired INTEGER NOT NULL CHECK (retired IN (0, 1)),
        lastSeenAtMs INTEGER NOT NULL,
        lastErrorAtMs INTEGER
      );
      CREATE INDEX IF NOT EXISTS quota_accounts_provider ON quota_accounts(provider);
      CREATE TABLE IF NOT EXISTS quota_samples (
        accountId TEXT NOT NULL REFERENCES quota_accounts(id),
        window TEXT NOT NULL CHECK (window IN ('weekly', 'five-hour')),
        observedAtMs INTEGER NOT NULL,
        remainingPercent REAL CHECK (remainingPercent BETWEEN 0 AND 100),
        resetAtMs INTEGER,
        periodHours REAL CHECK (periodHours IS NULL OR periodHours > 0),
        PRIMARY KEY (accountId, window, observedAtMs)
      );
      CREATE INDEX IF NOT EXISTS quota_samples_time ON quota_samples(observedAtMs);
      CREATE INDEX IF NOT EXISTS quota_samples_window_time
        ON quota_samples(window, observedAtMs);
      CREATE TABLE IF NOT EXISTS quota_account_sources (
        accountId TEXT PRIMARY KEY REFERENCES quota_accounts(id),
        instanceId TEXT NOT NULL,
        sourceAccountId TEXT NOT NULL UNIQUE
      );
      CREATE INDEX IF NOT EXISTS quota_account_sources_instance
        ON quota_account_sources(instanceId);
      CREATE TABLE IF NOT EXISTS quota_legacy_sources (
        provider TEXT PRIMARY KEY CHECK (provider IN ('claude', 'codex')),
        instanceId TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quota_account_plans (
        accountId TEXT PRIMARY KEY REFERENCES quota_accounts(id),
        plan TEXT NOT NULL,
        observedAtMs INTEGER NOT NULL
      );
      -- Reset claims are user-requested spends and stay as history: no foreign key, no 30-day
      -- pruning, and an account purge leaves them (they hold opaque ids and readings only).
      CREATE TABLE IF NOT EXISTS quota_reset_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clientRequestId TEXT NOT NULL UNIQUE,
        accountId TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('claude', 'codex')),
        kind TEXT NOT NULL,
        grantId TEXT,
        outcome TEXT NOT NULL,
        requestedAtMs INTEGER NOT NULL,
        settledAtMs INTEGER,
        cooldownCleared INTEGER CHECK (cooldownCleared IS NULL OR cooldownCleared IN (0, 1)),
        beforeJson TEXT,
        afterJson TEXT
      );
      CREATE INDEX IF NOT EXISTS quota_reset_events_time ON quota_reset_events(requestedAtMs);
      CREATE INDEX IF NOT EXISTS quota_reset_events_account
        ON quota_reset_events(accountId, requestedAtMs);
    `);
    this.db
      .transaction(() => {
        // A claim still pending when the process last stopped may have been sent: never failed.
        this.db
          .query("UPDATE quota_reset_events SET outcome = 'unknown' WHERE outcome = 'pending'")
          .run();
        const columns = this.db
          .query<{ name: string }, []>('PRAGMA table_info(quota_accounts)')
          .all();
        if (!columns.some((column) => column.name === 'retiredAtMs')) {
          this.db.exec('ALTER TABLE quota_accounts ADD COLUMN retiredAtMs INTEGER');
        }
        // Accounts retired before this column existed scrub now and purge after the grace period.
        this.db
          .query(
            `UPDATE quota_accounts SET email = NULL, name = ?, retiredAtMs = COALESCE(retiredAtMs, ?)
             WHERE retired = 1`
          )
          .run(RETIRED_ACCOUNT_NAME, this.now());
      })
      .immediate();
  }

  listAccounts(): StoredAccount[] {
    return this.db
      .query<
        AccountRow & {
          instanceId: string | null;
          sourceAccountId: string | null;
          plan: string | null;
          planObservedAtMs: number | null;
        },
        []
      >(
        `
        SELECT a.*, s.instanceId, s.sourceAccountId, p.plan, p.observedAtMs AS planObservedAtMs
        FROM quota_accounts a
        LEFT JOIN quota_account_sources s ON s.accountId = a.id
        LEFT JOIN quota_account_plans p ON p.accountId = a.id
        ORDER BY a.provider, a.id
      `
      )
      .all()
      .map(({ instanceId, sourceAccountId, plan, planObservedAtMs, retiredAtMs, ...row }) => ({
        ...row,
        ...(retiredAtMs === null ? {} : { retiredAtMs }),
        ...(instanceId === null ? {} : { instanceId }),
        ...(sourceAccountId === null ? {} : { sourceAccountId }),
        ...(plan === null || planObservedAtMs === null ? {} : { plan, planObservedAtMs }),
        disabled: row.disabled === 1,
        retired: row.retired === 1,
      }));
  }

  /** Add ownership only. Unknown legacy providers remain unresolved and untouched.
   * A conflicting attribution or alias collision rolls back the entire mapping.
   */
  migrateLegacySources(
    mappings: readonly LegacySourceMapping[],
    knownInstanceIds: readonly string[]
  ): void {
    const providers = new Set<PoolProviderId>();
    for (const mapping of mappings) {
      if (providers.has(mapping.provider) || !knownInstanceIds.includes(mapping.instanceId)) {
        throw new Error('Ambiguous or unknown legacy quota source');
      }
      providers.add(mapping.provider);
    }
    this.db
      .transaction(() => {
        for (const { provider, instanceId } of mappings) {
          const previous = this.db
            .query<{ instanceId: string }, [string]>(
              'SELECT instanceId FROM quota_legacy_sources WHERE provider = ?'
            )
            .get(provider);
          if (previous && previous.instanceId !== instanceId) {
            throw new Error('Conflicting legacy quota source');
          }
          this.db
            .query(
              `
          INSERT INTO quota_legacy_sources (provider, instanceId) VALUES (?, ?)
          ON CONFLICT(provider) DO NOTHING
        `
            )
            .run(provider, instanceId);
          const unresolved = this.db
            .query<{ id: string }, [string]>(
              `
          SELECT id FROM quota_accounts WHERE provider = ?
          AND NOT EXISTS (SELECT 1 FROM quota_account_sources WHERE accountId = id)
        `
            )
            .all(provider);
          const insert = this.db.query(`
          INSERT INTO quota_account_sources (accountId, instanceId, sourceAccountId)
          VALUES (?, ?, ?)
        `);
          for (const { id } of unresolved)
            insert.run(id, instanceId, sourceAccountId(instanceId, id));
        }
      })
      .immediate();
  }

  /** Resolve a source-local occurrence, including explicitly attributed legacy IDs. */
  accountIdFor(instanceId: string, provider: PoolProviderId, authIndex: string): string {
    const id = sourceAccountId(instanceId, legacyAccountId(provider, authIndex));
    return (
      this.db
        .query<{ accountId: string }, [string]>(
          'SELECT accountId FROM quota_account_sources WHERE sourceAccountId = ?'
        )
        .get(id)?.accountId ?? id
    );
  }

  listSamples(fromMs: number, toMs: number, window?: PoolWindow): QuotaSample[] {
    if (window !== undefined) {
      return this.db
        .query<QuotaSample, [number, number, PoolWindow]>(
          `
        SELECT * FROM quota_samples WHERE observedAtMs BETWEEN ? AND ? AND window = ?
        ORDER BY observedAtMs, accountId, window
      `
        )
        .all(fromMs, toMs, window);
    }
    return this.db
      .query<QuotaSample, [number, number]>(
        `
      SELECT * FROM quota_samples WHERE observedAtMs BETWEEN ? AND ?
      ORDER BY observedAtMs, accountId, window
    `
      )
      .all(fromMs, toMs);
  }

  /** Each account's earliest sample in any window: when it joined its pool's history. */
  firstSampleTimes(): Map<string, number> {
    return new Map(
      this.db
        .query<{ accountId: string; atMs: number }, []>(
          'SELECT accountId, MIN(observedAtMs) AS atMs FROM quota_samples GROUP BY accountId'
        )
        .all()
        .map(({ accountId, atMs }) => [accountId, atMs])
    );
  }

  firstSampleAtMs(): number | null {
    return (
      this.db
        .query<{ atMs: number | null }, []>('SELECT MIN(observedAtMs) AS atMs FROM quota_samples')
        .get()?.atMs ?? null
    );
  }

  /** Call only with a validated, complete inventory for this instance/provider.
   * Omitting instanceId supports legacy fixtures and touches only unresolved rows.
   *
   * Accounts absent from it are retired in the same transaction: email and name are scrubbed
   * and `retiredAtMs` is stamped once. Absent accounts whose file name is in `deletedNames`
   * (the user deleted them by name and this inventory confirms they are gone) are purged now;
   * the name is matched before the scrub removes it. Returns the ids that changed.
   */
  recordInventory(
    provider: PoolProviderId,
    accounts: StoredAccount[],
    nowMs: number,
    instanceId?: string,
    deletedNames?: ReadonlySet<string>
  ): InventoryChange {
    const ids = new Set<string>();
    for (const account of accounts) {
      if (
        account.provider !== provider ||
        account.instanceId !== instanceId ||
        ids.has(account.id)
      ) {
        throw new Error('Invalid quota inventory');
      }
      ids.add(account.id);
    }
    const change: InventoryChange = { added: [], removed: [], purged: [] };
    this.db.transaction(() => {
      const scoped = this.db
        .query<{ id: string; name: string; retired: number; retiredAtMs: number | null }, string[]>(
          `
        SELECT id, name, retired, retiredAtMs FROM quota_accounts WHERE provider = ? AND
        ${
          instanceId === undefined
            ? 'NOT EXISTS (SELECT 1 FROM quota_account_sources WHERE accountId = id)'
            : 'id IN (SELECT accountId FROM quota_account_sources WHERE instanceId = ?)'
        }
      `
        )
        .all(...(instanceId === undefined ? [provider] : [provider, instanceId]));
      const existing = this.db.query<
        { provider: PoolProviderId; instanceId: string | null; retired: number },
        [string]
      >(`
        SELECT a.provider, a.retired, s.instanceId FROM quota_accounts a
        LEFT JOIN quota_account_sources s ON s.accountId = a.id WHERE a.id = ?
      `);
      const upsert = this.db.query(`
        INSERT INTO quota_accounts
          (id, provider, name, email, disabled, retired, lastSeenAtMs, lastErrorAtMs)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email,
          disabled = excluded.disabled, retired = 0, retiredAtMs = NULL,
          lastSeenAtMs = excluded.lastSeenAtMs
      `);
      for (const account of accounts) {
        const previous = existing.get(account.id);
        if (!previous || previous.retired === 1) change.added.push(account.id);
        if (
          previous &&
          (previous.provider !== provider || (previous.instanceId ?? undefined) !== instanceId)
        ) {
          throw new Error('Invalid quota identity');
        }
        if (
          !previous &&
          instanceId !== undefined &&
          !account.id.startsWith(`${instanceId}:${provider}:`)
        ) {
          throw new Error('Invalid quota identity');
        }
        upsert.run(
          account.id,
          provider,
          account.name,
          account.email,
          Number(account.disabled),
          nowMs,
          account.lastErrorAtMs
        );
        if (!previous && instanceId !== undefined) {
          this.db
            .query(
              `
            INSERT INTO quota_account_sources (accountId, instanceId, sourceAccountId)
            VALUES (?, ?, ?)
          `
            )
            .run(account.id, instanceId, account.id);
        }
      }
      const retire = this.db.query(
        'UPDATE quota_accounts SET retired = 1, email = NULL, name = ?, retiredAtMs = ? WHERE id = ?'
      );
      const stamp = this.db.query('UPDATE quota_accounts SET retiredAtMs = ? WHERE id = ?');
      for (const row of scoped) {
        if (ids.has(row.id)) continue;
        if (row.retired === 0) {
          if (deletedNames?.has(row.name)) {
            this.purgeInTransaction([row.id]);
            change.purged.push(row.id);
          } else {
            retire.run(RETIRED_ACCOUNT_NAME, nowMs, row.id);
            change.removed.push(row.id);
          }
        } else if (row.retiredAtMs === null) {
          stamp.run(nowMs, row.id);
        }
      }
    })();
    return change;
  }

  /** Remove accounts and everything referencing them. Children first: foreign keys are ON. */
  private purgeInTransaction(accountIds: readonly string[]): void {
    for (const table of ['quota_samples', 'quota_account_plans', 'quota_account_sources']) {
      const remove = this.db.query(`DELETE FROM ${table} WHERE accountId = ?`);
      for (const id of accountIds) remove.run(id);
    }
    const remove = this.db.query('DELETE FROM quota_accounts WHERE id = ?');
    for (const id of accountIds) remove.run(id);
  }

  /** Purge accounts that are already retired. A live account is never touched. Returns the ids. */
  purgeRetired(accountIds: readonly string[]): string[] {
    let purged: string[] = [];
    this.db.transaction(() => {
      const retired = this.db.query<{ id: string }, [string]>(
        'SELECT id FROM quota_accounts WHERE id = ? AND retired = 1'
      );
      purged = accountIds.filter((id) => Boolean(retired.get(id)));
      this.purgeInTransaction(purged);
    })();
    return purged;
  }

  /** True while the account exists and is in its inventory. */
  isLive(accountId: string): boolean {
    return Boolean(
      this.db
        .query<{ live: number }, [string]>(
          'SELECT 1 AS live FROM quota_accounts WHERE id = ? AND retired = 0'
        )
        .get(accountId)
    );
  }

  recordSamples(samples: QuotaSample[]): void {
    this.db.transaction(() => {
      const insert = this.db.query(`
        INSERT INTO quota_samples
          (accountId, window, observedAtMs, remainingPercent, resetAtMs, periodHours)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(accountId, window, observedAtMs) DO NOTHING
      `);
      const clearError = this.db.query(`
        UPDATE quota_accounts SET lastErrorAtMs = NULL
        WHERE id = ? AND lastErrorAtMs <= ?
      `);
      for (const sample of samples) {
        if (
          (sample.remainingPercent !== null && !Number.isFinite(sample.remainingPercent)) ||
          !Number.isSafeInteger(sample.observedAtMs) ||
          (sample.resetAtMs !== null && !Number.isSafeInteger(sample.resetAtMs)) ||
          (sample.periodHours !== null && !Number.isFinite(sample.periodHours))
        ) {
          throw new Error('Invalid quota sample');
        }
        insert.run(
          sample.accountId,
          sample.window,
          sample.observedAtMs,
          sample.remainingPercent,
          sample.resetAtMs,
          sample.periodHours
        );
        clearError.run(sample.accountId, sample.observedAtMs);
      }
    })();
  }

  recordPlan(accountId: string, plan: string, nowMs: number): void {
    this.db
      .query(
        `INSERT INTO quota_account_plans (accountId, plan, observedAtMs) VALUES (?, ?, ?)
         ON CONFLICT(accountId) DO UPDATE SET plan = excluded.plan, observedAtMs = excluded.observedAtMs`
      )
      .run(accountId, plan, nowMs);
  }

  markAccountError(id: string, nowMs: number): void {
    this.db.query('UPDATE quota_accounts SET lastErrorAtMs = ? WHERE id = ?').run(nowMs, id);
  }

  /** Drops old samples and purges accounts retired for the whole grace period; returns their ids. */
  prune(nowMs: number): string[] {
    let purged: string[] = [];
    this.db.transaction(() => {
      this.db.query('DELETE FROM quota_samples WHERE observedAtMs < ?').run(nowMs - 30 * DAY_MS);
      purged = this.db
        .query<{ id: string }, [number]>(
          'SELECT id FROM quota_accounts WHERE retired = 1 AND retiredAtMs <= ?'
        )
        .all(nowMs - RETIRED_GRACE_MS)
        .map(({ id }) => id);
      this.purgeInTransaction(purged);
    })();
    return purged;
  }

  /** Records a claim about to be sent, as `pending`. Throws when the request id was used before. */
  insertResetEvent(input: {
    accountId: string;
    provider: PoolProviderId;
    kind: string;
    grantId: string | null;
    clientRequestId: string;
    requestedAtMs: number;
    before: ResetReading | null;
  }): ResetEvent {
    const { lastInsertRowid } = this.db
      .query(
        `INSERT INTO quota_reset_events
           (clientRequestId, accountId, provider, kind, grantId, outcome, requestedAtMs, beforeJson)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(
        input.clientRequestId,
        input.accountId,
        input.provider,
        input.kind,
        input.grantId,
        input.requestedAtMs,
        input.before ? JSON.stringify(input.before) : null
      );
    return this.resetEventById(Number(lastInsertRowid))!;
  }

  /** `settledAtMs` stays null while the outcome is `unknown`. */
  settleResetEvent(
    id: number,
    outcome: string,
    settledAtMs: number | null,
    cooldownCleared: boolean | null
  ): void {
    this.db
      .query(
        'UPDATE quota_reset_events SET outcome = ?, settledAtMs = ?, cooldownCleared = ? WHERE id = ?'
      )
      .run(outcome, settledAtMs, cooldownCleared === null ? null : Number(cooldownCleared), id);
  }

  setResetEventAfter(id: number, after: ResetReading | null): void {
    this.db
      .query('UPDATE quota_reset_events SET afterJson = ? WHERE id = ?')
      .run(after ? JSON.stringify(after) : null, id);
  }

  resetEventById(id: number): ResetEvent | null {
    return this.resetEvents('WHERE id = ?', [id])[0] ?? null;
  }

  resetEventByRequestId(clientRequestId: string): ResetEvent | null {
    return this.resetEvents('WHERE clientRequestId = ?', [clientRequestId])[0] ?? null;
  }

  /** The account's newest claim that may have been sent without an answer, from `sinceMs` on. */
  latestUnknownResetEvent(accountId: string, sinceMs: number): ResetEvent | null {
    return (
      this.resetEvents(
        "WHERE accountId = ? AND outcome = 'unknown' AND requestedAtMs >= ?",
        [accountId, sinceMs],
        1
      )[0] ?? null
    );
  }

  /** Newest first. */
  listResetEvents(filter: { provider?: PoolProviderId; sinceMs?: number; limit?: number }) {
    const where = ['1 = 1'];
    const params: (string | number)[] = [];
    if (filter.provider) {
      where.push('provider = ?');
      params.push(filter.provider);
    }
    if (filter.sinceMs !== undefined) {
      where.push('requestedAtMs >= ?');
      params.push(filter.sinceMs);
    }
    return this.resetEvents(`WHERE ${where.join(' AND ')}`, params, filter.limit ?? 500);
  }

  private resetEvents(where: string, params: (string | number)[], limit = 500): ResetEvent[] {
    return this.db
      .query<
        Omit<ResetEvent, 'cooldownCleared' | 'before' | 'after'> & {
          cooldownCleared: number | null;
          beforeJson: string | null;
          afterJson: string | null;
        },
        (string | number)[]
      >(
        `SELECT * FROM quota_reset_events ${where} ORDER BY requestedAtMs DESC, id DESC LIMIT ${limit}`
      )
      .all(...params)
      .map(({ cooldownCleared, beforeJson, afterJson, ...row }) => ({
        ...row,
        cooldownCleared: cooldownCleared === null ? null : cooldownCleared === 1,
        before: beforeJson ? (JSON.parse(beforeJson) as ResetReading) : null,
        after: afterJson ? (JSON.parse(afterJson) as ResetReading) : null,
      }));
  }

  close(): void {
    this.db.close();
  }
}
