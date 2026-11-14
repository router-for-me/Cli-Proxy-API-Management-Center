import { mkdtempSync, readFileSync, rmSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { IoGovernor, runIoChunk, type ChunkScheduler, type IoBytes } from './ioGovernor';
import { UsageSnapshot } from './snapshot';
import type { UsageStore } from './store';

export interface BackupConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  sessionToken?: string;
  tmpfsDir?: string;
}

/** JSON config file, optionally overridden by explicit PROX_USAGE_BACKUP_* environment values. */
export function loadBackupConfig(
  path = process.env.PROX_USAGE_BACKUP_CONFIG,
  env: Record<string, string | undefined> = process.env
): BackupConfig {
  let file: Record<string, unknown> = {};
  if (path) {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Backup config must be a JSON object');
    }
    file = parsed as Record<string, unknown>;
  }
  const value = (name: string, variable: string, required = true): string | undefined => {
    const result = env[`PROX_USAGE_BACKUP_${variable}`] ?? file[name];
    if (typeof result === 'string' && result.trim()) return result;
    if (required) throw new Error(`Missing backup configuration: ${name}`);
    return undefined;
  };
  const config: BackupConfig = {
    endpoint: value('endpoint', 'ENDPOINT')!,
    bucket: value('bucket', 'BUCKET')!,
    accessKeyId: value('accessKeyId', 'ACCESS_KEY_ID')!,
    secretAccessKey: value('secretAccessKey', 'SECRET_ACCESS_KEY')!,
    region: value('region', 'REGION', false),
    sessionToken: value('sessionToken', 'SESSION_TOKEN', false),
    tmpfsDir: value('tmpfsDir', 'TMPFS_DIR', false),
  };
  validateConfig(config);
  return config;
}

function validateConfig(config: BackupConfig): void {
  let url: URL;
  try {
    url = new URL(config.endpoint);
  } catch {
    throw new Error('Invalid backup endpoint');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('Backup endpoint must be HTTP(S), without credentials, query or fragment');
  }
  if (!config.bucket || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error('Backup bucket and credentials are required');
  }
}

export interface BackupOptions {
  governor: IoGovernor;
  now?: () => number;
  /** Linux tmpfs probe and syscall counters are injectable for synthetic failure tests. */
  filesystemInfo?: (path: string) => { isTmpfs: boolean; freeBytes: number };
  ioBytes?: () => IoBytes;
  scheduleChunk?: ChunkScheduler;
  /** Longest a snapshot may stay open, wall time including IO pauses. Default 2 hours. */
  maxSnapshotMs?: number;
  /** Rows copied per writer-queue chunk. Default SNAPSHOT_ROWS_PER_STEP. */
  rowsPerStep?: number;
}

export function filesystemInfo(path: string) {
  const stats = statfsSync(path, { bigint: true });
  return { isTmpfs: stats.type === 0x01021994n, freeBytes: Number(stats.bavail * stats.bsize) };
}

/** Run in P2's writer queue; no scheduling, connection opening or bucket deletion here. */
export class UsageBackup {
  private lastSuccess: number | null = null;

  constructor(
    private readonly config: BackupConfig,
    private readonly options: BackupOptions
  ) {
    validateConfig(config);
  }

  get lastSuccessAtMs(): number | null {
    return this.lastSuccess;
  }

