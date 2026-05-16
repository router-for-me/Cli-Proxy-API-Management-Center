---
description: 日常灵感参考仓库追踪——监控趋势、发掘可融合功能、记录调研结论
version: 1.0.0
lastUpdated: 2026-05-16
---

# 参考仓库追踪 / Reference Repository Tracking

> 定期关注以下仓库的 bug/feature，分析是否可融合进本项目。
> 更新频率：按需，每次调研后更新本文件。

## 参考仓库总览

| 仓库 | Stars | 语言 | 定位 | 与本项目关系 |
|------|-------|------|------|-------------|
| router-for-me/Cli-Proxy-API-Management-Center | 2665 (+103) | TypeScript | 官方上游 | **直接祖先**——我们 fork 自其二创仓库 |
| Willxup/cpa-usage-keeper | 520 (+97) | Go+React | SQLite 用量持久化后端 | **最相关参考**——与我们的 SQLite 适配层互补 |
| zhanglunet/cliproxyapi-usage-dashboard | 24 (=0) | Python | 轻量用量面板 | 参考——纯 Python 方案，维护度低 |
| seakee/CPA-Manager | 547 (+214) | TypeScript | 二创 fork 管理面板 | 参考——监控增强方向与我们目标重叠 |
| diegosouzapw/OmniRoute | 4622 (+324) | TypeScript | AI 网关/路由/压缩 | 灵感源——架构设计、多 Provider 路由、Token 压缩 |

---

## 1. router-for-me/Cli-Proxy-API-Management-Center（上游）

**定位：** CPA 官方 Web 管理面板。我们在这个基础上做了 SQLite 持久化、监控中心增强等。

**最近活动：** 极高（最新 tag v1.10.2，2026-05-10 发布，上次调研以来无新 commits）

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

**最近活动：** **极高**——v1.6.0→v1.7.2，5 天 6 个版本（2026-05-15 当日 12 个 commits），Stars 520 (+97)

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

### v1.6.2→v1.7.2 新变化（2026-05-16 调研）

自上次调研（2026-05-11，v1.6.0）以来，新增 5 个版本（v1.6.2→v1.7.2），共计 35+ commits。

| 版本 | 日期 | 核心内容 | 对本项目的启发 |
|------|------|---------|--------------|
| v1.7.2 | 05-15 | **Analysis 分析页面**：token 趋势、API Key 占比、模型占比、API Key×模型热力图 | 我们的 KPI 卡片 + 图表组合可以借鉴此分析页面设计 |
| v1.7.1 | 05-15 | 前端布局修复：工具栏筛选/刷新按钮挤压、凭证列表布局、配额进度条隐藏支持 | UX 参考——移动端适配细节 |
| v1.7.0 | 05-14 | **统计性能架构升级**：增量统计表（小时/天/Health/checkpoint），避免大范围扫描原始事件 | **架构借鉴**——我们若实现离线统计功能，增量表方案比全量重扫更合理 |
| v1.6.3 | 05-13 | 性能优化：项目查询、int64 ID 处理、Claude cache rate 修复 | Claude cache rate 计算修复——与我们 cache 指标展示相关 |
| v1.6.2 | 05-12 | 新增 HTTPS/TLS 配置、统一时区处理、Request Event Log 表头固定/紧凑显示 | 时区处理方案、事件日志表 UX 优化参考 |

### v1.7.2 Analysis 页面深度分析（2026-05-16 调研）

Analysis 页面是 v1.7.2 的核心新功能，从 Usage 页面中提取出独立 tab。采用预聚合统计表（v1.7.0 引入）避免全量 Event 扫描，显著提升大数据量下的查询性能。

#### 数据模型

后端 Analysis 接口 `GET /usage/analysis` 返回 `AnalysisResponse`：

```ts
interface AnalysisResponse {
  granularity: 'hourly' | 'daily'         // 自动切换：窗口>24h → daily
  timezone: string
  range_start?: string
  range_end?: string
  token_usage: AnalysisTokenUsageBucket[]  // 时间序列：token 按 bucket 聚合
  api_key_composition: AnalysisCompositionItem[]  // API Key 占比
  model_composition: AnalysisCompositionItem[]    // 模型占比
  heatmap: AnalysisHeatmapPayload          // API Key × Model 热力图
}
```

