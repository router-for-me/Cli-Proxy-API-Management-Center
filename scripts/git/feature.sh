#!/usr/bin/env bash
# 从 dev 切出功能分支 / Create feature branch from dev
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

TYPE="feature"
if [[ "${1:-}" == --type=* ]]; then
  TYPE="${1#--type=}"; shift
fi
TOPIC="${1:-}"
[[ -z "$TOPIC" ]] && die "用法 / usage: bun run feature [--type=feature|fix|refactor|perf] <topic>"

[[ "$TOPIC" =~ ^[a-z0-9][a-z0-9\-]*$ ]] || die "topic 仅允许小写字母数字与连字符 / kebab-case only"

require_clean_worktree
ensure_remotes

log_step "确保 dev 最新"
git fetch "$REMOTE_ORIGIN" --prune
git checkout "$BRANCH_DEV" 2>/dev/null || git checkout -b "$BRANCH_DEV"
git pull --ff-only "$REMOTE_ORIGIN" "$BRANCH_DEV" || log_warn "dev 尚未 push 到 origin，跳过 pull"

# 检查上游是否有新更新（非阻塞提醒）
git fetch "$REMOTE_UPSTREAM" --quiet 2>/dev/null || true
LOCAL_MAIN=$(git rev-parse "$BRANCH_MAIN" 2>/dev/null || echo "")
UPSTREAM_MAIN=$(git rev-parse "$REMOTE_UPSTREAM/$BRANCH_MAIN" 2>/dev/null || echo "")
if [[ -n "$LOCAL_MAIN" && -n "$UPSTREAM_MAIN" && "$LOCAL_MAIN" != "$UPSTREAM_MAIN" ]]; then
  log_warn "上游有新更新未同步，建议先运行 bun run sync"
  confirm "跳过同步直接继续？" y || { log_info "请先执行 bun run sync"; exit 0; }
fi

BR="${TYPE}/${TOPIC}"
if git show-ref --verify --quiet "refs/heads/$BR"; then
  die "分支 $BR 已存在"
fi

git checkout -b "$BR"
log_ok "已切出 $BR（源自 dev）"

echo "
接下来：
  1) 修改代码
  2) bun run commit   # 交互式双语提交
  3) 反复 1+2 直到完成
  4) bun run promote  # 合回 dev 并预检（AI 会判断是否合入 main）
"
