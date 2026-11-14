#!/usr/bin/env bun
// Restore check for the usage backup: download, integrity, schema, counts against live.
// Prints one JSON verdict on stdout. Live is opened read-only; nothing is written to it.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadBackupConfig } from '../server/usage/backup';
import { IoGovernor } from '../server/usage/ioGovernor';
import { runRestoreCheck } from '../server/usage/restoreCheck';

export const HELP = `Usage: ionice -c3 nice -n10 bun usage-restore-check.js [options]
  --key <object key>      default: the newest usage/daily/ object
  --live <path>           default ~/.local/share/prox-usage/usage.sqlite (opened read-only)
  --config <path>         default ~/.config/prox-usage/backup.json
  --help
Exit 0: the backup restores. 1: it does not, or the check could not run. 130: interrupted.
`;

export function parseArgs(args: string[]) {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const name = args[i];
    if (!['--key', '--live', '--config'].includes(name) || i + 1 >= args.length)
      throw new Error(HELP);
    values[name.slice(2)] = args[(i += 1)];
  }
  return {
    key: values.key,
    live: values.live ?? join(homedir(), '.local/share/prox-usage/usage.sqlite'),
    config: values.config ?? join(homedir(), '.config/prox-usage/backup.json'),
  };
}

// Only messages this tool itself writes reach stdout; anything else could carry a URL or path.
const safe =
  /^(Usage:|Restore|Insufficient|No backup|Backup listing|Missing backup|Invalid backup)/;

if (import.meta.main) {
  if (process.argv.includes('--help')) {
    console.log(HELP);
    process.exit(0);
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    const args = parseArgs(process.argv.slice(2));
    const verdict = await runRestoreCheck({
      config: loadBackupConfig(args.config, process.env),
      livePath: args.live,
      governor: new IoGovernor(),
      key: args.key,
      signal: controller.signal,
    });
    console.log(JSON.stringify(verdict, null, 2));
    process.exitCode = verdict.ok ? 0 : 1;
  } catch (error) {
    const aborted = controller.signal.aborted;
    const message = error instanceof Error && safe.test(error.message) ? error.message : undefined;
    console.log(
      JSON.stringify({
        ok: false,
        error: aborted ? 'Interrupted' : (message ?? 'Restore check could not run'),
      })
    );
    process.exitCode = aborted ? 130 : 1;
  }
}
