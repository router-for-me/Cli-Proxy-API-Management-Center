#!/usr/bin/env node
// Promote bench/baseline/frontend.latest.json into the committed
// bench/baseline/frontend.json by SECTION-WISE MERGE rather than
// overwrite. Each capture path (bundle script, Playwright spec) writes
// only its own section into .latest. baseline:update walks bundle and
// perf independently and replaces the matching field in the committed
// file only when latest carries fresh data for it.
//
// This preserves Codex Stage 1 exit round 1 FE-3's split-capture
// goal AND fixes round 2 FE-R2-4: a clean bundle-only run no longer
// promotes "perf: null" over a previously-committed perf section.
//
// Usage: npm run baseline:update [-- --section=bundle|perf|all]
//   --section=bundle  promote only the bundle section
//   --section=perf    promote only the perf section
//   default           promote whichever sections are present in latest

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const latestPath = path.join(repoRoot, 'bench/baseline/frontend.latest.json');
const committedPath = path.join(repoRoot, 'bench/baseline/frontend.json');

const sectionArg = process.argv.find((a) => a.startsWith('--section='));
const section = sectionArg ? sectionArg.split('=')[1] : 'all';

if (!fs.existsSync(latestPath)) {
  console.error(
    `error: ${latestPath} does not exist. Run \`npm run baseline:capture\` (bundle) and/or \`npx playwright test tests/e2e/baseline.spec.ts\` (perf) first.`
  );
  process.exit(1);
}

const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
let committed = {};
if (fs.existsSync(committedPath)) {
  try {
    committed = JSON.parse(fs.readFileSync(committedPath, 'utf8'));
  } catch {
    committed = {};
  }
}

// Always pull metadata from latest if present so the committed file
// records the most recent capture's branch/commit; merging the two
// payloads is more honest than copy-from-stale.
if (latest.captured_at) committed.captured_at = latest.captured_at;
if (latest.branch) committed.branch = latest.branch;
if (latest.commit) committed.commit = latest.commit;
if (latest.commit_short) committed.commit_short = latest.commit_short;

const promoteBundle = section === 'all' || section === 'bundle';
const promotePerf = section === 'all' || section === 'perf';

const promoted = [];
if (promoteBundle && latest.bundle) {
  committed.bundle = latest.bundle;
  promoted.push('bundle');
}
if (promotePerf && latest.perf != null) {
  committed.perf = latest.perf;
  promoted.push('perf');
}

if (promoted.length === 0) {
  console.log(
    `nothing to promote: latest had no ${section === 'all' ? 'bundle or perf' : section} data`
  );
  process.exit(0);
}

fs.writeFileSync(committedPath, JSON.stringify(committed, null, 2) + '\n');
console.log(`Promoted ${promoted.join(', ')} from ${latestPath}\n      -> ${committedPath}`);