- Token 趋势：每个 bucket 含 input/output/cached/reasoning tokens + requests 计数
- Composition：每个条目含 key/label/total_tokens/requests/percent
- Heatmap：api_keys[] / models[] 纬度 + cells[]（每格含 intensity 归一化 0-1）

#### 图表清单

| 图表 | 类型 | 数据纬度 | 特征 |
|------|------|---------|------|
| Token Usage | Stacked Bar + Overlaid Line | 时间序列（x: 时间, y1: 4 token 堆叠, y2: requests 折线） | 双 Y 轴；渐变色填充；虚线折线叠加；自定义 Plugin |
| API Key Composition | Doughnut | Top-5 API Key Token 占比 | cutout 58%；右侧独立图例（百分比+名称）；聚合 Others |
| Model Composition | Doughnut | Top-5 Model Token 占比 | 同上 |
| API Key×Model Heatmap | CSS Grid | 行: API Key, 列: Model | 无第三方库；黄→琥珀→红棕渐变；CSS tooltip |

#### 交互设计

- Tab 切换：overview / analysis / events / credentials / settings 5 个 Tab
- 时间范围联动：共用顶层选择器（4h/8h/12h/24h/today/yesterday/7d/30d/custom）
- API Key 筛选联动：可选指定 API Key 筛选分析范围
- API Key 脱敏：后端通过 CPA API Key 表映射显示名，未配置则自动脱敏
- 粒度自动切换：窗口>24h 自动 daily，<=24h 保持 hourly
- 自动刷新：Analysis 不自动刷新（仅首次加载），Overview tab 每 10s 自动刷新
- 加载/空状态：loading spinner + dashed border 空状态占位

#### 架构亮点

1. **预聚合统计表**：查询只读 hour/daily/health 预聚合表，不扫描 usage_events
2. **自动切换粒度**：`computeWindowMinutes()` + `bucketByDay` 逻辑自动判断
3. **Top-N + Others 聚合**：`takeMajorComposition()` 截取 Top-5，剩余合并
4. **双 Y 轴复合图**：4 token 堆叠柱状（左 Y）+ requests 折线（右 Y），自定义 Plugin 控制绘制层级
5. **CSS Grid 热力图**：纯 CSS Grid + linear-gradient 单元格，无第三方图表依赖

#### 与 MonitorPage 对比

| 纬度 | MonitorPage（本项目） | AnalysisPage（cpa-usage-keeper） |
|------|---------------------|--------------------------------|
| Token 趋势 | HourlyTokenChart + DailyTrendChart（分开） | 单一 Stacked Bar + Requests 叠加 |
| Token 细分 | 单独展示 | 堆叠展示 + 渐变填充 |
| 模型分布 | ModelDistributionChart（Doughnut） | Composition Doughnut（Top-5+Others） |
| API Key 分布 | ChannelStats（表格） | Composition Doughnut（Top-5+Others） |
| API Key×Model | 无 | **Heatmap（唯一）** |
| Requests 趋势 | 含在 StatCards | 叠加在 Token 图第二 Y 轴 |
| 数据源 | 本地 SQLite + 旧 API | 后端预聚合统计表 |
| 失败分析 | FailureAnalysis 组件 | 无 |
| 请求日志 | RequestLogs 组件 | RequestEventsDetailsCard |
| 成本追踪 | KpiCards 含 cost | 无（有独立 CostTrendChart） |

#### 可借鉴设计模式

1. **API Key × Model 热力图**（P0）——MonitorPage 无此纬度。不需后端，前端可通过 `bucketUsageRecords()` 桶数据计算 intensity，CSS Grid 实现
2. **粒度自动切换**（P1）——MonitorPage 的 HourlyTokenChart 与 DailyTrendChart 分两个组件，可自动根据时间窗口合并/切换
3. **Requests 折线叠加**（P1）——在 HourlyTokenChart 堆叠 Token 柱状图上叠加 requests 折线（双 Y 轴）
4. **Composition Doughnut（Top-5+Others）**（P2）——API Key 和 Model 的 Doughnut 图表，比 ChannelStats 表格更直观
5. **Tab 结构重织**（P3）——MonitorPage 可考虑 tabs：overview（KPI+趋势）/ models（模型分析）/ channels（渠道分析）/ logs（请求日志）

