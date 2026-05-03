#!/usr/bin/env node
// Promote bench/baseline/frontend.latest.json into the committed
// bench/baseline/frontend.json. The latest file is gitignored so test
// reruns do not dirty the repo. Codex Stage 1 exit review FE-3.
//
// Usage: npm run baseline:update

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const latestPath = path.join(repoRoot, 'bench/baseline/frontend.latest.json');
const committedPath = path.join(repoRoot, 'bench/baseline/frontend.json');

if (!fs.existsSync(latestPath)) {
  console.error(
    `error: ${latestPath} does not exist. Run \`npm run baseline:capture\` (bundle) and/or \`npx playwright test tests/e2e/baseline.spec.ts\` (perf) first.`
  );
  process.exit(1);
}

const latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
fs.writeFileSync(committedPath, JSON.stringify(latest, null, 2) + '\n');
console.log(`Promoted ${latestPath}\n      -> ${committedPath}`);
