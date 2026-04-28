# 项目 AI 协作规范 / Project AI Collaboration Rules

> 本文件适用于**所有** AI 工具（Factory Droid / Claude Code / Cursor / GitHub Copilot 等）。
> 项目级客观规范，不含个人偏好。个人化叠加层见 `.ai-local/private-rules.md`（不入库）。
>
> **语言约定：简体中文为主，英文为辅。** / Chinese primary, English secondary.

---

## §0 快速开始 / Quick Start

```bash
# 首次克隆
git clone https://github.com/calonye/Cli-Proxy-API-Management-Center-fork.git
cd Cli-Proxy-API-Management-Center-fork
bun install
bun run setup              # 装 remote、hooks、个人化配置（AI 可用 -- --yes）

# 日常研发循环（每次开工必走）
bun run sync               # ❶ 拉取上游最新（选择性合并或仅 fetch）
bun run feature <topic>    # ❷ 从 dev 切功能分支
# ... 编码 ...
bun run commit             # ❸ 交互式双语提交（可反复）
bun run promote            # ❹ 预检 → 合回 dev → 可选合入 main
bun run release            # ❺ 打 fork tag 触发 CI（仅在 main 上）

# 诊断与调试
bun run doctor             # 环境诊断
bun run dev                # Vite dev server (localhost:5173)
bun run build              # 单文件构建 dist/index.html
bun run type-check         # TypeScript 检查
bun run lint               # ESLint
```

---

## §1 开发铁律 / Development Iron Rules

### 约束四原则

1. **处理不确定性与信息缺失**：在做出假设之前**必须**提出澄清问题，不能在不确定时继续推进。澄清问题出现在**动手编码之前**，而不是做错之后。
2. **管理复杂性**：保持代码和 API 的简洁，优先选择**最简单的实现方式**，避免过度设计。
3. **维护代码库连贯性**：**不得移除或更改你不完全理解的代码或注释**，即使这些内容与当前任务无关。PR 更整洁，没有"顺带优化"的冗余提交。
4. **设定清晰成功标准**：对多步骤任务，每一步都必须有明确、可检查的完成标准。diff 里的改动更干净，只出现被要求修改的部分。

### 代码审查与执行

- 编码前三思并必读现有文件（已读勿重读）→ **优先局部修改，禁全盘重写** → 推理全面透彻、输出简洁明了。
- **脚本执行需谨慎**：**禁止**无备份的全量复写/删除/覆盖；除非用户明确同意，否则必须征求方案细节风险的确认与决策。

---

## §2 技术栈与工具链 / Tech Stack & Tooling

### 包管理器（本仓强制）

- **优先使用 `bun` > `pnpm`，不使用 `npm`**。
- 若发现任何 `npm` 命令（代码/脚本/CI），反馈替换可行性建议与 Plan，经确认后迁移。
- 本仓用 `bun.lock` 取代 `package-lock.json`；若 merge upstream 带入 `package-lock.json`，合并后删除。

### 命令行工具

- **优先使用 Rust 现代 CLI**（`ripgrep` 替代 `grep`、`fd` 替代 `find`），而非传统工具。

### 信息源质量

- **禁止**引用 `csdn.net`、阿里云/腾讯云/华为云社区等内容农场信息。
- 优先引用官方文档 / MDN / GitHub / 权威博客。

### 本仓技术栈

- React 19 + TypeScript 5.9 + Vite 7 + SCSS Modules + zustand + i18next。
- 不引入 `package.json` 未声明的新库；如需新依赖，先与用户确认。
- 新增 UI 文案**必须**同时在 `src/i18n/zh` 与 `src/i18n/en` 补键。

---

## §3 计划与输出 / Planning & Output

### 计划开始前 6 步

1. **思维链**：信息 → 分析 → 思考 → 质疑/批判 → 评估/交叉验证 → 循环后得出解决思路。
2. 用一句话重述目标（用户价值 + 验收标准）。
3. 判断用户给的信息是否足够；若不足，先提**最少 3 个澄清问题**。
4. 对比「我提出的路径」和「最短可行路径」，若不是最短，明确指出并给替代方案。
5. **只做与当前目标直接相关的最小改动**，不做顺手重构。
6. 补充不脱离设计意图的建设性建议；必须思考交叉验证与对抗性审查。

### 最小输出模板

> 改动清单（文件 + 目的）> 风险点 > 建设性建议 > 交叉/边界/对抗验证。

### 开始写代码前

- **联网搜索**其最佳实践（Best Practices），但避免内容农场源（§2）。

---

## §4 仓库身份与分支规则 / Identity & Branches

### 三创声明

本仓库是**第三层 fork（三创）**。感谢源头作者 `router-for-me` 与上游作者 `kongkongyo` 的开源贡献。本仓库严格遵循原作者的开源协议（MIT），任何修改不改变原作者署名与 LICENSE 文件。

### Remote 拓扑

| 远端 | URL | 用途 |
| --- | --- | --- |
| `origin` | `https://github.com/calonye/Cli-Proxy-API-Management-Center-fork.git` | 本仓 pull/push |
| `upstream` | `https://github.com/kongkongyo/Cli-Proxy-API-Management-Center.git` | 上游仅 fetch |
| `source` | `https://github.com/router-for-me/Cli-Proxy-API-Management-Center.git` | 源头仅 fetch |

