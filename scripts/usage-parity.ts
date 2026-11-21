#!/usr/bin/env bun
// Offline parity CLI. No live work on import; credentials stay inside runParity's call frame.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { previousUtcDay } from './usage-parity/matrix';
import { parseDeadline } from './usage-parity/window';
import { validateIntervals } from './usage-parity/events';
import { runParity, parityExitCode, type ParityOptions } from './usage-parity/run';

export const HELP = `Usage: ionice -c3 nice -n10 bun scripts/usage-parity.ts [options]
  --from <UTC ISO timestamp> --to <UTC ISO timestamp>   fixed window, ended >=10 min ago
  --previous-utc-day                                  use the previous UTC day
  --matrix quick|full                                default quick; full is operator-only
  --level both|events|responses                       default both
  --limit <pairs> --sample <base cases>                deterministic smoke controls
  --deadline <HH:MMZ or UTC ISO timestamp>             absolute stop; HH:MMZ is TODAY UTC
  --min-gap-ms <milliseconds>                         default 2000, between every query
  --cpamp-db <path> --prox-db <path>                   read-only; never reconcile/import
  --cpamp-url <loopback URL> --prox-url <loopback URL>
  --cpamp-key-file <path> --prox-key-file <path>        never print file contents
  --rate-book <path>                                  approved deployed book for D5 witnesses
  --cpamp-outages <JSON array file>                    [{from_ms,to_ms,instance,reason}]
  --output <prefix>                                  writes <prefix>.json and <prefix>.md
  --help
Matrix ranges are clipped to --from/--to. Include the earliest aligned 31-day start to preserve every original range length.
A pair means one response from each server. Second pages use each server's own cursor.
--limit caps PAIRS including second pages, not individual HTTP requests.
Queries are forbidden at 01:00–04:00 and 12:20–12:50 UTC. Deadline/forbidden stop exits 2 with incomplete evidence.
SIGINT/SIGTERM writes partial evidence and exits nonzero. Nothing installs/enables the timer.
`;
export function parseArgs(args: string[], now = Date.now()): ParityOptions {
  const values = new Map<string, string>();
  let previous = false;
  const names = [
    'from',
    'to',
    'matrix',
    'level',
    'limit',
    'sample',
    'min-gap-ms',
    'deadline',
    'cpamp-db',
    'prox-db',
    'cpamp-url',
    'prox-url',
    'cpamp-key-file',
    'prox-key-file',
    'rate-book',
    'cpamp-outages',
    'output',
  ];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--previous-utc-day') {
      if (previous) throw new Error('Duplicate --previous-utc-day');
      previous = true;
      continue;
    }
    const name = args[i].slice(2);
    if (
      !args[i].startsWith('--') ||
      !names.includes(name) ||
      values.has(name) ||
      !args[i + 1] ||
      args[i + 1].startsWith('--')
    )
      throw new Error('Invalid or duplicate CLI option');
    values.set(name, args[++i]);
  }
  const get = (key: string, fallback: string) => values.get(key) ?? fallback;
  if (previous && (values.has('from') || values.has('to')))
    throw new Error('Choose explicit window or previous UTC day');
  const parseDate = (key: string) => {
    const text = values.get(key);
    if (
      !text ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(text) ||
      !Number.isSafeInteger(Date.parse(text))
    )
      throw new Error('Supply --from and --to as UTC ISO timestamps');
    return Date.parse(text);
  };
  const window = previous
    ? previousUtcDay(now)
    : { from_ms: parseDate('from'), to_ms: parseDate('to') };
  if (window.from_ms <= 0 || window.from_ms >= window.to_ms || window.to_ms > now - 600_000)
    throw new Error('Window must be fixed and end at least 10 minutes ago');
  const mode = get('matrix', 'quick'),
    level = get('level', 'both');
  if (mode !== 'quick' && mode !== 'full') throw new Error('Invalid matrix');
  if (level !== 'both' && level !== 'events' && level !== 'responses')
    throw new Error('Invalid level');
  const integer = (name: string, fallback?: number, minimum = 1) => {
    const raw = values.get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < minimum)
      throw new Error('Invalid numeric option');
    return value;
  };
  const home = homedir();
  return {
    mode,
    level,
    fromMs: window.from_ms,
    toMs: window.to_ms,
    cpampDb: get('cpamp-db', `${home}/.local/share/cpa-manager-plus/usage.sqlite`),
    proxDb: get('prox-db', `${home}/.local/share/prox-usage/usage.sqlite`),
    cpampUrl: get('cpamp-url', 'http://127.0.0.1:18317/v0/management/monitoring/prox-analytics'),
    proxUrl: get('prox-url', 'http://127.0.0.1:18320/v1/analytics'),
    cpampKeyFile: get('cpamp-key-file', `${home}/.config/prox/cpa-admin-key`),
    proxKeyFile: get('prox-key-file', `${home}/.config/proxd/management-key`),
    rateBookFile: get('rate-book', `${home}/.local/share/prox-usage/usage-rates.json`),
    // Installed units set PROX_USAGE_EVIDENCE_DIR; a repo run keeps the checkout-relative default.
    output: resolve(
      get(
        'output',
        `${process.env.PROX_USAGE_EVIDENCE_DIR || 'docs/evidence/prox-usage-parity'}/${new Date(now).toISOString().replaceAll(':', '-')}-${mode}`
      )
    ),
    limit: integer('limit'),
    sample: integer('sample'),
    deadlineMs: values.has('deadline') ? parseDeadline(values.get('deadline')!, now) : undefined,
    gapMs: integer('min-gap-ms', 2000, 0)!,
    outages: values.has('cpamp-outages')
      ? validateIntervals(JSON.parse(readFileSync(values.get('cpamp-outages')!, 'utf8')))
      : [],
  };
}
if (import.meta.main) {
  if (Bun.argv.slice(2).includes('--help')) {
    console.log(HELP);
  } else {
    const controller = new AbortController();
    const stop = () => controller.abort(new Error('Interrupted'));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    try {
      const options = parseArgs(Bun.argv.slice(2));
      const report = await runParity(options, controller.signal);
      console.log(
        `Parity ${report.status}: ${report.matrix.pairs_completed} pairs; ` +
          `${report.counts.unexplained} unexplained differences. Evidence: ${options.output}.{json,md}`
      );
      process.exitCode = parityExitCode(report);
    } catch {
      console.error(
        'Parity failed before completion. Check CLI options and evidence destination; use --help.'
      );
      process.exitCode = controller.signal.aborted ? 130 : 1;
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    }
  }
}
