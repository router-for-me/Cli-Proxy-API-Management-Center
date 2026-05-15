---
description: 项目状态快照，记录当前分支、已完成工作、环境状态与下一步计划
version: 1.0.1
lastUpdated: 2026-05-11
---

# 项目状态快照 / Project Status Snapshot

> 本文件不入库，仅本地交接参考。

## 当前分支

`dev`

## 已完成工作

### 阶段一：Fork 关系剥离
- 14 个文件修改，完全剥离 upstream/source 两层 fork 关系
- 仓库身份从三创 fork 转为独立仓库 CPA-Dashboard-kelen
- README 底部保留致谢标注
- `sync` 脚本已删除，`release` 改为标准 semver
- 状态：**已提交**（3 个 commit 在 dev）

### 阶段二：工作空间持久化管理
- `Project/memory/` 项目记忆体系已建立
- `Project/` 本地研发空间迁移完成（`.ai-local/` → `Project/`）

### 阶段三：目录重命名
- 用户选择稍后自行执行 `mv` 操作
- 操作指南在 `Project/Docs/guides/directory-rename-guide.md`
- 状态：**待用户执行**

### 阶段四：CLIProxyAPI 对接
- **前端**：`src/services/api/usageSqlite.ts` 类型化 API 客户端
- **前端**：`src/hooks/useSqliteUsage.ts` React Hook（自动轮询 + 降级）
- **前端**：`src/utils/sqliteAdapter.ts` 数据格式转换适配器
- **前端**：MonitorPage + RequestLogs 已接入 SQLite 双通道自动切换
- **后端提案**：`Project/Docs/proposals/cliproxyapi-sqlite-proposal.md` — 提交给 CLIProxyAPI 目标的 SQLite 持久化方案
- **原则**：不直接修改目标项目，改动通过提案文档提交
- 状态：**前端就绪，待目标方实施后端**

## 环境状态

- bun ✅
- git hooks 已安装 ✅
- remote: 仅 origin ✅（upstream/source 已移除）
- type-check / lint / build 通过 ✅

## 2026-05-10 深度审计发现

### 已修复
- models.ts axios.get → 添加 TIMEOUT_DEFAULT 超时
- release.yml tag 模式 v*-fork.* → v*
- 硬编码 URL 提取：ANTHROPIC_API_BASE / GEMINI_API_BASE 统一到 constants.ts
- 文档重组：SQLite 提案 → Docs/proposals/，重命名指南 → Docs/guides/
- 进度表去重：integration-plan.md 改为引用 STATUS.md

### 已知待处理
- ru.json 缺 141 个 Monitor 页面翻译 key（翻译任务，需用户决策）
- ru.json 5 个死 key（源码无引用，低优先级清理）
- components/providers utils/types 被 pages 直接引用（架构重构，需独立会话）
- README 标题含 "kelen" 个人标识（用户偏好决策）
- SystemPage 链接到未创建仓库（等重命名后统一）
- tsconfig.json 与 tsconfig.app.json 配置偏差（低优先级）
- LICENSE 版权仅有上游作者（法律决策）
- assets/dashboard-preview.png(2.6MB) 较大，考虑压缩或移至 CDN
- CHANGELOG.md 已创建

## 已提交（dev，领先 origin 4 commits）

```
0152b54 chore(rules): 规则体系去重与Project迁移收尾
1e98d09 feat(sqlite): SQLite 使用量前端适配层
965b3ed chore(cleanup): 根目录清理，删除孤儿文件，修复CI与硬编码
b26de4c refactor(identity): 剥离上游fork关系，独立仓库身份
```

## 2026-05-11 规则去重与参考仓库调研

### 已完成
- AI 规则去重：AGENTS.md 缩减 ~40%，移除 §1/§3 全局重复段
- private-rules.md 删除（100% 全局规则副本）
- .claude/settings.local.json 清理（18→5 条权限，移除 12 条 Go/Python 无效条目）
- CLAUDE.md 修复断裂引用（仅 @./AGENTS.md）
- 5 个参考仓库调研：创建 `Project/Docs/reference-repos-tracking.md`
  - router-for-me upstream: v1.7.36 已同步，需确认后续新提交
  - Willxup/cpa-usage-keeper: 最高价值参考，凭证 Quota + usage identity
  - zhanglunet/cliproxyapi-usage-dashboard: 维护度低，参考价值有限
  - seakee/CPA-Manager: 监控增强方向重叠
  - diegosouzapw/OmniRoute: 架构灵感，Token 压缩 + Provider 健康检查

## 2026-05-11 决策队列实现（第 1 批）

### 已完成
- **P1: usage identity 解析** → `RequestLogs.tsx:450` — auth_index 现在通过 `authFileMap` 解析为可读凭证名称
- **P1: MonitorPage 自定义时间范围** → `MonitorPage.tsx` — 替换硬编码 1|7|14|30 按钮为 `TimeRangeSelector` 组件（已支持自定义日期），同步更新 KpiCards/ModelDistributionChart/DailyTrendChart 的 timeRange 类型
- **P2: Token=0 异常过滤** → `sqliteAdapter.ts` — 新增 `suspiciousToken` 标记（total_tokens===0 && !failed），`UsageDetail` 接口同步扩展

### 阻塞
- **P0: 凭证额度 Quota 追踪** — 需后端 `/v0/management/usage-sqlite/quota` 端点，当前不存在。前端配额组件（API/Hook/adapter/UI）已设计完成，待后端就绪后约 140 行新代码即可打通。

## 2026-05-11 第 2 批改进