### 新洞察

- **Analysis 页面设计**（v1.7.2）——该页面整合了 token 趋势、API Key 分布、模型分布、API Key×Model 热力图。与我们 MonitorPage 的 KPI 卡片 + 每日趋势 + 请求事件布局存在重叠。建议评估其数据纬度设计和交互模式，看是否有可借鉴的「概览→下钻」路径。
- **增量统计表架构**（v1.7.0）——从全量扫描切换到增量聚合，显著提升大数据量查询性能。与我们的 SQLite 适配层的桶聚合方向一致，只是实现层面不同（他们 Go 后端，我们依赖 CPA 后端）。
- **API Key 纬度筛选**（v1.6.2）——支持按 CPA API Key 过滤用量数据。与我们 RequestLogs 已实现的凭证下拉筛选互补。

### 决策项

- [ ] P0: 研究将凭证额度 Quota 纬度加入 MonitorPage（借鉴 v1.6.0 API 设计）
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

**定位：** 基于上游的二创 TypeScript fork，547⭐（+214），与我们在同一演进路径上。

**最近活动：** 非常活跃——v1.1.9→v1.2.2，5 天 4 个版本（2026-05-15 当日 7 个 commits），聚焦运维 Config 持久化和 Login/Setup 流程

### 功能亮点

| 功能 | 优先级 | 说明 |
|------|--------|------|
| **Monitoring 自定义时间范围** | P1 | feat: add custom time range filtering——我们的 MonitorPage 可考虑 |
| **Codex Inspection 实时更新** | P1 | fix: update codex inspection results live——我们 Codex 相关组件可借鉴 |
| **Login/Setup 流程分离** | P2 | **【已分析】** 首次设置 vs 已配置登录分流——详见下方详细设计分析 |
| **实时源详情展示** | P2 | feat: realtime source priority details——监控数据透明度提升 |
| **Monitoring 加载遮罩修复** | P2 | fix: unblock loading overlay interactions——UX 打磨 |
| **Account 显示标签优化** | P2 | fix: improve account display labels——UX 打磨 |

### 架构新增（与我们差异）

| 组件 | 说明 |
|------|------|
| `ConfigSection.tsx` + `VisualConfigEditor.tsx` | 可视化管理配置——我们目前是表单驱动 |
| `DiffModal.tsx` | 配置 diff 对比——Git 风格的变更审查 |
| `ModelMappingDiagram.tsx` | 模型映射关系图——DAG 可视化 |
| `PageTransition.tsx` + `SplashScreen.tsx` | 页面过渡动画 + 闪屏 |

### v1.2.0→v1.2.2 新变化（2026-05-16 调研）

| 版本 | 日期 | 核心内容 | 对本项目的启发 |
|------|------|---------|--------------|
| v1.2.2 | 05-15 | **实时源详情展示**（realtime-source-display）+ **Login/Setup 流程分离** + 部署 README 更新 | Login 流程分离设计思路可参考 |
| v1.2.1 | 05-14 | **API Key alias 过滤**——新增 API key alias 表，前端支持按 alias 筛选 | 与我们的 RequestLogs 凭证筛选互补 |
| v1.2.0 | 05-13 | **CPA-Manager 配置持久化**——管理页面设置持久化到 usage-service 数据库 | 我们的 config 页面可考虑增加设置持久化能力 |

### Login/Setup 详细设计分析（v1.2.2）

#### 核心设计模式

**判断层（gate）**：`loginMode.ts` 中 `resolveUsageServiceLoginMode(info)` 纯函数，基于 `GET /usage-service/info` 返回的 `service` 和 `configured` 字段分叉：

```
/usage-service/info
  ├─ service !== 'cpa-manager' → hosted=false → 标准 CPA 登录（显示 CPA URL + Key）
  └─ service === 'cpa-manager'
       ├─ configured=false → 首次设置向导（5 步）
       └─ configured=true  → 已配置登录（只需 Management Key）
```

