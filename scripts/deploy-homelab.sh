#!/usr/bin/env bash
# Build and install Prox UI, quota history and usage collection. Never restart either inference proxy.
set -euo pipefail
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo"
# node, npm and bun live in ~/.local/bin, which only login shells add to PATH;
# `systemd-run --user` starts with a bare PATH and fails with `node: command not found`.
export PATH="$HOME/.local/bin:$PATH"
if [[ ! -r "$HOME/.config/cli-proxy-rerank/management-key" ]] || \
   [[ ! -s "$HOME/.config/cli-proxy-rerank/management-key" ]]; then
  echo 'Missing readable, non-empty proxy management key.' >&2
  exit 1
fi
package_manager=$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).packageManager")
npm exec --yes --package="$package_manager" -- bun install --frozen-lockfile
npm exec --yes --package="$package_manager" -- bun run verify
# Hash both entry points: a writer-only change also requires a collector restart.
usage_hash=$(sha256sum dist/usage/*.js | sha256sum | cut -d ' ' -f 1)
usage_hash_file="$HOME/.local/share/prox-usage/bundle.sha256"
previous_usage_hash=$(cat "$usage_hash_file" 2>/dev/null || true)
revision=$(git rev-parse HEAD)
podman build -f deploy/Dockerfile --label "org.opencontainers.image.revision=$revision" -t localhost/prox:dev .
podman run --rm --network host --entrypoint nginx localhost/prox:dev -t
podman build -f deploy/Dockerfile.history --label "org.opencontainers.image.revision=$revision" -t localhost/prox-history:dev .
install -d -m 700 "$HOME/.local/share/prox-history" "$HOME/.local/share/prox-usage" "$HOME/.config/prox-usage"
# The rate book is re-read on its modification time; no restart is needed for a price change.
install -m 644 deploy/usage-rates.json "$HOME/.local/share/prox-usage/usage-rates.json"
install -D -m 644 deploy/prox-usage.container "$HOME/.config/containers/systemd/prox-usage.container"
install -D -m 644 deploy/prox-history.container "$HOME/.config/containers/systemd/prox-history.container"
install -D -m 644 deploy/prox.container "$HOME/.config/containers/systemd/prox.container"
install -D -m 755 deploy/prox-auth-janitor.sh "$HOME/.local/share/prox/prox-auth-janitor.sh"
install -D -m 644 deploy/prox-auth-janitor.service "$HOME/.config/systemd/user/prox-auth-janitor.service"
install -D -m 644 deploy/prox-auth-janitor.timer "$HOME/.config/systemd/user/prox-auth-janitor.timer"
# Install the self-contained usage job bundles that `bun run verify` just built from this commit.
# Each file is written beside its target and renamed, so a deploy during a run never leaves a
# half-written script. The nightly job spawns parity, so parity is replaced first.
usage_jobs_dir="$HOME/.local/share/prox/usage-jobs"
install -d -m 755 "$usage_jobs_dir"
for bundle in usage-parity.js usage-restore-check.js usage-nightly.js; do
  bundle_tmp=$(mktemp "$usage_jobs_dir/.$bundle.XXXXXX")
  trap 'rm -f -- "$bundle_tmp"' EXIT
  install -m 644 "dist/usage-jobs/$bundle" "$bundle_tmp"
  mv -f -- "$bundle_tmp" "$usage_jobs_dir/$bundle"
  trap - EXIT
done
# Fail the deploy now, not at 04:20, if the installed nightly cannot start its sibling parity.
bun "$usage_jobs_dir/usage-nightly.js" --check-install
# Ship job schedules disabled. The operator enables them after the migration gates.
install -D -m 755 deploy/prox-usage-job.sh "$HOME/.local/share/prox/prox-usage-job.sh"
install -D -m 644 deploy/prox-usage-job@.service "$HOME/.config/systemd/user/prox-usage-job@.service"
install -D -m 644 deploy/prox-usage-nightly.service "$HOME/.config/systemd/user/prox-usage-nightly.service"
install -D -m 644 deploy/prox-usage-nightly.timer "$HOME/.config/systemd/user/prox-usage-nightly.timer"
install -D -m 644 deploy/prox-usage-parity.service "$HOME/.config/systemd/user/prox-usage-parity.service"
# Retire units no longer shipped (the independent usage timers, and the janitor's path watcher,
# which fired on every proxy cooldown-file write) before reloading the unit graph.
for unit in prox-usage-prune.timer prox-usage-reconcile.timer prox-usage-backup.timer \
  prox-usage-parity.timer prox-auth-janitor.path; do
  if ! retirement_error=$(LC_ALL=C systemctl --user disable --now "$unit" 2>&1); then
    case "$retirement_error" in
      *"not loaded"*|*"does not exist"*|*"not found"*) ;;
      *) printf '%s\n' "$retirement_error" >&2; exit 1 ;;
    esac
  fi
  rm -f -- "$HOME/.config/systemd/user/$unit" \
    "$HOME/.config/systemd/user/timers.target.wants/$unit" \
    "$HOME/.config/systemd/user/default.target.wants/$unit"
done
systemctl --user daemon-reload
systemctl --user enable --now prox-auth-janitor.timer
# UI/history deploys leave the live usage subscription alone when its code did not change.
if [[ "$usage_hash" != "$previous_usage_hash" ]]; then
  systemctl --user restart prox-usage.service
  curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 \
    --max-time 5 http://127.0.0.1:18320/healthz
  printf '%s\n' "$usage_hash" > "$usage_hash_file"
fi
systemctl --user restart prox-history.service
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 \
  --max-time 5 http://127.0.0.1:18319/healthz
systemctl --user restart prox.service
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 \
  --max-time 5 http://127.0.0.1:18318/healthz
echo 'Prox UI deployed. Cluster routing and Authentik registration are separate; see docs/PROX-SETUP.md.'
