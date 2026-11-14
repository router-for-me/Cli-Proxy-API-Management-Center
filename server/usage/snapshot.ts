// A consistent copy of usage.sqlite taken in bounded steps. Used only by backup.ts, where every
// step() is one governed writer-queue chunk. Import it from the writer worker only (store.ts rule).
import { Database } from 'bun:sqlite';

export const SNAPSHOT_ROWS_PER_STEP = 500;

type Key = (string | number | bigint | Uint8Array | null)[];
interface TableCopy {
  name: string;
  /** Resume position: the table's primary key columns, or `rowid`. */
  keys: string[];
  insertColumns: string[];
  selectColumns: string[];
}
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * The copy runs inside ONE read transaction on the live file, so it sees the database as of its
 * first step however many commits the writer makes between steps. SQLite's online backup API
 * cannot do that: any commit from another connection restarts it, and the writer commits every
 * 50 ms. bun:sqlite exposes neither that API nor `sqlite_dbpage`, so rows are copied table by
 * table in primary-key order, inside SQLite (`INSERT ... SELECT`), a bounded page of rows per step.
 *
 * Connection model: the new file is `main`; the live file is attached as `src`. bun:sqlite cannot
 * open URI filenames, so the attach is not read-only at the SQLite level. This class only ever
 * issues SELECTs against `src`, and a test pins that the live file is untouched.
 * The new file is a disposable scratch, so it runs without fsync.
 */
export class UsageSnapshot {
  lastStepRows = 0;
  totalRows = 0;
  steps = 0;
  private db: Database | null;
  private readonly tables: TableCopy[] = [];
  private table = 0;
  private after: Key | null = null;

  constructor(
    sourcePath: string,
    destPath: string,
    private readonly options: { rowsPerStep?: number } = {}
  ) {
    // ATTACH ':memory:' would open a different, empty database and back it up without complaint.
    if (!sourcePath || sourcePath === ':memory:') throw new Error('Usage snapshot needs a file');
    const db = new Database(destPath, { create: true, strict: true });
    this.db = db;
    try {
      // temp_store matters: a multi-row INSERT keeps a statement journal of every page it dirties,
      // and the random-key indexes dirty one page per row. In a temp file that was ~25x the
      // database size in disk writes; in memory it is a few MB per step.
      // cache_size: the random-key indexes (event_detail.execution_id, request_id) re-read and
      // re-write pages the default 2 MB cache cannot hold. Measured on a 350 MB database:
      // 2 MB cache -> 12 GB accounted IO; 32 MB -> 1.1 GB, worst step 18 ms; 64 MB -> 0.6 GB but
      // the final commit flushes the whole dirty cache, worst step 40 ms.
      // journal_mode=OFF is refused here (it reads back "delete"); no matter: the file starts
      // empty, so its rollback journal never holds more than a header.
      db.exec(`PRAGMA synchronous = OFF; PRAGMA temp_store = MEMORY; PRAGMA cache_size = -32768;`);
      db.query('ATTACH DATABASE ? AS src').run(sourcePath);
      db.exec('BEGIN');
      // The first read of `src` fixes the snapshot; it holds until COMMIT or close().
      const pageSize = db.query<{ page_size: number }, []>('PRAGMA src.page_size').get()!.page_size;
      db.exec(`PRAGMA main.page_size = ${pageSize}`);
      const objects = db
        .query<{ name: string; sql: string; type: string }, []>(
          `SELECT name, sql, type FROM src.sqlite_master
           WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
           ORDER BY type = 'table' DESC, rowid`
        )
        .all();
      const withoutRowid = new Set(
        db
          .query<{ name: string; schema: string; wr: number }, []>('PRAGMA table_list')
          .all()
          .filter((row) => row.schema === 'src' && row.wr === 1)
          .map((row) => row.name)
      );
      // A trigger would fire on the copy's own inserts and change the data it copies.
      if (objects.some((object) => object.type === 'trigger'))
        throw new Error('Usage snapshot does not support triggers');
      for (const object of objects) {
        db.exec(object.sql);
        if (object.type === 'table') this.tables.push(this.describe(db, object.name, withoutRowid));
      }
    } catch (error) {
      this.close();
      throw error;
    }
  }

  private describe(db: Database, name: string, withoutRowid: Set<string>): TableCopy {
    const columns = db
      .query<{ name: string; type: string; pk: number; hidden: number }, []>(
        `PRAGMA src.table_xinfo(${quote(name)})`
      )
      // Generated columns recompute on insert; the schema copy already carries them.
      .all()
      .filter((column) => column.hidden === 0);
    const names = columns.map((column) => quote(column.name));
    const primary = columns.filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk);
    if (withoutRowid.has(name)) {
      return {
        name,
        keys: primary.map((column) => quote(column.name)),
        insertColumns: names,
        selectColumns: names,
      };
    }
    // An INTEGER PRIMARY KEY is the rowid itself; any other rowid table needs its rowid carried over.
    const alias = primary.length === 1 && primary[0].type.toUpperCase() === 'INTEGER';
    return {
      name,
      keys: ['rowid'],
      insertColumns: alias ? names : ['rowid', ...names],
      selectColumns: alias ? names : ['rowid', ...names],
    };
  }

  /** Copy the next bounded page of rows. Returns true once the snapshot is committed and closed. */
  step(): boolean {
    const db = this.db;
    if (!db) throw new Error('Usage snapshot is closed');
    const limit = this.options.rowsPerStep ?? SNAPSHOT_ROWS_PER_STEP;
    this.steps += 1;
    this.lastStepRows = 0;
    const table = this.tables[this.table];
    if (!table) {
      db.exec('COMMIT');
      this.close();
      return true;
    }
    const keys = table.keys.join(', ');
    const where = this.after ? `WHERE (${keys}) > (${table.keys.map(() => '?').join(', ')})` : '';
    const copied = db
      .query(
        `INSERT INTO main.${quote(table.name)} (${table.insertColumns.join(', ')})
         SELECT ${table.selectColumns.join(', ')} FROM src.${quote(table.name)} ${where}
         ORDER BY ${keys} LIMIT ${limit}`
      )
      .run(...(this.after ?? [])).changes;
    this.lastStepRows = copied;
    this.totalRows += copied;
    if (copied < limit) {
      this.table += 1;
      this.after = null;
    } else {
      // The key of the last row just written to the new file is the resume position.
      const order = table.keys.map((key) => `${key} DESC`).join(', ');
      const last = db
        .query<Record<string, Key[number]>, []>(
          `SELECT ${keys} FROM main.${quote(table.name)} ORDER BY ${order} LIMIT 1`
        )
        .values()[0] as Key;
      this.after = last;
    }
    return false;
  }

  /** Release the read snapshot and the new file. Safe after commit and when called twice. */
  close(): void {
    const db = this.db;
    this.db = null;
    db?.close();
  }
}
