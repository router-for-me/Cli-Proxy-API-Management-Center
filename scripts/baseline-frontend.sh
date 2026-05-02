#!/usr/bin/env bash
# Capture frontend baseline metrics for refactor regression checks.
#
# Output: bench/baseline/frontend.json
#
# Currently captures bundle size only. Playwright-based TTI / FPS / heap-delta
# capture lives in scripts/baseline-frontend-perf.sh (separate concern, browser
# install required).

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

cat > bench/baseline/frontend.json <<JSON
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
  "perf": null
}
JSON

echo "Baseline written:"
cat bench/baseline/frontend.json