**Setup 5 步向导**：connection → auth → monitoring → [polling] → review
- polling 步骤根据 `requestMonitoringEnabled` 动态显示/隐藏
- Stepper 水平步骤指示器：序号/勾选图标 + 标签 + 活跃/完成/待办状态 + `aria-current`
- 每步前进前执行 `validateUsageSetupStep()` 校验
- 最后一步（review）展示所有设置的阅读确认摘要，点击 Submit 调用 `usageServiceApi.setup()` 持久化到 SQLite

**已配置登录**：显示连接信息和 Usage Service 配置提示，用户只需输入 Management Key + 可选自定义 CPA URL

**CPA URL fallback 链**：`resolveDefaultCPAConnectionBase()`：
1. `VITE_DEFAULT_CPA_BASE_URL` 环境变量
2. Usage Service 托管 → `http://host.docker.internal:8317`
3. 当前浏览器地址

**错误分类**：`getLocalizedErrorMessage` 处理 14+ 错误类型，包括 18 种 Usage Service 特有错误码

**关键文件**：
- `src/pages/LoginPage.tsx`（729 行，单文件）
- `src/pages/loginMode.ts`（分流逻辑，6 行纯函数）
- `src/pages/Login/Login.module.scss`（Stepper 样式）
- `src/services/api/usageService.ts`（Usage Service API 客户端）
- `src/utils/connection.ts`（CPA URL 解析）

#### 与我们的 LoginPage 对比

| 维度 | CPA-Manager v1.2.2 | 我们的 LoginPage |
|------|-------------------|-----------------|
| 行数 | ~729 行 | ~305 行 |
| Usage Service 集成 | 深度集成（检测/设置/持久化） | 无此概念 |
| 设置向导 | 5 步 Stepper 向导 + review 确认 | 无 |
| 自动登录 | `restoreSession()` + splash 加载条动画 | 同 |
| 错误处理 | 14+ 类型 + 18 个 Usage Service 码 | 基本 HTTP 码 |
| 步骤上下文 | "Step X of N" 微提示 | 无 |

#### 可借鉴的 UX 改进（按优先级）

| 优先级 | 改进项 | 说明 |
|--------|--------|------|
| P1 | **Usage Service 自动检测** | GET /usage-service/info 判断服务模式，自动适配流程——我们目前 LoginPage 只有一种流程 |
| P1 | **Stepper 步骤指示器** | 多步设置场景的水平已完成/当前/待办 step 组件 |
| P2 | **错误分类增强** | 增加 SSL/CORS/超时/网络错误、Usage Service 错误码分类 |
| P2 | **回顾确认页** | 提交关键配置前摘要确认，降低误配置风险 |
| P2 | **设置持久化接口** | 通过 /setup POST 将配置持久化到服务端 |
| P3 | **步骤级上下文计数** | "Step X of N" 微提示提升位置感知 |
| P3 | **Splash 动画打磨** | 自动登录时加载条动画而非瞬间跳转 |

### 其他新洞察

- **实时源详情展示**（v1.2.2）——监控页展示实时数据源优先级详情，提升监控数据透明度和可调试性。
- **API Key alias 过滤**（v1.2.1）——匹配我们已实现的 authIndex 凭证筛选器，不同点在于他们从后端 API 获取 alias 映射，我们是前端计算。

### 决策项

- [x] P1: MonitorPage 自定义时间范围过滤——已接入 TimeRangeSelector (2026-05-11)
- [x] P1: Codex Inspection 实时更新——已实现，CodexSection 检测按钮 + EditPage 测试连接
- [x] P2: ModelMappingDiagram 方向——已实现 (ModelMappingDiagram.tsx + 4 子模块)
- [x] P3: PageTransition 动画——已实现 (src/components/common/PageTransition.tsx)
- [ ] 注意：该仓库文件结构与上游高度同源，融合需注意合并冲突

---

## 5. diegosouzapw/OmniRoute

**定位：** 免费 AI 网关——统一端点，160+ Provider，13 种路由策略，Token 压缩（RTK+Caveman）。**非 CPA 项目，而是独立的 AI 网关层。**

**规模：** 4622⭐（+324），766 forks（+57），npm 包 + Docker + Electron 桌面应用 + PWA

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

