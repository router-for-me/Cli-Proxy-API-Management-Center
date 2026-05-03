#!/usr/bin/env bash
# Capture frontend baseline metrics for refactor regression checks.
#
# Output: bench/baseline/frontend.latest.json (gitignored).
#
# Run `npm run baseline:update` to promote frontend.latest.json into the
# committed baseline at bench/baseline/frontend.json. Codex Stage 1 exit
# review FE-3: previously this script + the Playwright capture both
# overwrote the committed baseline (resetting `perf: null`); split into
# capture (latest) + explicit update keeps the committed baseline stable
# across reruns.
#
# Currently captures bundle size only. Playwright-based TTI / FPS /
# heap-delta capture lives in tests/e2e/baseline.spec.ts (separate
# concern, browser install required) and writes to the same .latest.json
# under the `perf` key.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

mkdir -p bench/baseline

echo "Building production bundle..."
BUILD_LOG="$(mktemp)"
trap 'rm -f "$BUILD_LOG"' EXIT
if ! npm run build > "$BUILD_LOG" 2>&1; then
  echo "Build failed:"
  cat "$BUILD_LOG"
  exit 1
fi

# Vite emits dist/index.html; the release pipeline renames to management.html.
# We measure whichever exists.
if [ -f dist/management.html ]; then
  PRIMARY="dist/management.html"
elif [ -f dist/index.html ]; then
  PRIMARY="dist/index.html"
else
  echo "ERROR: no dist/management.html or dist/index.html after build" >&2
  exit 1
fi

RAW_BYTES=$(stat -c%s "$PRIMARY")
GZ_BYTES=$(gzip -9 -c "$PRIMARY" | wc -c)
DIST_LIST=$(cd dist && ls -1 | sort | paste -sd ',' -)

CAPTURED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMIT=$(git rev-parse HEAD)
COMMIT_SHORT=$(git rev-parse --short HEAD)

# Preserve any existing `perf` key from prior runs (e.g. Playwright spec
# wrote it to .latest.json). If the file doesn't exist yet, fall back to
# null. This keeps capture concerns independent.
PERF_PAYLOAD="null"
if [ -f bench/baseline/frontend.latest.json ]; then
  if EXISTING_PERF=$(node -e '
    const fs = require("fs");
    try {
      const obj = JSON.parse(fs.readFileSync("bench/baseline/frontend.latest.json", "utf8"));
      if (obj && obj.perf != null) {
        process.stdout.write(JSON.stringify(obj.perf));
      } else {
        process.stdout.write("null");
      }
    } catch { process.stdout.write("null"); }
  ' 2>/dev/null); then
    PERF_PAYLOAD="$EXISTING_PERF"
  fi
fi

cat > bench/baseline/frontend.latest.json <<JSON
{
  "captured_at": "$CAPTURED_AT",
  "branch": "$BRANCH",
  "commit": "$COMMIT",
  "commit_short": "$COMMIT_SHORT",
  "bundle": {
    "primary_file": "$PRIMARY",
    "raw_bytes": $RAW_BYTES,
    "gzipped_bytes": $GZ_BYTES,
    "dist_assets": "$DIST_LIST"
  },
  "perf": $PERF_PAYLOAD
}
JSON

echo "Latest capture written to bench/baseline/frontend.latest.json"
echo "Run \`npm run baseline:update\` to promote into the committed baseline."
