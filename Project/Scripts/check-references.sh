#!/bin/bash
# 参考仓库版本追踪脚本
# 用法: bash Project/Scripts/check-references.sh
set -e

BASE="/Users/kelen/Software/github-star"
REPOS=("cockpit-tools" "Kiro-account-manager" "codex2api" "sub2api" "CLIProxyAPI")

echo "# 参考仓库状态检查 — $(date '+%Y-%m-%d %H:%M')"
echo ""

for repo in "${REPOS[@]}"; do
  path="$BASE/$repo"
  if [ ! -d "$path" ]; then
    echo "## $repo — 未克隆"
    continue
  fi
  cd "$path"
  branch=$(git rev-parse --abbrev-ref HEAD)
  # Fetch quietly
  git fetch origin 2>/dev/null || true
  ahead=$(git rev-list --count origin/$branch..HEAD 2>/dev/null || echo "?")
  behind=$(git rev-list --count HEAD..origin/$branch 2>/dev/null || echo "?")
  commit=$(git log --oneline -1)
  date=$(git log -1 --format=%ci)
  echo "## $repo ($branch) — ${behind} behind, ${ahead} ahead"
  echo "  HEAD: $commit"
  echo "  Date: $date"
  echo ""
done

echo "---"
echo "提示: 如有 behind > 0，运行 git pull 同步上游变更"
