#!/usr/bin/env bash
# 公共函数库 / Shared helpers for scripts/
# 所有脚本用 `source "$(dirname "$0")/../lib/common.sh"` 加载。

set -o pipefail

# -------------------------------------------------------------
# 颜色与日志 / Colors & Logging
# -------------------------------------------------------------
if [[ -t 1 ]]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'
  C_BLU=$'\033[34m'; C_CYA=$'\033[36m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_YLW=''; C_BLU=''; C_CYA=''; C_BLD=''; C_RST=''
fi

log_info()  { printf "%b[info]%b %s\n" "$C_BLU"  "$C_RST" "$*" >&2; }
log_ok()    { printf "%b[ ok ]%b %s\n" "$C_GRN"  "$C_RST" "$*" >&2; }
log_warn()  { printf "%b[warn]%b %s\n" "$C_YLW"  "$C_RST" "$*" >&2; }
log_err()   { printf "%b[err ]%b %s\n" "$C_RED"  "$C_RST" "$*" >&2; }
log_step()  { printf "\n%b==>%b %b%s%b\n" "$C_CYA" "$C_RST" "$C_BLD" "$*" "$C_RST" >&2; }

die() { log_err "$*"; exit 1; }

# -------------------------------------------------------------
# 仓库路径检测 / Repo root detection
# -------------------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || die "当前目录不是 git 仓库 / not a git repo"
AI_LOCAL_DIR="$REPO_ROOT/.ai-local"
LOG_DIR="$AI_LOCAL_DIR/logs"
mkdir -p "$LOG_DIR"

# -------------------------------------------------------------
# 远端与分支常量 / Remotes & Branches
# -------------------------------------------------------------
REMOTE_ORIGIN="origin"
BRANCH_MAIN="main"
BRANCH_DEV="dev"
ORIGIN_URL="https://github.com/calonye/Cli-Proxy-API-Management-Center-fork.git"

# -------------------------------------------------------------
# 工作区检查 / Working tree checks
# -------------------------------------------------------------
require_clean_worktree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    log_err "工作区不干净，请先 commit / stash：/ Working tree dirty, commit or stash first:"
    git -c color.status=always status --short >&2
    exit 1
  fi
}

current_branch() {
  git rev-parse --abbrev-ref HEAD
}

require_on_branch() {
  local want="$1"
  local cur; cur=$(current_branch)
  if [[ "$cur" != "$want" ]]; then
    die "需在分支 $want 上操作，当前在 $cur / must be on $want, currently on $cur"
  fi
}

forbid_branch() {
  local forbidden="$1"
  local cur; cur=$(current_branch)
  if [[ "$cur" == "$forbidden" ]]; then
    die "禁止在 $forbidden 分支执行此操作 / action not allowed on $forbidden"
  fi
}

# -------------------------------------------------------------
# 用户交互 / Prompt helpers
# -------------------------------------------------------------
confirm() {
  # confirm "提示文本" [default=n]
  local prompt="$1"; local def="${2:-n}"
  local hint="[y/N]"; [[ "$def" == "y" ]] && hint="[Y/n]"
  local ans
  read -r -p "$(printf "%b?%b %s %s " "$C_YLW" "$C_RST" "$prompt" "$hint")" ans
  ans="${ans:-$def}"
  [[ "$ans" =~ ^[Yy]$ ]]
}

confirm_strong() {
  # confirm_strong "高危提示" — 必须输入 YES（大写）才通过
  local prompt="$1"
  local ans
  read -r -p "$(printf "%b!!%b %s （请输入大写 YES 以确认 / type YES to confirm）: " "$C_RED" "$C_RST" "$prompt")" ans
  [[ "$ans" == "YES" ]]
}

# -------------------------------------------------------------
# 预检 / Pre-flight verification
# -------------------------------------------------------------
run_preflight() {
  log_step "预检 type-check / lint / build"
  if command -v bun >/dev/null 2>&1; then
    bun run type-check || die "type-check 失败"
    bun run lint       || log_warn "lint 存在既有问题（见 §2 技术债），继续执行"
    bun run build      || die "build 失败"
  else
    die "bun 未安装；请先 brew install oven-sh/bun/bun 或参考 https://bun.sh"
  fi
  log_ok "预检通过"
}
