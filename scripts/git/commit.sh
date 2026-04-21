#!/usr/bin/env bash
# 交互式双语 Conventional Commits / Interactive bilingual Conventional Commits
# 非交互模式: bun run commit -- --type=feat --scope=usage --zh="中文" --en="english" [--yes]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../lib/common.sh"

# 解析参数 / Parse args
ARG_TYPE="" ; ARG_SCOPE="" ; ARG_ZH="" ; ARG_EN="" ; ARG_YES=false
for arg in "$@"; do
  case "$arg" in
    --type=*)  ARG_TYPE="${arg#--type=}" ;;
    --scope=*) ARG_SCOPE="${arg#--scope=}" ;;
    --zh=*)    ARG_ZH="${arg#--zh=}" ;;
    --en=*)    ARG_EN="${arg#--en=}" ;;
    --yes)     ARG_YES=true ;;
  esac
done

forbid_branch "$BRANCH_MAIN"

if [[ -z "$(git status --porcelain)" ]]; then
  die "无任何改动 / nothing to commit"
fi

log_step "已变更文件 / Changed files"
git -c color.status=always status --short

if [[ "$ARG_YES" == true ]]; then
  git add -A
else
  if ! confirm "是否 git add -A 全部加入暂存？" y; then
    die "请先手动 git add 再重跑"
  fi
  git add -A
fi

# 确定 type
TYPES=(feat fix refactor perf docs chore ci test build style revert merge)
if [[ -n "$ARG_TYPE" ]]; then
  TYPE="$ARG_TYPE"
else
  log_step "选择 type"
  select TYPE in "${TYPES[@]}"; do [[ -n "${TYPE:-}" ]] && break; done
fi

# 确定 scope
if [[ -n "$ARG_SCOPE" ]]; then
  SCOPE="$ARG_SCOPE"
elif [[ "$ARG_YES" == true ]]; then
  SCOPE=""
else
  read -r -p "scope (例: usage/oauth/config，可留空): " SCOPE
fi

# 确定中文简述
if [[ -n "$ARG_ZH" ]]; then
  ZH="$ARG_ZH"
else
  read -r -p "中文简述 (必填): " ZH
fi
[[ -z "$ZH" ]] && die "中文简述不能为空"

# 确定英文简述
NEEDS_EN=1
case "$TYPE" in
  docs|chore|style) NEEDS_EN=0 ;;
esac

if [[ -n "$ARG_EN" ]]; then
  EN="$ARG_EN"
elif [[ "$ARG_YES" == true && "$NEEDS_EN" -eq 1 ]]; then
  die "非交互模式下 $TYPE 类型必须提供 --en= 参数"
elif [[ "$NEEDS_EN" -eq 1 ]]; then
  read -r -p "english brief (必填): " EN
  [[ -z "$EN" ]] && die "$TYPE 类型必须包含英文简述"
else
  if [[ "$ARG_YES" != true ]]; then
    read -r -p "english brief (可选): " EN
  else
    EN=""
  fi
fi

HEAD="$TYPE"
[[ -n "$SCOPE" ]] && HEAD="$TYPE($SCOPE)"
MSG="$HEAD: $ZH"
[[ -n "$EN" ]] && MSG="$MSG [en: $EN]"

log_step "提交预览"
echo "  $MSG"
if [[ "$ARG_YES" != true ]]; then
  confirm "确认提交？" y || die "已取消"
fi

git commit -m "$MSG"
log_ok "提交完成 / commit done"

echo "
接下来：
  继续修改 → bun run commit
  完成所有改动 → bun run promote
"
