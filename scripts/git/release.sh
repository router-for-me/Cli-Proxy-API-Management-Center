#!/usr/bin/env bash
# 打 tag 并可选 push / Tag and optional push
# Usage: bun run release [version] [--yes]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

ARG_YES=false ; VER=""
for arg in "$@"; do
  case "$arg" in
    --yes) ARG_YES=true ;;
    v*)    VER="$arg" ;;
  esac
done

require_on_branch "$BRANCH_MAIN"
require_clean_worktree

if [[ -z "$VER" ]]; then
  # 自动递增 patch 版本
  LATEST="$(git tag --list 'v*' --sort=-v:refname 2>/dev/null | head -n1)"
  if [[ -z "$LATEST" ]]; then
    VER="v1.0.0"
  else
    MAJOR="${LATEST%%.*}"; REST="${LATEST#*.}"
    MINOR="${REST%%.*}"; PATCH="${REST#*.}"
    PATCH="$((PATCH + 1))"
    VER="${MAJOR}.${MINOR}.${PATCH}"
  fi
fi
[[ "$VER" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]] || die "版本号非法: $VER（期望 v1.2.3）"

log_step "即将打 tag: $VER"

PENDING="$(git log --oneline "origin/$BRANCH_MAIN..$BRANCH_MAIN" 2>/dev/null || true)"
if [[ -n "$PENDING" ]]; then
  log_warn "origin/main 落后于本地，未 push 的提交："
  echo "$PENDING"
  if [[ "$ARG_YES" != true ]]; then
    confirm "继续打 tag？（建议先 push 再打 tag）" n || die "已取消"
  fi
fi

git tag -a "$VER" -m "release: $VER"
log_ok "已创建本地 tag $VER"

if [[ "$ARG_YES" == true ]]; then
  git push "$REMOTE_ORIGIN" "$BRANCH_MAIN" --follow-tags
  log_ok "已 push；前往 GitHub Actions 查看 release 构建"
elif confirm "是否 push $VER 到 origin（会触发 CI Release）？" n; then
  confirm_strong "推送 tag 触发发布" || die "已取消"
  git push "$REMOTE_ORIGIN" "$BRANCH_MAIN" --follow-tags
  log_ok "已 push；前往 GitHub Actions 查看 release 构建"
else
  log_warn "未 push；稍后 git push $REMOTE_ORIGIN $BRANCH_MAIN --follow-tags"
fi
