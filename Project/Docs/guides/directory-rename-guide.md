---
description: 目录从 Cli-Proxy-API-Management-Center-fork 重命名为 CPA-Dashboard-kelen 的操作指南
version: 1.0.0
lastUpdated: 2026-05-16
---

# 目录重命名操作指南

## 目标

将本地目录 `Cli-Proxy-API-Management-Center-fork` → `CPA-Dashboard-kelen`。

## 前置条件

- [x] 阶段一：fork 关系剥离完成（14 文件已修改，未提交）
- [x] 阶段二：项目记忆已建立（`.ai-local/memory/`）
- [ ] 当前所有改动已 commit（见下方步骤）

## 操作步骤

### Step 1: 提交阶段一的所有改动（当前会话完成）

```bash
cd /Users/kelen/Software/github-star/Cli-Proxy-API-Management-Center-fork
git add -A
git commit -m "refactor(identity): 剥离上游关系，独立为 CPA-Dashboard-kelen [en: detach from upstream, become independent CPA-Dashboard-kelen]"
```

### Step 2: 关闭当前 Claude Code 会话

重命名目录后 Claude Code 的项目路径会变化，需重启会话。

### Step 3: 执行重命名（在终端中操作）

```bash
cd /Users/kelen/Software/github-star/
mv Cli-Proxy-API-Management-Center-fork CPA-Dashboard-kelen
cd CPA-Dashboard-kelen
```

### Step 4: 验证

```bash
bun run doctor    # 应通过所有检查
bun run check     # type-check + lint + build 应全部通过
```

## 系统级影响

Claude Code 项目元数据目录需要同步关注：
- 旧路径: `.claude/projects/-Users-kelen-Software-github-star-Cli-Proxy-API-Management-Center-fork/`
- 新路径: `.claude/projects/-Users-kelen-Software-github-star-CPA-Dashboard-kelen/`

Claude Code 会在新会话中自动使用新路径。旧目录可保留（历史记录）或手动删除。

## 不在本次范围

- GitHub 仓库重命名（用户选择暂不处理）
- GitHub URL 中的 `Cli-Proxy-API-Management-Center-fork` 保持不变，待后续统一处理
