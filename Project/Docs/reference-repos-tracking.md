---
description: 日常灵感参考仓库追踪——监控趋势、发掘可融合功能、记录调研结论
version: 1.0.0
lastUpdated: 2026-05-11
---

# 参考仓库追踪 / Reference Repository Tracking

> 定期关注以下仓库的 bug/feature，分析是否可融合进本项目。
> 更新频率：按需，每次调研后更新本文件。

## 参考仓库总览

| 仓库 | Stars | 语言 | 定位 | 与本项目关系 |
|------|-------|------|------|-------------|
| router-for-me/Cli-Proxy-API-Management-Center | 2562 | TypeScript | 官方上游 | **直接祖先**——我们 fork 自其二创仓库 |
| Willxup/cpa-usage-keeper | 423 | Go+React | SQLite 用量持久化后端 | **最相关参考**——与我们的 SQLite 适配层互补 |
| zhanglunet/cliproxyapi-usage-dashboard | 24 | Python | 轻量用量面板 | 参考——纯 Python 方案，维护度低 |
| seakee/CPA-Manager | 333 | TypeScript | 二创 fork 管理面板 | 参考——监控增强方向与我们目标重叠 |
| diegosouzapw/OmniRoute | 4298 | TypeScript | AI 网关/路由/压缩 | 灵感源——架构设计、多 Provider 路由、Token 压缩 |

---

## 1. router-for-me/Cli-Proxy-API-Management-Center（上游）

**定位：** CPA 官方 Web 管理面板。我们在这个基础上做了 SQLite 持久化、监控中心增强等。

**最近活动：** 极高（最新 tag v1.10.2，2026-05 持续发布）

### v1.7.36 → v1.10.2 演进分析（2026-05-11 调研）

- **跨越版本：** v1.7.37 → v1.10.2，11 个 semver tag，50+ commits
- **变化规模：** 108 文件，+5352/-10885 行
- **核心重构：** `usage.ts` (1907行) → `recentRequests.ts` (221行)，用量统计架构大改
- **新功能：** OpenAI Provider 全链路支持、thinking intensity 显示、session affinity 路由配置、Claude Team 计划检测
- **OAuth 改进：** `60790b9` OAuthPage 成功后显示 login + view auth files 入口（与我们 P0 UX 改进方向一致）
- **quotaConfigs：** `62092cc` Chatgpt-Account-Id header 改为可选（与我们 P2 同步项相关）
- **样式/构建：** Vite 单文件输出、暗色主题修复、移动端侧边栏左移

### 融合建议

直接全量 merge 风险极高——usage 架构已完全不同。建议**选择性 cherry-pick**：
- **可立即 cherry-pick：** OAuth 成功后引导 (`60790b9`)、quotaConfigs header 可选 (`62092cc`)、暗色主题修复 (`1a056ec`)
- **需评估后再合：** OpenAI Provider 支持（可能冲突我们改动）、thinking intensity（可能冲突）
- **不建议合：** usage 架构重构（与我们 SQLite 适配层冲突）

### 决策项

- [x] 确认上游 v1.7.36 → v1.10.2 新提交（2026-05-11）
- [x] cherry-pick `60790b9` OAuth 成功后引导——已评估，与现有 OAuthPage 增强重叠
- [x] cherry-pick `62092cc` quotaConfigs header 可选——已实现
- [x] eval `b25f722` usage 重构为 recentRequests——已评估，工具层已实现 bucketUsageRecords

---

## 2. Willxup/cpa-usage-keeper（最相关参考）

**定位：** 独立的 CPA 用量追踪与展示服务——Go 后端 + React 前端，内置 SQLite 持久化和 Dashboard。与我们的 SQLite 适配层方向相同但架构不同。

**最近活动：** **极高**——5 天 4 个版本（v1.5.0→v1.6.0），2026-05-10 当日 15 个 commits

### 技术架构差异

| 维度 | cpa-usage-keeper | 本项目 |
|------|------------------|--------|
| 后端 | Go（直连 Redis 消费事件） | 无（纯前端 SPA） |
| 数据来源 | CPA Redis 队列 + HTTP 轮询 | CPA HTTP API + SQLite HTTP 端点 |
| 存储 | 内置 SQLite（GORM） | 依赖 CPA 后端 SQLite |
| 前端 | React + TS（内嵌到 Go 二进制） | React + TS（独立 Vite 构建） |
| 部署 | 单二进制 + Docker | 静态文件（由 CPA 托管） |

### 功能亮点（可借鉴）