  async run(store: UsageStore, signal?: AbortSignal) {
    const tmpfsDir = this.config.tmpfsDir ?? '/dev/shm';
    const now = this.options.now ?? Date.now;
    const date = new Date(now());
    const stamp = date.toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `usage-${stamp}.sqlite`;
    const keys = [`usage/daily/${filename}`];
    if (date.getUTCDay() === 0) keys.push(`usage/weekly/${filename}`);
    const maxSnapshotMs = this.options.maxSnapshotMs ?? 2 * 60 * 60 * 1000;
    let directory: string | undefined;
    let snapshot: UsageSnapshot | undefined;
    const chunk = { count: 0, maxMs: 0 };
    // Each call is one writer-queue chunk, so `maxMs` is the longest the writer was held.
    const timed = <T>(work: () => T) => {
      const began = performance.now();
      try {
        return work();
      } finally {
        chunk.count += 1;
        chunk.maxMs = Math.max(chunk.maxMs, performance.now() - began);
      }
    };
    // An open snapshot pins the live WAL. The bound is a signal, not a check inside a chunk, so it
    // also ends waits for admission under IO pressure and for byte-debt pacing.
    const deadline = AbortSignal.timeout(maxSnapshotMs);
    const chunkOptions = {
      ...this.options,
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    };
    try {
      let path: string;
      try {
        path = await runIoChunk(
          'backup',
          () =>
            timed(() => {
              const info = (this.options.filesystemInfo ?? filesystemInfo)(tmpfsDir);
              if (!info.isTmpfs) throw new Error('Usage backup directory must be tmpfs');
              // WAL-inclusive size while the writer job owns the handle. The copy holds rows only,
              // so it is never larger than the database; the margin covers growth during the copy.
              const size = store.databaseSizeBytes();
              if (info.freeBytes < size + size / 10) {
                throw new Error(
                  'Insufficient tmpfs space: usage backup requires the database size plus 10%'
                );
              }
              directory = mkdtempSync(join(tmpfsDir, 'prox-usage-backup-'));
              const path = join(directory, filename);
              snapshot = new UsageSnapshot(store.eventsPath, path, {
                rowsPerStep: this.options.rowsPerStep,
              });
              return path;
            }),
          chunkOptions
        );
        while (!(await runIoChunk('backup', () => timed(() => snapshot!.step()), chunkOptions)));
      } catch (error) {
        if (deadline.aborted && !signal?.aborted)
          throw new Error('Usage backup snapshot exceeded its time bound');
        throw error;
      }
      const size = Bun.file(path).size;
      for (const key of keys) await this.upload(path, key, size, signal);
      this.lastSuccess = now();
      return {
        keys,
        sizeBytes: size,
        lastSuccessAtMs: this.lastSuccess,
        snapshot: { steps: chunk.count, rows: snapshot!.totalRows, maxStepMs: chunk.maxMs },
      };
    } finally {
      // Release the live read snapshot before the file goes: a failed run must not pin the WAL.
      snapshot?.close();
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
  }

  private async upload(
    path: string,
    key: string,
    size: number,
    signal?: AbortSignal
  ): Promise<void> {
    // Pinned Bun 1.4.3 has S3Client. Its native signer avoids maintaining SigV4 ourselves.
    // A presigned single PUT lets the stream retain our bounded chunks and backpressure, rather
    // than letting the S3 multipart writer buffer/retry parts outside the byte governor.
    const client = new Bun.S3Client({ ...this.config, region: this.config.region ?? 'us-east-1' });
    const { governor } = this.options;
    const file = Bun.file(path);
    let offset = 0;
    const transfer = new AbortController();
    const uploadSignal = signal ? AbortSignal.any([signal, transfer.signal]) : transfer.signal;
    let pulling: Promise<void> | undefined;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulling = (async () => {
            try {
              uploadSignal.throwIfAborted();
              if (offset === size) {
                controller.close();
                return;
              }
              await governor.waitForQuietIo(uploadSignal);
              const bytes = new Uint8Array(
                await file.slice(offset, offset + 64 * 1024).arrayBuffer()
              );
              if (!bytes.length)
                throw new Error('Usage backup file ended before its declared size');
              // Count the tmpfs read and the upload write. Pace BEFORE enqueueing network bytes.
              await governor.reportBytes(
                { read: bytes.length, written: bytes.length },
                uploadSignal
              );
              offset += bytes.length;
              controller.enqueue(bytes);
            } catch (error) {
              controller.error(error);
            }
          })();
          return pulling;
        },
      },
      { highWaterMark: 0 }
    );
    try {
      let response: Response;
      try {
        response = await fetch(client.presign(key, { method: 'PUT', expiresIn: 86_400 }), {
          method: 'PUT',
          headers: { 'Content-Length': String(size) },
          body,
          signal: uploadSignal,
          // Never send the presigned credentials to a redirect target.
          redirect: 'error',
        });
      } catch {
        signal?.throwIfAborted();
        throw new Error('Usage backup upload failed');
      }
      await response.body?.cancel();
      if (!response.ok) throw new Error(`Usage backup upload failed: HTTP ${response.status}`);
      if (offset !== size) throw new Error('Usage backup upload did not consume the entire file');
    } finally {
      // fetch abort may settle before a paced stream pull does. Settle it before reusing
      // the shared governor or removing the snapshot during cancellation/shutdown.
      transfer.abort();
      await pulling;
    }
  }
}

export type BackupReport = Awaited<ReturnType<UsageBackup['run']>>;