### v3.7.7→v3.7.9 新变化（2026-05-16 调研）

| 版本 | 日期 | 核心内容 |
|------|------|---------|
| v3.7.9 | 05-06 | **多页文档集成到 Dashboard**、请求体限制设置、Gemini CLI OAuth 客户端密钥、模型 context window 暴露、**Caveman+RTK 压缩管道重大升级** |
| v3.7.8 | 05-02 | Grok 4.3 和小米 Mimo TTS 提供者、**Rate Limit Watchdog**（可检测并重置卡死队列）、1proxy 免费代理市场集成 |

**对本项目启发有限**——OmniRoute 定位是独立 AI 网关，与我们的管理面板场景不同。可关注点：
- **Caveman+RTK 压缩升级**——如果 CPA 后端未来支持压缩指标，需考虑适配
- **Rate Limit Watchdog**——我们的监控页可考虑增加类似的速率限制状态指示

### 决策项

- [x] P1: 研究 Provider 健康检查机制——已实现 (useProviderInspect)，全体 6 Provider 统一接入
- [ ] P2: Smart Auto-Fallback 链可视化——等 CPA 后端支持后再做
- [ ] P3: Token 压缩指标监控——等 CPA 后端支持后，usage 统计需区分原始 vs 压缩 token
- [ ] P3: 多模态用量维度——MonitorPage 未来可加 image/video/audio 类型 tab

---

## 综合决策队列（按优先级）

| # | 来源 | 功能 | 优先级 | 状态 |
|---|------|------|--------|------|
| 1 | cpa-usage-keeper | 凭证额度 Quota 追踪 | P0 | 阻塞——需后端 `/v0/management/usage-sqlite/quota` 端点 |
| 2 | cpa-usage-keeper | usage identity 解析（auth_index→可读名称） | P1 | ✅ 已实现 — RequestLogs.tsx:455 |
| 3 | CPA-Manager | MonitorPage 自定义时间范围 | P1 | ✅ 已实现 — MonitorPage 接入 TimeRangeSelector |
| 4 | CPA-Manager | Codex Inspection 实时更新 | P1 | ✅ 已覆盖——见 #12：CodexSection + useProviderInspect 已实现 Key 有效性检测，实时更新为子集 |
| 5 | cpa-usage-keeper | Token=0 异常处理（sqliteAdapter） | P2 | ✅ 已实现 — suspiciousToken 标记 |
| 6 | cpa-usage-keeper | RequestLogs 多维筛选 | P2 | ✅ 已实现 — 新增 authIndex 凭证下拉筛选器 (d20421f) |
| 7 | upstream | quotaConfigs 可选 header 同步 | P2 | ✅ 已实现 — Chatgpt-Account-Id header 改为可选 |
| 8 | OmniRoute | Provider 健康检查增强 | P2 | ✅ 已实现——全体 6 Provider 统一接入 useProviderInspect |
| 9 | CPA-Manager | ModelMappingDiagram 可视化 | P3 | ✅ 已实现 — ModelMappingDiagram.tsx + 4 子模块 (columns/modals/contextMenu/types) |
| 10 | cpa-usage-keeper | SQLite 备份 + 保留策略 | P3 | 待评估 |
| 11 | 内部 | OAuth 401 泛化到所有 OAuth provider | P2 | ✅ 已实现 — isOAuthFile in validators.ts, used in quotaConfigs.ts:450 |
| 12 | CPA-Manager | Codex Inspection 实时 Key 有效性检测 | P1 | ✅ 已实现——CodexSection 检测按钮 + EditPage 测试连接 |
| 13 | upstream(b25f722) | SQLite recent_buckets 桶聚合借鉴 | P1 | ✅ 已集成——bucketUsageRecords() MonitorPage:326 已调用 |
| 14 | 内部 | Provider 健康检查泛化 | P2 | ✅ 已实现——6 Provider 统一接入 useProviderInspect：Claude、Gemini、Vertex、Codex、OpenAI、Ampcode |
| 15 | cpa-usage-keeper(v1.7.2) | **API Key×Model 热力图**——Analysis 页面最独特维度，CSS Grid 实现 | P0 | ✅ 已分析——详见 2. v1.7.2 Analysis 页面深度分析 |
| 16 | cpa-usage-keeper(v1.7.2) | **粒度自动切换**——时间窗口>24h 自动 daily，<=24h 保持 hourly | P1 | ✅ 已分析——MonitorPage HourlyTokenChart/DailyTrendChart 可考虑合并+自动切换 |
| 17 | cpa-usage-keeper(v1.7.2) | **Requests 折线叠加**——Token 图第二 Y 轴叠加 requests 折线 | P1 | ✅ 已分析——可在 HourlyTokenChart 实现双 Y 轴复合图 |
| 18 | cpa-usage-keeper(v1.7.2) | **Composition Doughnut（Top-5+Others）**——API Key 和 Model 的 Doughnut 图表 | P2 | ✅ 已分析——比 ChannelStats 表格更直观，可与现有 ModelDistributionChart 统一风格 |
| 19 | cpa-usage-keeper(v1.7.2) | **Tab 结构重织**——MonitorPage 按 overview/models/channels/logs 分 tab | P3 | ✅ 已分析——降低单屏信息密度，但引入额外交互成本 |
| 20 | cpa-usage-keeper(v1.7.0) | **增量统计表架构**——避免全量扫描，按小时/天/Health 预聚合 | P2 | ✅ 已分析——与 SQLite 桶聚合方向一致，实现层面不同（Go 后端 vs 纯前端），暂不采纳 |
| 21 | CPA-Manager(v1.2.2) | **Login/Setup 流程分离**——首次设置 vs 已配置登录 | P2 | ✅ 已分析——详见 4. CPA-Manager Login/Setup 设计分析 |
| 22 | CPA-Manager(v1.2.2) | 实时源详情展示——监控页显示数据源优先级 | P2 | 待评估——监控数据透明度提升 |
| 23 | CPA-Manager(v1.2.1) | API Key alias 筛选——后端 alias 表 + 前端筛选器 | P2 | 待评估——与我们 authIndex 筛选互补 |
| 24 | CPA-Manager(v1.2.2) | **Stepper 多步设置组件**——水平步骤指示器 | P3 | 待评估——独立 UI 组件，可复用至配置引导等场景 |

