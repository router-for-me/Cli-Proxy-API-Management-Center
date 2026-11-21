#!/usr/bin/env bash
# Remove orphaned ProxD lock files. ProxD deletes an auth `X.json` but never `X.json.lock`.
# Removes only top-level regular `*.json.lock` files that have no `X.json` and are older than
# PROX_JANITOR_MIN_AGE_MINUTES (default 10): a fresh orphan can belong to a write in progress.
# Never touches `.json` files or anything else. Prints the basename of each removed lock.
set -euo pipefail
min_age=${PROX_JANITOR_MIN_AGE_MINUTES:-10}
if [[ ! "$min_age" =~ ^[0-9]+$ ]]; then
  echo "PROX_JANITOR_MIN_AGE_MINUTES must be a whole number: $min_age" >&2
  exit 2
fi
if (($# == 0)); then
  set -- "$HOME/.local/share/proxd/codex/auth" "$HOME/.local/share/proxd/claude/auth" \
    "$HOME/.local/share/proxd/gemini/auth"
fi
for dir in "$@"; do
  [[ -d "$dir" ]] || continue
  # Run inside the directory so names starting with a dash are never parsed as options.
  # -type f does not match symlinks, and find does not follow them by default.
  (
    cd -- "$dir" || exit 1
    find . -maxdepth 1 -type f -name '*.json.lock' -mmin "+$min_age" -print0 |
      while IFS= read -r -d '' path; do
        lock=${path#./}
        # Keep the lock if its .json exists in any form, including a symlink.
        if [[ -e "${lock%.lock}" || -L "${lock%.lock}" ]]; then continue; fi
        rm -f -- "./$lock"
        printf '%s\n' "$lock"
      done
  ) || echo "prox-auth-janitor: could not fully scan $dir" >&2
  # A file vanishing mid-scan or an unreadable directory must not skip the next directory.
done
