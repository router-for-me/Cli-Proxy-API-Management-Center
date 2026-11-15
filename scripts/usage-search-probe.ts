#!/usr/bin/env bun
// Per-column search probe CLI: derives one real term for each of CPAMP's 29 search columns and
// compares the events CPAMP and Prox match. Offline and read-only on both databases; it never
// imports, reconciles or queries a server. Exit 1 when any difference is unexplained.
import { writeFileSync } from 'node:fs';
import { openParityReader } from './usage-parity/events';
import { apiKeyHashParity, probeMarkdown, probeSearchColumns } from './usage-parity/searchProbe';

export const HELP = `Usage: ionice -c3 nice -n10 bun scripts/usage-search-probe.ts --cpamp-db <path> --prox-db <path> \\
  --from <UTC ISO timestamp> --to <UTC ISO timestamp> --output <prefix>
Reads both databases with mode=ro; writes <prefix>.json and <prefix>.md.
`;

function parse(args: string[]): Map<string, string> {
  const values = new Map<string, string>();
  const names = ['cpamp-db', 'prox-db', 'from', 'to', 'output'];
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.slice(2);
    if (!args[i]?.startsWith('--') || !names.includes(name) || values.has(name) || !args[i + 1])
      throw new Error(`Invalid or duplicate option ${args[i]}\n${HELP}`);
    values.set(name, args[i + 1]);
  }
  for (const name of names) if (!values.has(name)) throw new Error(`Missing --${name}\n${HELP}`);
  return values;
}

if (import.meta.main) {
  const values = parse(process.argv.slice(2));
  const instant = (name: string) => {
    const ms = Date.parse(values.get(name)!);
    if (!Number.isSafeInteger(ms)) throw new Error(`Invalid --${name}`);
    return ms;
  };
  const window = { from_ms: instant('from'), to_ms: instant('to') };
  const cpamp = openParityReader(values.get('cpamp-db')!);
  const prox = openParityReader(values.get('prox-db')!);
  try {
    const report = { ...probeSearchColumns(cpamp, prox, window), apiKeyHashes: apiKeyHashParity(cpamp, prox, window) };
    const prefix = values.get('output')!;
    writeFileSync(`${prefix}.json`, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(
      `${prefix}.md`,
      `${probeMarkdown(report)}\n\napi_key_hash: ${report.apiKeyHashes.inProx} of ${report.apiKeyHashes.cpamp} distinct CPAMP values are Prox api_key dictionary values.\n`
    );
    console.log(
      JSON.stringify({
        events: report.events,
        probed: report.probed,
        skipped: report.skipped,
        unexplained: report.unexplained,
        apiKeyHashes: report.apiKeyHashes,
      })
    );
    process.exitCode = report.unexplained === 0 ? 0 : 1;
  } finally {
    cpamp.close();
    prox.close();
  }
}
