#!/bin/sh
# Called by the user oneshot unit. Secrets travel only over curl's header stdin.
set -eu
case "${1:-}" in
  prune|reconcile|backup) kind=$1 ;;
  *) echo 'Unsupported usage job' >&2; exit 2 ;;
esac
key=$(cat "$HOME/.config/proxd/management-key")
test -n "$key"
body=$(printf '{"kind":"%s"}' "$kind")
printf 'Authorization: Bearer %s\n' "$key" |
  curl --fail --silent --show-error --max-time 15 --output /dev/null \
    --header @- --header 'Content-Type: application/json' --data "$body" \
    http://127.0.0.1:18320/v1/jobs