---

## 更新日志

- 2026-05-11: 初始创建——5 个参考仓库首次调研
- 2026-05-11: 第 1 批实现——P1 identity 解析 + P1 自定义时间范围 + P2 Token=0 过滤
- 2026-05-11: 第 3 批实现——上游 v1.10.2 全量调研 + P2 isOAuthFile 泛化 + P2 Codex header 可选 + SQLite 桶聚合方案设计 + Codex Inspection 方案设计
- 2026-05-16: 第 2 轮全量调研——cpa-usage-keeper v1.6.2→v1.7.2 分析（Analysis 页面、增量统计架构）+ CPA-Manager v1.2.0→v1.2.2 分析（Login/Setup 分离、API Key alias 过滤）+ OmniRoute v3.7.7→v3.7.9 分析（Caveman+RTK 升级）+ 上游确认无新 commits + 新增 6 条决策项
- 2026-05-16: [文档同步] 决策 #11 isOAuthFile 确认已实现于 validators.ts，状态修正为 ✅
- 2026-05-16: CPA-Manager Login/Setup 流程分离详细设计分析——调研并记录 5 步 Stepper 向导、分流判断层、错误分类系统，新增决策 #21（Stepper 组件），更新决策 #18 状态为 ✅ 已分析
- 2026-05-16: cpa-usage-keeper v1.7.2 Analysis 页面深度分析——调研并产出 4 类图表设计模式、7 项交互特征、5 个架构亮点、与 MonitorPage 对比 11 项纬度、5 个可借鉴设计模式（P0-P3）。新增决策 #15（热力图 P0）、#16（粒度自动切换 P1）、#17（Requests 叠加 P1）、#18（Doughnut P2）、#19（Tab 结构 P3）、#20（增量表已分析暂不采纳）
- 2026-05-16: [审计] 综合决策队列全量审查——修正 #2 行号、#4 合并至 #12、#8/#14 状态更新为全 Provider 覆盖、#13 从"待集成"更新为"已集成"