### 已完成
- **README 隐私清理** → README.md / README_EN.md 移除"开发规则 / Dev Rules"段（暴露 AI 协作规则、scripts、bun run setup 等研发内部信息）
- **AI 配置文件去重清理** → 删除 `.claude/` `.cursor/` `.factory/` 目录及 `CLAUDE.md`（setup.sh 默认改为 stealth 模式，按需 `--mode=ref` 才生成）；`.claude/settings.local.json` → `Project/settings/claude-permissions.json`
- **OAuth Claude Quota 401 故障** → `quotaConfigs.ts` — 新增 401 + OAuth 文件检测，提示"OAuth token 已过期，请在 OAuth 页面重新登录"替代通用错误；`isClaudeOAuthFile` 已接入 quota 流程。用户确认：删除凭证重新 OAuth 登录后恢复正常，根因是 Anthropic access_token 过期后代理层未自动 refresh。
- **CLIProxyAPI 上游追踪** → `Project/Docs/cliproxyapi-upstream-tracking.md` — API 端点清单、前端对接状态、5 项待关注

## 2026-05-11 第 3 批改进

### 已完成
- **上游 v1.7.36→v1.10.2 全量调研** → 50+ commits / 108 文件变动，usage 架构完全重写（usage.ts 1907行→recentRequests.ts 221行），结论：选择性 cherry-pick，绝不全量 merge
- **P2: OAuth 401 泛化** → `validators.ts` — `isClaudeOAuthFile` 重构为泛化 `isOAuthFile`，不限于 Claude，任何 OAuth provider 的 401 均可被识别；`quotaConfigs.ts` 同步替换
- **P2: quotaConfigs Codex header 可选** → `quotaConfigs.ts:413-419` — `Chatgpt-Account-Id` header 改为可选，缺失时不再 throw，与上游 `62092cc` 对齐

### 上游 usage 重构学习（b25f722）
- **设计理念**：固定窗口桶聚合（20 桶 × 10 分钟），O(1) 状态栏查询，不再全量遍历
- **融合方案**：SQLite 新增 `recent_buckets` 表，按 `floor(timestamp / 600000)` 分桶，INSERT OR REPLACE 增量更新 + 滑动窗口自动淘汰 20 桶外旧数据
- **收益**：状态栏/KPI 卡片查询从 O(n)→O(1)，详情钻取保留全量记录
- **状态**：方案已设计，待用户确认后实施

### Codex Inspection 功能实现
- **CodexSection.tsx** → 每行 Key 加"检测"按钮，四态显示：idle/检测中/成功/失败（附错误信息）
- **AiProvidersCodexEditPage.tsx** → Base URL 下方"测试连接"按钮，保存前验证连通性
- **i18n** → 5 个新 key（codex_inspect_* + codex_test_connection）
- **实现**：纯前端，复用 `modelsApi.fetchV1ModelsViaApiCall`
- **状态**：✅ 已实现并提交 → `1e44906`

### SQLite 桶聚合
- **bucketUsageRecords()** → `sqliteAdapter.ts` 新增固定窗口桶聚合函数，O(1) 状态栏查询
- **参数**：bucketMinutes=10, maxBuckets=20，覆盖约 3.3 小时滑动窗口
- **使用**：在 MonitorPage 调用 `bucketUsageRecords(sqliteRecords)` 获得预聚合桶数据
- **状态**：✅ 工具函数已实现并集成 → `2123327`

### Provider 健康检查泛化
- **useProviderInspect** → 共享 Hook，封装连通性检测逻辑（inspectMap + handleInspect）
- **CodexSection** → 重构为使用共享 Hook
- **ClaudeSection / GeminiSection / VertexSection** → 新增检测按钮
- **OpenAI / Ampcode** → 已适配（OpenAI 检测第一个 apiKeyEntry，Ampcode 映射 upstreamUrl→baseUrl）
- **状态**：✅ 已实现并提交 → `2123327`, `b66b6b6`

## 下一步

1. ~~目录重命名~~（用户自行操作）
2. ~~Codex Inspection~~ → ✅
3. ~~SQLite 桶聚合~~ → ✅ 已集成 KpiCards
4. ~~Provider 健康检查泛化~~ → ✅ 4/6 Section 已完成
5. P0 Quota 追踪（待后端就绪）
6. ~~OpenAI/Ampcode Section 健康检查适配~~ → ✅
7. Anthropic OAuth proxy bug（诊断完成，需后端修复）
8. 继续 Phase 4：费用预估、多维度追踪、UI 一致化

## 2026-05-11 Phase 4 启动

### 已完成
- **费用预估** → KpiCards 新增 `gold` 成本卡片，复用 UsagePage 已有的 `calculateTotalCost` + `loadModelPrices` 管线。MonitorPage 启动时自动加载 localStorage 模型价格，传入 KpiCards 实时计算 `$X.XXXX`。用户可在 UsagePage→价格配置 编辑各模型定价。
- **RequestLogs 凭证筛选** → 新增 `authIndex` 下拉过滤器，沿袭已有 5 个 `<select>` 模式。支持按凭证索引精确筛选请求日志。
- **样式** → MonitorPage.module.scss 新增 `gold` 色系 KPI 卡片（amber #f59e0b）

### 关键发现
- 成本计算管线（`ModelPrice` / `calculateTotalCost` / `loadModelPrices` / `PriceSettingsCard`）早已在 UsagePage 实现完毕，MonitorPage 集成仅需 ~20 行胶水代码。
- 模型价格是用户自维护的（localStorage），无预置默认定价表——未来可考虑预置主流模型价格。

### 状态
✅ 已提交 → `d20421f`