### 分支规则

- `main`：**稳定主干**，只接收通过调试的合并；**禁止**直接 commit。
- `dev`：**日常研发分支**，允许失败/实验；所有开发从此分支切出。
- `feature/<topic>` / `fix/<topic>` / `refactor/<topic>`：从 `dev` 切出，merge 回 `dev`。

### 链接规则

- 文档/代码/界面中所有指向「本项目」的链接**必须**用 `https://github.com/calonye/Cli-Proxy-API-Management-Center-fork`。
- 引用上游/源头时必须在上下文中明确标注「上游」或「源头/官方」。

---

## §5 自动化脚本 / Automation & Safety

### 日常研发流程（新人 / AI 必读）

```
sync → feature → [编码 + commit]* → promote → (可选) release
 ❶        ❷           ❸                ❹              ❺
```

- **❶ sync**：每次开工前必做。拉取 upstream/source 最新，选择性合并到 main，再合回 dev。
- **❷ feature**：只能从 dev 切分支（`feature/<topic>` / `fix/<topic>`），禁止从 main 切。
- **❸ commit**：可反复提交。每次用双语 Conventional Commits 格式。
- **❹ promote**：自动预检（type-check / lint / build）→ 合回 dev → AI 输出 PR 判断 → 可选合入 main。
- **❺ release**：仅在 main 上打 `v*-fork.N` tag，触发 CI 构建发布。
- 所有脚本支持 `--yes` 等参数跳过交互确认（适配 AI 工具调用）。

### 命令速查

所有日常 Git / 构建动作通过 `scripts/` 目录下的脚本执行，由 `package.json` 的 `bun run` 入口暴露：

| 命令 | 行为 | 安全点 |
| --- | --- | --- |
| `bun run setup` | 首次初始化：建 remote、装 git 钩子、生成个人化配置、校验 bun 版本 | 幂等；支持 `-- --yes` |
| `bun run doctor` | 只读诊断：remote/钩子/版本/工作区状态 | 纯只读 |
| `bun run sync` | 同步 upstream/source → main → dev | 脏工作区中止；冲突停 |
| `bun run feature <topic>` | 从最新 dev 切 `feature/<topic>` | 禁止从 main 切 |
| `bun run commit` | 交互式 Conventional Commits（中英双语） | 禁止 main 直 commit |
| `bun run promote` | dev → main 预检 + PR 判断 + 双重确认 | typecheck/lint/build 失败中止 |
| `bun run release [ver]` | 打 `v*-fork.N` tag 并可选 push | 仅 main |

### 安全约束

- **禁止**在脚本里执行无备份的全量重写/删除/覆盖。
- 破坏性动作（`rm -rf`、`git reset --hard`、`git push --force`）必须先 echo、询问 Y/n（默认 n）、记录日志。
- 脚本失败时返回非零退出码并打印清晰的中文错误原因。

### Git 钩子（`scripts/git-hooks/`，`bun run setup` 安装软链到 `.git/hooks/`）

- `pre-commit`：禁止在 `main` 分支直接 commit；运行 `bun run type-check`。
- `commit-msg`：校验 `<type>(<scope>): <中文> [en: <english>]`；feat/fix/refactor/perf/build/ci 必须双语。
- `pre-push`：阻止向 `upstream`/`source` 推送；向 `origin/main` 推送时要求输入 `YES` 确认。AI/CI 非交互环境可在预检通过后使用 `ALLOW_MAIN_PUSH=YES git push origin main`。

---

## §6 提交、同步、PR 判断 / Commits / Sync / PR

### Conventional Commits（双语）

格式：`<type>(<scope>): <中文简述> [en: <english brief>]`

`type`：`feat` | `fix` | `refactor` | `perf` | `docs` | `chore` | `ci` | `test` | `build` | `style` | `revert` | `merge`

feat/fix/refactor/perf/build/ci/test/revert/merge **必须双语**；docs/chore/style 可仅中文。

### 上游同步策略

1. `bun run sync` 自动 fetch upstream + source + tags。
2. 优先从 `upstream/main` 合并；若上游长期落后于 `source`，可从 `source/main` 合并。
3. 解决冲突后在 `main` 打 tag `v<upstream_version>-fork.<n>`。
4. `main` 变化后自动合回 `dev`。

### PR 判断规则（AI 必须主动思考）

当改动从 `dev` 合入 `main` 时，AI 必须输出改动清单 + 逐条 PR 判断：

| 改动类型 | 是否回馈上游？ |
| --- | --- |
| 通用 bug 修复 / 性能优化 / 通用新功能 | 建议向 `upstream` 提 PR |
| fork 私有（链接/身份/个人化工作流/CI） | 不提 PR |
| 依赖升级 | 视情况 |

**AI 禁止擅自** `git push` 或 `gh pr create`；必须先输出判断并等 Y/N 确认。

---

## 调试通过判据 / Debug Done-Checklist

合并到 `main` 前必须全部 PASS：

- `bun run type-check` 无错误
- `bun run lint` 无新增错误（上游既有问题可接受）
- `bun run build` 成功
- 浏览器冒烟：Dashboard / Usage / Config / 监控中心无报错
