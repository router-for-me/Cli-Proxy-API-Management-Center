#!/usr/bin/env bash
# 记忆友好的研发流程入口 / Friendly workflow wrapper
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

usage() {
  cat <<'EOF'
用法 / usage:
  bun run flow                 # 打开交互菜单
  bun run start -- <topic>     # 开工：doctor → sync upstream → feature/<topic>
  bun run check                # 检查：type-check → lint(警告) → build
  bun run save -- <commit args># 提交：转发给 commit.sh，并自动 --yes
  bun run ship                 # 合主线：promote → push main → checkout dev

示例:
  bun run start -- fix-login
  bun run save -- --type=fix --scope=login --zh="修复登录错误" --en="fix login error"
  bun run ship
EOF
}

run_start() {
  local topic="${1:-}"
  [[ -n "$topic" ]] || die "缺少 topic。示例：bun run start -- fix-login"

  log_step "开工：诊断 → 同步 → 切分支"
  "$SCRIPT_DIR/doctor.sh"
  "$SCRIPT_DIR/sync.sh" --source=upstream --yes
  "$SCRIPT_DIR/feature.sh" "$topic"
}

run_check() {
  run_preflight
}

run_save() {
  local args=("$@")
  local has_yes=false
  for arg in "${args[@]}"; do
    [[ "$arg" == "--yes" ]] && has_yes=true
  done
  [[ "$has_yes" == true ]] || args+=("--yes")
  "$SCRIPT_DIR/commit.sh" "${args[@]}"
}

run_ship() {
  log_step "合回主线：promote → push main → checkout dev"
  "$SCRIPT_DIR/promote.sh" --yes
  ALLOW_MAIN_PUSH=YES git push "$REMOTE_ORIGIN" "$BRANCH_MAIN"
  git checkout "$BRANCH_DEV"
  log_ok "已合回主线并回到 dev"
}

run_menu() {
  cat <<'EOF'

你想做什么？
  1) 开工：doctor → sync → feature
  2) 检查：type-check → lint → build
  3) 提交：双语 commit
  4) 合主线：promote → push main → 回 dev
  5) 退出
EOF
  local choice
  read -r -p "选择 [1/2/3/4/5]: " choice
  case "${choice:-}" in
    1)
      local topic
      read -r -p "输入 topic（如 fix-login）: " topic
      run_start "$topic"
      ;;
    2)
      run_check
      ;;
    3)
      echo "建议用法：bun run save -- --type=feat --scope=xxx --zh=\"中文\" --en=\"english\""
      "$SCRIPT_DIR/commit.sh"
      ;;
    4)
      run_ship
      ;;
    5|"")
      log_info "已退出"
      ;;
    *)
      die "无效选择: $choice"
      ;;
  esac
}

cmd="${1:-menu}"
[[ $# -gt 0 ]] && shift || true

case "$cmd" in
  start) run_start "$@" ;;
  check) run_check ;;
  save)  run_save "$@" ;;
  ship)  run_ship ;;
  menu|flow) run_menu ;;
  -h|--help|help) usage ;;
  *) usage; die "未知命令: $cmd" ;;
esac
