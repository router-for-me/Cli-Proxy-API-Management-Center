---
description: CLIProxyAPI 对接路线与架构决策：持久化/可视化/监控/费用预估
version: 1.0.0
lastUpdated: 2026-05-16
---

## CLIProxyAPI 对接计划

**目标:** CPA Dashboard（本项目）对接 CLIProxyAPI Go 后端，实现完整的使用量管理闭环。

**Why:** CLIProxyAPI 后端无内置数据持久化（重启丢失），本项目作为 Web 管理面板需提供持久化 + 可视化 + 监控能力。

**How to apply:**
- 功能优先：先打通持久化+可视化全链路，再修 BUG
- **解耦原则（强制）**：本项目仅通过 REST API 与 CLIProxyAPI 通信，**绝不直接修改目标项目文件**
- CLIProxyAPI 需要的后端改动整理为提案文档 `Project/Docs/proposals/cliproxyapi-sqlite-proposal.md`，提交给目标方自行评估
- 后端 Management API 在 `/v0/management`

对接进度见 `Project/STATUS.md`（阶段四）。

### 前端 SQLite 适配层（已实现，在本项目内）

- `src/services/api/usageSqlite.ts` — 类型化 API 客户端（5 个端点）
- `src/hooks/useSqliteUsage.ts` — React Hook，自动轮询 + 降级
- `src/utils/sqliteAdapter.ts` — UsageRecord[] → UsageData 格式转换
- MonitorPage + RequestLogs — 双通道自动切换（SQLite 优先，旧 API fallback）

### 架构决策

- **零侵入原则**：不修改 CLIProxyAPI 任何文件，后端改动通过提案文档提交
- **前端解耦**：数据格式通过 `sqliteAdapter.ts` 转换，子组件无感切换
- **双通道降级**：SQLite 不可用时自动回退到旧 `/usage` API，用户无感知
