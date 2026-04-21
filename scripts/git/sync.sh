#!/usr/bin/env bash
# 同步上游/源头 / Sync upstream & source
# 非交互模式: bun run sync -- --source=upstream|source|fetch-only [--yes]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

ARG_SOURCE="" ; ARG_YES=false
for arg in "$@"; do
  case "$arg" in
    --source=*) ARG_SOURCE="${arg#--source=}" ;;
    --yes)      ARG_YES=true ;;
  esac
done

require_clean_worktree
ensure_remotes

log_step "Fetch 所有 remote"
git fetch "$REMOTE_ORIGIN"   --tags --prune
git fetch "$REMOTE_UPSTREAM" --tags --prune
git fetch "$REMOTE_SOURCE"   --tags --prune

# 选择同步源
if [[ -n "$ARG_SOURCE" ]]; then
  choice="$ARG_SOURCE"
else
  log_step "选择同步源"
  echo "  1) upstream/main  （默认，kongkongyo/...）"
  echo "  2) source/main    （router-for-me/...）"
  echo "  3) 仅 fetch，不合并"
  read -r -p "选择 [1/2/3]: " choice
  choice="${choice:-1}"
  case "$choice" in
    1) choice="upstream" ;; 2) choice="source" ;; 3) choice="fetch-only" ;;
  esac
fi

case "$choice" in
  upstream)   SRC_REF="$REMOTE_UPSTREAM/$BRANCH_MAIN" ;;
  source)     SRC_REF="$REMOTE_SOURCE/$BRANCH_MAIN" ;;
  fetch-only) log_ok "仅 fetch，不合并"; exit 0 ;;
  *) die "无效选择: $choice（可选: upstream / source / fetch-only）" ;;
esac

log_step "切到 main 并合并 $SRC_REF"
git checkout "$BRANCH_MAIN"
git pull --ff-only "$REMOTE_ORIGIN" "$BRANCH_MAIN" || log_warn "main 尚未 push 到 origin"

if git merge --no-edit --no-ff "$SRC_REF" \
     -m "merge($SRC_REF): 同步上游 [en: sync from $SRC_REF]"; then
  log_ok "合并成功"
else
  log_warn "有冲突，请手动解决后运行 git merge --continue"
  exit 2
fi

# 合回 dev
if [[ "$ARG_YES" == true ]] || confirm "是否将 main 合回 dev 保持 dev 领先？" y; then
  git checkout "$BRANCH_DEV" 2>/dev/null || git checkout -b "$BRANCH_DEV"
  git merge --no-ff "$BRANCH_MAIN" -m "merge(main): 同步上游到 dev [en: sync main into dev]" || {
    log_warn "dev 合并冲突，请手动解决"; exit 2
  }
fi

log_step "Push 预览"
git --no-pager log --oneline --decorate "origin/$BRANCH_MAIN..$BRANCH_MAIN" || true
git --no-pager log --oneline --decorate "origin/$BRANCH_DEV..$BRANCH_DEV"   || true

if [[ "$ARG_YES" == true ]]; then
  git push "$REMOTE_ORIGIN" "$BRANCH_MAIN"
  git push "$REMOTE_ORIGIN" "$BRANCH_DEV" --tags
  log_ok "已 push"
elif confirm "是否 push main + dev 到 origin？" n; then
  git push "$REMOTE_ORIGIN" "$BRANCH_MAIN"
  git push "$REMOTE_ORIGIN" "$BRANCH_DEV" --tags
  log_ok "已 push"
else
  log_warn "未 push；稍后手动执行 git push $REMOTE_ORIGIN main && git push $REMOTE_ORIGIN dev"
fi
