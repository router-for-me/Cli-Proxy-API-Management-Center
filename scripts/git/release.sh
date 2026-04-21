#!/usr/bin/env bash
# 打 fork tag 并可选 push / Tag and optional push
# Usage: bun run release [upstream_version] [--yes]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

ARG_YES=false ; UPV=""
for arg in "$@"; do
  case "$arg" in
    --yes) ARG_YES=true ;;
    v*)    UPV="$arg" ;;
  esac
done

require_on_branch "$BRANCH_MAIN"
require_clean_worktree
ensure_remotes

if [[ -z "$UPV" ]]; then
  git fetch "$REMOTE_UPSTREAM" --tags --quiet
  UPV="$(git tag --list 'v*' --sort=-v:refname --merged "$REMOTE_UPSTREAM/$BRANCH_MAIN" 2>/dev/null | head -n1)"
  UPV="${UPV%-*}"
  [[ -n "$UPV" ]] || die "无法自动检测 upstream 最新 tag，请手动传参：bun run release v1.7.37"
fi
[[ "$UPV" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]] || die "版本号非法: $UPV（期望 v1.7.37）"

N=1
while git rev-parse "refs/tags/${UPV}-fork.${N}" >/dev/null 2>&1; do
  ((N++))
done
TAG="${UPV}-fork.${N}"

log_step "即将打 tag: $TAG（基于 upstream $UPV，第 $N 次 fork 发布）"

PENDING="$(git log --oneline "origin/$BRANCH_MAIN..$BRANCH_MAIN" 2>/dev/null || true)"
if [[ -n "$PENDING" ]]; then
  log_warn "origin/main 落后于本地，未 push 的提交："
  echo "$PENDING"
  if [[ "$ARG_YES" != true ]]; then
    confirm "继续打 tag？（建议先 push 再打 tag）" n || die "已取消"
  fi
fi

git tag -a "$TAG" -m "release: $TAG"
log_ok "已创建本地 tag $TAG"

if [[ "$ARG_YES" == true ]]; then
  git push "$REMOTE_ORIGIN" "$BRANCH_MAIN" --follow-tags
  log_ok "已 push；前往 GitHub Actions 查看 release 构建"
elif confirm "是否 push $TAG 到 origin（会触发 CI Release）？" n; then
  confirm_strong "推送 tag 触发发布" || die "已取消"
  git push "$REMOTE_ORIGIN" "$BRANCH_MAIN" --follow-tags
  log_ok "已 push；前往 GitHub Actions 查看 release 构建"
else
  log_warn "未 push；稍后 git push $REMOTE_ORIGIN $BRANCH_MAIN --follow-tags"
fi
