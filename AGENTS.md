---
version: 1.0.0
lastUpdated: 2026-05-10
---

# 项目 AI 协作规范 / Project AI Collaboration Rules

> 本文件适用于**所有** AI 工具（Factory Droid / Claude Code / Cursor / GitHub Copilot 等）。
> 项目级客观规范。通用行为规则继承自全局 Claude Code 配置。
>
> **语言约定：简体中文为主，英文为辅。** / Chinese primary, English secondary.

---

## §0 快速开始 / Quick Start

```bash
# 首次克隆
git clone https://github.com/calonye/Cli-Proxy-API-Management-Center-fork.git
cd Cli-Proxy-API-Management-Center-fork
bun install
bun run setup              # 装 hooks、个人化配置（AI 可用 -- --yes）

# 日常研发循环（每次开工必走）
bun run feature <topic>    # ❶ 从 dev 切功能分支
# ... 编码 ...
bun run commit             # ❷ 交互式双语提交（可反复）
bun run promote            # ❸ 预检 → 合回 dev → 可选合入 main
bun run release            # ❹ 打 tag 触发 CI（仅在 main 上）

# 诊断与调试
bun run doctor             # 环境诊断
bun run dev                # Vite dev server (localhost:5173)
bun run build              # 单文件构建 dist/index.html
bun run type-check         # TypeScript 检查
bun run lint               # ESLint
```

### 记不住流程时 / Friendly Shortcuts

只记这 5 个入口即可：

```bash
bun run flow                         # 打开交互菜单
bun run start -- my-topic            # 开工：doctor → feature
bun run check                        # 检查：type-check → lint → build
bun run save -- --type=feat --scope=x --zh="中文" --en="english"
bun run ship                         # 合主线：promote → push main → 回 dev
```

---


## §2 技术栈与工具链 / Tech Stack & Tooling

### 本仓强制

- **优先使用 `bun` > `pnpm`，不使用 `npm`**。本仓用 `bun.lock` 取代 `package-lock.json`。
- 若发现任何 `npm` 命令（代码/脚本/CI），反馈替换可行性建议与 Plan，经确认后迁移。

### 本仓技术栈

- React 19 + TypeScript 5.9 + Vite 7 + SCSS Modules + zustand + i18next。
- 不引入 `package.json` 未声明的新库；如需新依赖，先与用户确认。
- 新增 UI 文案**必须**同时在 `src/i18n/zh` 与 `src/i18n/en` 补键。

---


## §4 仓库身份与分支规则 / Identity & Branches

### 仓库身份

本仓库是独立演进的 Web 管理面板，最初 fork 自 [kongkongyo/Cli-Proxy-API-Management-Center](https://github.com/kongkongyo/Cli-Proxy-API-Management-Center)（后者又 fork 自官方 [router-for-me/Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center)）。 现已剥离上游关系，作为独立仓库维护。

### Remote 拓扑

| 远端 | URL | 用途 |
| --- | --- | --- |
| `origin` | `https://github.com/calonye/Cli-Proxy-API-Management-Center-fork.git` | 本仓 pull/push |

### 分支规则

- `main`：**稳定主干**，只接收通过调试的合并；**禁止**直接 commit。
- `dev`：**日常研发分支**，允许失败/实验；所有开发从此分支切出。
- `feature/<topic>` / `fix/<topic>` / `refactor/<topic>`：从 `dev` 切出，merge 回 `dev`。

---

## §5 自动化脚本 / Automation & Safety

### 日常研发流程（新人 / AI 必读）

```
feature → [编码 + commit]* → promote → (可选) release
   ❶             ❷              ❸            ❹
```

- **❶ feature**：只能从 dev 切分支（`feature/<topic>` / `fix/<topic>`），禁止从 main 切。
- **❷ commit**：可反复提交。每次用双语 Conventional Commits 格式。
- **❸ promote**：自动预检（type-check / lint / build）→ 合回 dev → 可选合入 main。
- **❹ release**：仅在 main 上打 tag，触发 CI 构建发布。
- 所有脚本支持 `--yes` 等参数跳过交互确认（适配 AI 工具调用）。

### 命令速查

所有日常 Git / 构建动作通过 `scripts/` 目录下的脚本执行，由 `package.json` 的 `bun run` 入口暴露：

| 命令 | 行为 | 安全点 |
| --- | --- | --- |
| `bun run setup` | 首次初始化：建 remote、装 git 钩子、生成个人化配置、校验 bun 版本 | 幂等；支持 `-- --yes` |
| `bun run doctor` | 只读诊断：remote/钩子/版本/工作区状态 | 纯只读 |
| `bun run feature <topic>` | 从最新 dev 切 `feature/<topic>` | 禁止从 main 切 |
| `bun run commit` | 交互式 Conventional Commits（中英双语） | 禁止 main 直 commit |
| `bun run promote` | dev → main 预检 + 双重确认 | typecheck/lint/build 失败中止 |
| `bun run release [ver]` | 打 tag 并可选 push | 仅 main |
| `bun run flow` | 打开流程菜单 | 适合不想记命令时 |
| `bun run start -- <topic>` | 诊断 → 从 dev 切功能分支 | 一键开工 |
| `bun run check` | type-check → lint（既有问题警告）→ build | 一键检查 |
| `bun run save -- <args>` | 转发到双语 commit，并自动 `--yes` | 一键提交 |
| `bun run ship` | promote → 非交互 push main → 回 dev | 敏感操作，需确认本意是合主线 |

### 安全约束

- **禁止**在脚本里执行无备份的全量重写/删除/覆盖。
- 破坏性动作（`rm -rf`、`git reset --hard`、`git push --force`）必须先 echo、询问 Y/n（默认 n）、记录日志。
- 脚本失败时返回非零退出码并打印清晰的中文错误原因。

### Git 钩子（`scripts/git-hooks/`，`bun run setup` 安装软链到 `.git/hooks/`）

- `pre-commit`：禁止在 `main` 分支直接 commit；运行 `bun run type-check`。
- `commit-msg`：校验 `<type>(<scope>): <中文> [en: <english>]`；feat/fix/refactor/perf/build/ci 必须双语。
- `pre-push`：向 `origin/main` 推送时要求输入 `YES` 确认。AI/CI 非交互环境可在预检通过后使用 `ALLOW_MAIN_PUSH=YES git push origin main`。

---

## §6 提交与发布 / Commits & Release

### Conventional Commits（双语）

格式：`<type>(<scope>): <中文简述> [en: <english brief>]`

`type`：`feat` | `fix` | `refactor` | `perf` | `docs` | `chore` | `ci` | `test` | `build` | `style` | `revert` | `merge`

feat/fix/refactor/perf/build/ci/test/revert/merge **必须双语**；docs/chore/style 可仅中文。

### 发布规则

- 在 `main` 上运行 `bun run release` 打 semver tag 并触发 CI 发布。
- **AI 禁止擅自** `git push` 或 `gh pr create`；必须先等用户 Y/N 确认。

---

## 调试通过判据 / Debug Done-Checklist

合并到 `main` 前必须全部 PASS：

- `bun run type-check` 无错误
- `bun run lint` 无新增错误（上游既有问题可接受）
- `bun run build` 成功
- 浏览器冒烟：Dashboard / Usage / Config / 监控中心无报错
