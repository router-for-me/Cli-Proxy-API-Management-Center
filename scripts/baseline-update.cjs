#!/usr/bin/env node
// Promote bench/baseline/frontend.latest.json into the committed
// bench/baseline/frontend.json by SECTION-WISE MERGE rather than
// overwrite. Each capture path (bundle script, Playwright spec) writes
// only its own section into .latest with a section-level captured_at.
// baseline:update walks bundle and perf independently and replaces the
// matching field in the committed file only when latest carries
// STRICTLY NEWER data than committed.
//
// This preserves Codex Stage 1 exit round 1 FE-3's split-capture
// goal, fixes round 2 FE-R2-4 (no perf:null promotion over committed
// perf), and addresses round 3 FE-R3-1 (no stale-section promotion:
// section captured_at must be newer than committed's same section).
//
// Usage: npm run baseline:update [-- --section=bundle|perf|all] [--force]
//   --section=bundle   promote only the bundle section
//   --section=perf     promote only the perf section
//   --force            override the strictly-newer freshness check
//   default            promote whichever sections are strictly newer
//
// Top-level metadata (captured_at/branch/commit) is updated to match
// the most recent of the promoted sections, not the latest file's
// top-level metadata directly — that keeps committed metadata
// consistent with the promoted sections rather than an unrelated
// scaffolded latest.

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const latestPath = path.join(repoRoot, 'bench/baseline/frontend.latest.json');
const committedPath = path.join(repoRoot, 'bench/baseline/frontend.json');

const sectionArg = process.argv.find((a) => a.startsWith('--section='));
const section = sectionArg ? sectionArg.split('=')[1] : 'all';
const force = process.argv.includes('--force');

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

const promoteBundle = section === 'all' || section === 'bundle';
const promotePerf = section === 'all' || section === 'perf';

function parseTs(value) {
  if (typeof value !== 'string') return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

// sectionTimestamp returns the freshness timestamp for a captured
// section. Prefers the section-level captured_at; falls back to the
// surrounding object's top-level captured_at as a one-time migration
// path for committed baselines that pre-date round 3 (those did not
// carry per-section timestamps).
function sectionTimestamp(sec, fallbackTop) {
  if (sec == null || typeof sec !== 'object') return 0;
  const own = parseTs(sec.captured_at);
  if (own > 0) return own;
  return parseTs(fallbackTop);
}

const promoted = [];
const skipped = [];

if (promoteBundle && latest.bundle) {
  const latestTs = sectionTimestamp(latest.bundle, latest.captured_at);
  const committedTs = sectionTimestamp(committed.bundle, committed.captured_at);
  if (force || latestTs === 0 || latestTs > committedTs) {
    committed.bundle = latest.bundle;
    promoted.push('bundle');
  } else {
    skipped.push(
      `bundle (latest captured_at=${latest.bundle.captured_at ?? latest.captured_at ?? '<missing>'} not newer than committed=${committed.bundle?.captured_at ?? committed.captured_at ?? '<missing>'})`
    );
  }
}

if (promotePerf && latest.perf != null) {
  const latestTs = sectionTimestamp(latest.perf, latest.captured_at);
  const committedTs = sectionTimestamp(committed.perf, committed.captured_at);
  if (force || latestTs === 0 || latestTs > committedTs) {
    committed.perf = latest.perf;
    promoted.push('perf');
  } else {
    skipped.push(
      `perf (latest captured_at=${latest.perf.captured_at ?? latest.captured_at ?? '<missing>'} not newer than committed=${committed.perf?.captured_at ?? committed.captured_at ?? '<missing>'})`
    );
  }
}

if (promoted.length === 0) {
  if (skipped.length > 0) {
    console.log(
      `nothing promoted; skipped because not strictly newer:\n  - ${skipped.join('\n  - ')}\nUse --force to override.`
    );
  } else {
    console.log(
      `nothing to promote: latest had no ${section === 'all' ? 'bundle or perf' : section} data`
    );
  }
  process.exit(0);
}

// Update top-level metadata from the most recent promoted section so
// the committed file's top-level captured_at agrees with what was
// actually promoted, not whatever scaffolded data sits in latest.
let newest = { ts: 0, source: null };
if (promoted.includes('bundle') && committed.bundle) {
  const ts = sectionTimestamp(committed.bundle);
  if (ts > newest.ts) newest = { ts, source: 'bundle' };
}
if (promoted.includes('perf') && committed.perf) {
  const ts = sectionTimestamp(committed.perf);
  if (ts > newest.ts) newest = { ts, source: 'perf' };
}
if (newest.source) {
  const sec = newest.source === 'bundle' ? committed.bundle : committed.perf;
  if (sec.captured_at) committed.captured_at = sec.captured_at;
}
// Branch/commit always come from the latest run if present (the script
// itself rewrites them per capture). Skip if absent so a perf-only
// promotion does not zero out a previously-committed branch.
if (latest.branch) committed.branch = latest.branch;
if (latest.commit) committed.commit = latest.commit;
if (latest.commit_short) committed.commit_short = latest.commit_short;

fs.writeFileSync(committedPath, JSON.stringify(committed, null, 2) + '\n');
const skippedSuffix = skipped.length > 0 ? `\n      (skipped ${skipped.join(', ')})` : '';
console.log(
  `Promoted ${promoted.join(', ')} from ${latestPath}\n      -> ${committedPath}${skippedSuffix}`
);