| 功能 | 优先级 | 说明 |
|------|--------|------|
| **凭证额度 Quota 追踪** | P0 | v1.6.0 新增——显示每个凭证的剩余额度、重置时间。我们 MonitorPage 可加此维度 |
| **Redis 队列直连** | P1 | 绕过 HTTP API 获取实时事件——但我们纯前端架构不支持，需后端代理 |
| **usage identity 解析** | P1 | 将 CPA 内部 auth_index 映射为用户可读凭证名称——我们的 RequestLogs 可受益 |
| **SQLite 备份 + 保留策略** | P2 | 自动备份 + 可配置保留天数——运维友好 |
| **请求事件分页 + 多维筛选** | P2 | 按模型/凭证/时间范围筛选——我们的 RequestLogs 已有基础筛选，可增强 |
| **版本更新检测** | P3 | 内置版本号对比——小型 UX 增强 |
| **Docker Compose 一键部署** | P3 | CPA + Usage Keeper 联调——运维工具 |

### Issues 关注（Bug 洞察）

| Issue | 状态 | 洞察 |
|-------|------|------|
| Gemini 3.1 Token 统计为 0 | OPEN | CPA 原生 bug——我们的 SQLite 适配层应验证 Token 为 0 时的处理 |
| OpenAI 兼容模式 Token 为 0 | CLOSED | 同上——需在 sqliteAdapter 中增加异常值过滤 |
| 更新后数据丢失 | CLOSED | SQLite 迁移兼容性问题——我们的后端方案需注意迁移健壮性 |
| 凭证流量表显示问题 | OPEN | UI bug——按 model/credential 维度展示时偶发不聚合 |
| 希望按模型和认证统计 | OPEN | Feature request——与我们的 KPI 卡片方向一致 |

### 决策项

- [ ] P0: 研究将凭证额度 Quota 维度加入 MonitorPage（借鉴 v1.6.0 API 设计）
- [x] P1: usage identity 解析——RequestLogs 增加可读来源名称映射 (2026-05-11)
- [x] P2: 审查 sqliteAdapter 对 Token=0 的异常处理——已加 suspiciousToken 标记 (2026-05-11)
- [x] P2: 多维筛选增强——已实现 (authIndex 凭证下拉筛选器)

---

## 3. zhanglunet/cliproxyapi-usage-dashboard

**定位：** Python 实现的本地 token 用量与配额面板。小型项目，Star 量低，最近更新 2026-05-03。

**技术栈：** Python（推测 Flask/FastAPI），24⭐，只有 4 个 commits

### 分析结论

- 项目规模小，功能有限——可作为"最简实现"的参考
- 关注点：纯 dashboard 视角，无管理功能
- **维护度：低**——5 月 3 日后无更新
- 与我们差异大（Python vs TypeScript，纯展示 vs 全管理）

### 决策项

- [ ] 低优先级——仅在不引入复杂度的前提下关注其前端 UI 设计思路

---

## 4. seakee/CPA-Manager

**定位：** 基于上游的二创 TypeScript fork，333⭐，与我们在同一演进路径上。

**最近活动：** 活跃（2026-05-09 当日 10 个 commits），聚焦监控增强

### 功能亮点

| 功能 | 优先级 | 说明 |
|------|--------|------|
| **Monitoring 自定义时间范围** | P1 | feat: add custom time range filtering——我们的 MonitorPage 可考虑 |
| **Codex Inspection 实时更新** | P1 | fix: update codex inspection results live——我们 Codex 相关组件可借鉴 |
| **Monitoring 加载遮罩修复** | P2 | fix: unblock loading overlay interactions——UX 打磨 |
| **Account 显示标签优化** | P2 | fix: improve account display labels——UX 打磨 |
| **Model Mapping 可视化图** | P2 | 新增 ModelMappingDiagram 组件——模型映射关系可视化 |

### 架构新增（与我们差异）

| 组件 | 说明 |
|------|------|
| `ConfigSection.tsx` + `VisualConfigEditor.tsx` | 可视化管理配置——我们目前是表单驱动 |
| `DiffModal.tsx` | 配置 diff 对比——Git 风格的变更审查 |
| `ModelMappingDiagram.tsx` | 模型映射关系图——DAG 可视化 |
| `PageTransition.tsx` + `SplashScreen.tsx` | 页面过渡动画 + 闪屏 |

### 决策项

- [x] P1: MonitorPage 自定义时间范围过滤——已接入 TimeRangeSelector (2026-05-11)
- [x] P1: Codex Inspection 实时更新——已实现，CodexSection 检测按钮 + EditPage 测试连接
- [ ] P2: ModelMappingDiagram 方向——模型别名映射可视化
- [ ] P3: PageTransition 动画——UX 打磨（非功能优先级低）
- [ ] 注意：该仓库文件结构与上游高度同源，融合需注意合并冲突

---

## 5. diegosouzapw/OmniRoute

**定位：** 免费 AI 网关——统一端点，160+ Provider，13 种路由策略，Token 压缩（RTK+Caveman）。**非 CPA 项目，而是独立的 AI 网关层。**

**规模：** 4298⭐，709 forks，npm 包 + Docker + Electron 桌面应用 + PWA

### 核心能力

