#!/usr/bin/env bash
# 首次/幂等初始化 / First-time & idempotent setup
# Usage: bun run setup [--mode=ref|inject|stealth] [--yes]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

MODE="ref"
ARG_YES=false
for arg in "$@"; do
  case "$arg" in
    --mode=*) MODE="${arg#--mode=}" ;;
    --yes) ARG_YES=true ;;
    -h|--help)
      cat <<EOF
bun run setup [--mode=ref|inject|stealth] [--yes]

  ref     (默认) 生成 AI 入口文件，内容为 @import 引用 AGENTS.md
  inject  将 AGENTS.md 全文注入到各 AI 入口（冗余但无 import 依赖）
  stealth 不生成 AI 入口文件，仅初始化 Project/
  --yes   非交互模式；当前脚本幂等执行，仅用于 AI 调用语义统一
EOF
      exit 0
      ;;
    *)
      die "未知参数: $arg；可选: --mode=ref|inject|stealth --yes"
      ;;
  esac
done

# Colors
if [[ -t 1 ]]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'
  C_BLU=$'\033[34m'; C_CYA=$'\033[36m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_YLW=''; C_BLU=''; C_CYA=''; C_BLD=''; C_RST=''
fi
log_ok()   { printf "%b[ ok ]%b %s\n" "$C_GRN" "$C_RST" "$*" >&2; }
log_warn() { printf "%b[warn]%b %s\n" "$C_YLW" "$C_RST" "$*" >&2; }
log_step() { printf "\n%b==>%b %b%s%b\n" "$C_CYA" "$C_RST" "$C_BLD" "$*" "$C_RST" >&2; }
die()      { printf "%b[err ]%b %s\n" "$C_RED" "$C_RST" "$*" >&2; exit 1; }

cd "$REPO_ROOT"

log_step "检查工具链"
command -v bun  >/dev/null || die "请先安装 bun：https://bun.sh"
command -v git  >/dev/null || die "请先安装 git"
log_ok "bun $(bun --version)$(command -v node >/dev/null && echo "  node $(node --version)" || true)"

log_step "建立 remote"
ensure_remote() {
  local name="$1"; local url="$2"
  if git remote get-url "$name" >/dev/null 2>&1; then
    log_ok "remote $name 已存在"
  else
    git remote add "$name" "$url"
    log_ok "已添加 remote $name → $url"
  fi
}
ensure_remote "origin" "https://github.com/calonye/Cli-Proxy-API-Management-Center-fork.git"

log_step "建立 dev 分支（若不存在）"
if git show-ref --verify --quiet "refs/heads/dev"; then
  log_ok "dev 已存在"
else
  git branch dev >/dev/null
  log_ok "已创建 dev 分支"
fi

log_step "安装 Git 钩子（软链）"
HOOKS_SRC="$REPO_ROOT/scripts/git-hooks"
HOOKS_DST="$REPO_ROOT/.git/hooks"
mkdir -p "$HOOKS_DST"
for h in pre-commit commit-msg pre-push; do
  if [[ -f "$HOOKS_SRC/$h" ]]; then
    ln -sf "$HOOKS_SRC/$h" "$HOOKS_DST/$h"
    chmod +x "$HOOKS_SRC/$h"
    log_ok "已链接 $h"
  else
    log_warn "未找到 $HOOKS_SRC/$h"
  fi
done

log_step "初始化 Project/ 个人层"
AI_LOCAL="$REPO_ROOT/Project"
mkdir -p "$AI_LOCAL/memory" "$AI_LOCAL/logs" "$AI_LOCAL/templates"
if [[ -f "$AI_LOCAL/private-rules.md" ]]; then
  log_ok "Project/private-rules.md 已存在（保留现有内容）"
else
  cat > "$AI_LOCAL/private-rules.md" <<'PRIV'
# 个人化规则叠加层 / Private Rules Overlay
#
# 本文件不入库。叠加在入库的 AGENTS.md 之上，添加个人偏好。
# bun run setup 会将 AGENTS.md + 本文件合并生成 CLAUDE.md 等。
#
# 引用项目级规范：
@../AGENTS.md

---

## §0 人格与会话元规则（请自行填写）

## §7 项目记忆（Project/memory/*.md）

## §8 外部规范引用（本机绝对路径）
PRIV
  log_ok "已生成 Project/private-rules.md 模板"
fi

log_step "生成 AI 入口文件（mode=${MODE}）"
generate_ref() {
  local path="$1"; local title="$2"
  mkdir -p "$(dirname "$path")"
  cat > "$path" <<EOF
# ${title}
# 本文件由 bun run setup 自动生成，不入库。修改请编辑 AGENTS.md（入库）。

@./AGENTS.md
EOF
  log_ok "生成 $path (ref mode)"
}

generate_inject() {
  local path="$1"; local title="$2"
  mkdir -p "$(dirname "$path")"
  {
    echo "# ${title}"
    echo "# 本文件由 bun run setup --mode=inject 生成（全量模式），不入库。"
    echo ""
    echo "# === 项目级规范（来自 AGENTS.md）==="
    echo ""
    cat "$REPO_ROOT/AGENTS.md"
  } > "$path"
  log_ok "注入 $path (inject mode)"
}

case "$MODE" in
  ref)
    generate_ref "$REPO_ROOT/CLAUDE.md"                 "Claude Code Project Rules"
    generate_ref "$REPO_ROOT/.factory/rules.md"         "Factory Droid Project Rules"
    generate_ref "$REPO_ROOT/.cursor/rules/project.mdc" "Cursor Project Rules"
    ;;
  inject)
    generate_inject "$REPO_ROOT/CLAUDE.md"                 "Claude Code Project Rules"
    generate_inject "$REPO_ROOT/.factory/rules.md"         "Factory Droid Project Rules"
    generate_inject "$REPO_ROOT/.cursor/rules/project.mdc" "Cursor Project Rules"
    ;;
  stealth)
    log_warn "stealth 模式：不生成 AI 入口文件"
    ;;
  *)
    die "未知 mode=${MODE}；可选值：ref / inject / stealth"
    ;;
esac

log_step "检查 .gitignore 覆盖范围"
for p in Project/ CLAUDE.md .factory/ .cursor/; do
  if git check-ignore -q "$p" 2>/dev/null; then
    log_ok "$p 已忽略"
  else
    log_warn "$p 未在 .gitignore — 请确认是否预期"
  fi
done
# AGENTS.md 应该 NOT 被忽略（入库）
if git check-ignore -q "AGENTS.md" 2>/dev/null; then
  log_warn "AGENTS.md 被 .gitignore 忽略了 — 它应该入库！请从 .gitignore 移除"
fi

log_step "SETUP 完成"
cat <<'HELP'

可用命令：
  bun run doctor       # 诊断环境
  bun run feature <t>  # 新功能分支
  bun run commit       # 交互式双语提交
  bun run promote      # dev → main 预检合并
  bun run release [v]  # 打 tag 发布

HELP
