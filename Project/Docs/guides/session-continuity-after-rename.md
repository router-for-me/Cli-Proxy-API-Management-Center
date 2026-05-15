---
date: 2026-05-10
description: CPA-Dashboard-kelen 目录重命名后的会话连续性操作指南
---

# Session Continuity After Rename

## Pre-rename Checklist

```bash
cd /Users/kelen/Software/github-star/Cli-Proxy-API-Management-Center-fork
git status                              # 必须干净
bun run check                           # type-check + lint + build 通过
git log --oneline origin/dev..HEAD      # 确认 11 commits 已推送
```

## Rename

```bash
cd /Users/kelen/Software/github-star && mv Cli-Proxy-API-Management-Center-fork CPA-Dashboard-kelen
```

## Post-rename Verify

```bash
cd /Users/kelen/Software/github-star/CPA-Dashboard-kelen
bun run check
git remote -v
```

## Resume Session

在新路径打开 Claude Code 后，粘贴：

> 读取 Project/Docs/guides/session-continuity-after-rename.md 了解上下文。继续 dev 分支 Phase 4 推进，上次完成 E5/E6/E7（错误空状态区分、suspiciousToken过滤、静默刷新指示器），提交 5b96d8b。待做：CLIProxyAPI OAuth PR 提交（见 Project/Docs/PR-cliproxyapi-oauth-fix.md）、Phase 4 继续（UI 一致化、模型预置定价表）、目录已重命名为 CPA-Dashboard-kelen。

## Cleanup (可选)

```bash
rm -rf ~/.claude/projects/-Users-kelen-Software-github-star-Cli-Proxy-API-Management-Center-fork
```

## 注意事项

- GitHub remote 不变：`calonye/Cli-Proxy-API-Management-Center-fork`（远程仓库名不受本地改名影响）
- `package.json` name 仍为 `cli-proxy-webui-react`
- CLIProxyAPI 的 `panel-github-repository` 指向 `calonye/Cli-Proxy-API-Management-Center-fork`，重命名不影响此配置