| 能力 | 实现 | 对本项目的启发 |
|------|------|---------------|
| **多 Provider 路由** | 160+ providers，13 种路由策略 | 我们的 Provider 管理面板可考虑策略路由配置 |
| **Token 压缩 ~95%** | RTK + Caveman stacked compression | **前沿技术**——如果 CPA API 未来支持压缩，监控指标需适配 |
| **Smart Auto-Fallback** | 模型故障自动切换 | 我们的面板可增加 fallback 链可视化 |
| **MCP Server (37 tools)** | 通过 MCP 协议暴露网关能力 | 前沿——我们的 Config 页面未来可考虑 MCP 端点管理 |
| **A2A Protocol** | Agent-to-Agent 通信 | 前沿——不是当前阶段重点 |
| **多模态 API** | Chat/Image/Video/Audio/Speech | 我们的 MonitorPage 可增加多模态用量维度 |
| **40+ 语言 i18n** | 完整国际化 | 我们目前仅中英双语——非优先级 |
| **多平台** | Web/Desktop(Electron)/Mobile(PWA+Termux) | 我们的 PWA 能力可参考 |

### 架构亮点

- **端点路由抽象层**：将不同 LLM 提供商的 API 统一为一个端点——类似我们的 Provider 配置但更进一步
- **压缩管道**：请求/响应双向压缩——如果 CPA 未来集成，我们的监控指标需要反映压缩率
- **健康检查**：Provider 健康状态实时监控——我们的 ProviderStatusBar 可增强

### 决策项

- [x] P1: 研究 Provider 健康检查机制——已实现 (useProviderInspect)，OpenAI/Ampcode 待适配为子项
- [ ] P2: Smart Auto-Fallback 链可视化——等 CPA 后端支持后再做
- [ ] P3: Token 压缩指标监控——等 CPA 后端支持后，usage 统计需区分原始 vs 压缩 token
- [ ] P3: 多模态用量维度——MonitorPage 未来可加 image/video/audio 类型 tab

---

## 综合决策队列（按优先级）

| # | 来源 | 功能 | 优先级 | 状态 |
|---|------|------|--------|------|
| 1 | cpa-usage-keeper | 凭证额度 Quota 追踪 | P0 | 阻塞——需后端 `/v0/management/usage-sqlite/quota` 端点 |
| 2 | cpa-usage-keeper | usage identity 解析（auth_index→可读名称） | P1 | ✅ 已实现 — RequestLogs.tsx:450 |
| 3 | CPA-Manager | MonitorPage 自定义时间范围 | P1 | ✅ 已实现 — MonitorPage 接入 TimeRangeSelector |
| 4 | CPA-Manager | Codex Inspection 实时更新 | P1 | 待评估——无现有 Inspection 概念，需明确需求范围 |
| 5 | cpa-usage-keeper | Token=0 异常处理（sqliteAdapter） | P2 | ✅ 已实现 — suspiciousToken 标记 |
| 6 | cpa-usage-keeper | RequestLogs 多维筛选 | P2 | ✅ 已实现 — 新增 authIndex 凭证下拉筛选器 (d20421f) |
| 7 | upstream | quotaConfigs 可选 header 同步 | P2 | ✅ 已实现 — Chatgpt-Account-Id header 改为可选 |
| 8 | OmniRoute | Provider 健康检查增强 | P2 | ✅ Claude/Gemini/Vertex 已实现，OpenAI/Ampcode 待适配 |
| 9 | CPA-Manager | ModelMappingDiagram 可视化 | P3 | 待评估 |
| 10 | cpa-usage-keeper | SQLite 备份 + 保留策略 | P3 | 待评估 |
| 11 | 内部 | OAuth 401 泛化到所有 OAuth provider | P2 | ✅ 已实现 — isOAuthFile 泛化 + quotaConfigs 同步 |
| 12 | CPA-Manager | Codex Inspection 实时 Key 有效性检测 | P1 | ✅ 已实现——CodexSection 检测按钮 + EditPage 测试连接 |
| 13 | upstream(b25f722) | SQLite recent_buckets 桶聚合借鉴 | P1 | ✅ 工具已实现——bucketUsageRecords() 固定窗口桶聚合，待 MonitorPage 集成 |
| 14 | 内部 | Provider 健康检查泛化 | P2 | ✅ useProviderInspect 共享 Hook，Codex/Claude/Gemini/Vertex 已完成 |

---

## 更新日志

- 2026-05-11: 初始创建——5 个参考仓库首次调研
- 2026-05-11: 第 1 批实现——P1 identity 解析 + P1 自定义时间范围 + P2 Token=0 过滤
- 2026-05-11: 第 3 批实现——上游 v1.10.2 全量调研 + P2 isOAuthFile 泛化 + P2 Codex header 可选 + SQLite 桶聚合方案设计 + Codex Inspection 方案设计
