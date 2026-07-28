#!/usr/bin/env bash
#
# Screenshot the quota board against the mock API.
#
# Drives the login form over the DevTools Protocol rather than pre-seeding
# localStorage: the auth store persists through an obfuscated storage wrapper,
# so a hand-written blob would have to replicate that encoding exactly and
# fails silently when it doesn't. Typing into the form exercises the real path.
#
#   devtools/mock/shoot.sh [output.png] [route]
#
set -euo pipefail

OUT="${1:-${TMPDIR:-/tmp}/quota-board.png}"
ROUTE="${2:-#/quota}"
PORT="${CDP_PORT:-9222}"
URL="http://localhost:${MOCK_PORT:-8899}/${ROUTE}"

# Set CHROME to point at any Chromium-family binary; the fallbacks cover a
# default macOS install and the usual names on PATH.
CHROME="${CHROME:-}"
if [[ -z "$CHROME" ]]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    google-chrome chromium chromium-browser; do
    if [[ -x "$candidate" ]] || command -v "$candidate" >/dev/null 2>&1; then
      CHROME="$candidate"
      break
    fi
  done
fi
if [[ -z "$CHROME" ]]; then
  echo "No Chrome/Chromium found. Set CHROME=/path/to/chrome and retry." >&2
  exit 1
fi

PROFILE="$(mktemp -d)"

cleanup() {
  [[ -n "${CHROME_PID:-}" ]] && kill "$CHROME_PID" 2>/dev/null || true
  rm -rf "$PROFILE"
}
trap cleanup EXIT

"$CHROME" \
  --headless=new \
  --disable-gpu \
  --hide-scrollbars \
  --remote-debugging-port=$PORT \
  --user-data-dir="$PROFILE" \
  --window-size=1900,1500 \
  "$URL" >/dev/null 2>&1 &
CHROME_PID=$!

# Wait for the debugging endpoint rather than sleeping a fixed interval.
for _ in $(seq 1 50); do
  curl -sf "http://localhost:$PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.2
done

bun "$(dirname "$0")/drive.ts" "$OUT" "$URL"
