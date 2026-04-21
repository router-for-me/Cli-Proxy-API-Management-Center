#!/usr/bin/env bash
# dev → main 预检合并 + PR 判断 / Promote dev to main with preflight
# 非交互模式: bun run promote -- --yes (跳过所有确认，AI 调用时使用)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

ARG_YES=false
for arg in "$@"; do
  case "$arg" in
    --yes) ARG_YES=true ;;
  esac
done

CUR="$(current_branch)"
if [[ "$CUR" == feature/* || "$CUR" == fix/* || "$CUR" == refactor/* || "$CUR" == perf/* ]]; then
  log_step "先合回 dev"
  require_clean_worktree
  git checkout "$BRANCH_DEV"
  git merge --no-ff "$CUR" -m "merge($CUR): 合入 dev [en: merge $CUR into dev]"
  if [[ "$ARG_YES" == true ]] || confirm "是否删除已合并的分支 $CUR？" y; then
    git branch -d "$CUR"
  fi
  CUR="$BRANCH_DEV"
fi

require_on_branch "$BRANCH_DEV"
require_clean_worktree

run_preflight

log_step "Dev→Main 改动清单"
git fetch "$REMOTE_ORIGIN" --prune --quiet || true
git --no-pager log --oneline --decorate \
  "origin/$BRANCH_MAIN..$BRANCH_DEV" 2>/dev/null \
  || git --no-pager log --oneline --decorate "$BRANCH_MAIN..$BRANCH_DEV"

cat >&2 <<'EOF'

------------------------------------------------------------
[AI PR 判断提示 / AI PR Decision Prompt]
请你（或负责本次合并的 AI）对上述改动输出：
1. 逐条判断是通用修复（建议向 upstream 提 PR）/ fork 私有（不提 PR）。
2. 给出理由与目标 repo（kongkongyo or router-for-me）。
3. 等用户 Y/N 确认后再 push / gh pr create。
不得擅自 push 或 gh pr create。
------------------------------------------------------------
EOF

if [[ "$ARG_YES" != true ]]; then
  confirm "已完成 PR 判断并获得用户确认？" n || { log_warn "请先让 AI 输出判断再重跑本脚本"; exit 1; }
fi

log_step "合并 dev → main"
git checkout "$BRANCH_MAIN"
git pull --ff-only "$REMOTE_ORIGIN" "$BRANCH_MAIN" || log_warn "main 尚未 push 到 origin"
git merge --no-ff "$BRANCH_DEV" -m "merge(dev): 合并 dev 到 main [en: merge dev into main]"
log_ok "合并完成"

if [[ "$ARG_YES" == true ]]; then
  log_warn "--yes 模式不自动 push；请手动执行 git push $REMOTE_ORIGIN $BRANCH_MAIN"
elif confirm "是否立即 push origin main？" n; then
  confirm_strong "push 到 origin/main 是敏感操作" || die "已取消 push"
  git push "$REMOTE_ORIGIN" "$BRANCH_MAIN"
  log_ok "已 push"
else
  log_warn "未 push；稍后手动执行 git push $REMOTE_ORIGIN $BRANCH_MAIN"
fi

echo "
接下来可选：
  bun run release            # 打 fork tag 并推送触发 CI release
"
