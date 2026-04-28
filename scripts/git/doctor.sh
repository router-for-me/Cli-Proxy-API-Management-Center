#!/usr/bin/env bash
# 只读环境诊断 / Read-only environment diagnostic
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

ok=0; warn=0; err=0
check() {
  local cond="$1"; local desc="$2"; local hint="${3:-}"
  if eval "$cond" >/dev/null 2>&1; then
    log_ok "$desc"; ok=$((ok + 1))
  else
    log_err "$desc"
    [[ -n "$hint" ]] && printf "       hint: %s\n" "$hint" >&2
    err=$((err + 1))
  fi
}
checkw() {
  local cond="$1"; local desc="$2"; local hint="${3:-}"
  if eval "$cond" >/dev/null 2>&1; then
    log_ok "$desc"; ok=$((ok + 1))
  else
    log_warn "$desc"
    [[ -n "$hint" ]] && printf "       hint: %s\n" "$hint" >&2
    warn=$((warn + 1))
  fi
}

log_step "工具链"
check "command -v bun"              "bun 已安装"              "brew install oven-sh/bun/bun"
checkw "command -v node"            "node 已安装（可选）"     "可忽略，CI 使用"
checkw "command -v rg"              "ripgrep 已安装"          "brew install ripgrep"
checkw "command -v gh"              "gh 已安装（可选）"       "brew install gh"

log_step "Git 配置"
check "git rev-parse --git-dir"     "在 git 仓库内"
check "git remote get-url origin"   "remote origin 存在"       "bun run setup"
check "git remote get-url upstream" "remote upstream 存在"     "bun run setup"
check "git remote get-url source"   "remote source 存在"       "bun run setup"
check "git show-ref --verify --quiet refs/heads/dev" "本地 dev 分支存在" "bun run setup"

log_step "Git 钩子"
for h in pre-commit commit-msg pre-push; do
  check "[[ -e .git/hooks/$h ]]" "钩子 $h 已安装" "bun run setup"
done

log_step ".gitignore 私有目录"
for p in .ai-local/ CLAUDE.md .factory/ .cursor/ dist/ node_modules/; do
  check "git check-ignore -q '$p'" "$p 已忽略"
done
# AGENTS.md 应该入库（NOT ignored）
checkw "! git check-ignore -q AGENTS.md" "AGENTS.md 入库（未被忽略）" "从 .gitignore 移除 AGENTS.md"

log_step "入库文件"
for p in AGENTS.md scripts/setup.sh scripts/lib/common.sh scripts/git/sync.sh; do
  check "[[ -f '$REPO_ROOT/$p' ]]" "$p 存在"
done

log_step ".ai-local 个人层"
checkw "[[ -f '$AI_LOCAL_DIR/private-rules.md' ]]" ".ai-local/private-rules.md 存在" "bun run setup"

log_step "工作区状态"
if [[ -z "$(git status --porcelain)" ]]; then
  log_ok "工作区干净"; ok=$((ok + 1))
else
  log_warn "工作区有未提交改动 $(git status --porcelain | wc -l | tr -d ' ') 项"
  warn=$((warn + 1))
fi

printf "\n结果：%bOK=%d%b  %bWARN=%d%b  %bERR=%d%b\n" \
  "$C_GRN" "$ok" "$C_RST" "$C_YLW" "$warn" "$C_RST" "$C_RED" "$err" "$C_RST"

[[ "$err" -eq 0 ]] || exit 1
