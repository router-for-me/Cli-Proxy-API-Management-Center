---
description: CLIProxyAPI 上游仓库兼容性追踪——API 端点、版本变化、对接状态
version: 1.0.0
lastUpdated: 2026-05-16
---

# CLIProxyAPI 上游追踪 / Upstream Compatibility Tracking

> CLI Proxy API 后端仓库（Go），本项目为其 Web 管理面板前端。
> 本地路径：`/Users/kelen/Software/github-star/CLIProxyAPI`
> GitHub：https://github.com/router-for-me/CLIProxyAPI

## 技术概览

- **语言**: Go 1.26 + Gin Web 框架
- **存储**: PostgreSQL (pgx/v5) + Redis (go-redis) + MinIO + Git
- **认证**: OAuth (Google/Codex/Claude/Antigravity/Kimi) + API Key + Gemini API Key
- **部署**: Docker，端口 8317

## 关键 Management API 端点（我们前端对接的）

| 类别 | 端点 | 对接状态 |
|------|------|---------|
| SQLite 使用量 | `GET /usage-sqlite/stats` | ✅ 已对接 |
| SQLite 使用量 | `GET /usage-sqlite/records` | ✅ 已对接 |
| SQLite 使用量 | `GET /usage-sqlite/model-stats` | ✅ 已对接 |
| SQLite 使用量 | `GET /usage-sqlite/daily-stats` | ✅ 已对接 |
| SQLite 使用量 | `GET /usage-sqlite/enabled` | ✅ 已对接 |
| 传统使用量 | `GET /usage` | ✅ 已对接（fallback） |
| OAuth | `GET /{provider}-auth-url` | ⬜ 间接使用 |
| Provider 管理 | `GET/PUT/PATCH/DELETE /{provider}-api-key` | ✅ 已对接 |
| 代理请求 | `POST /api-call` | ✅ 已对接（Quota 走此通道） |
| 配置 | `GET/PUT /config` | ✅ 已对接 |
| 配额回退 | `PUT /quota-exceeded/*` | ⬜ 未对接 |

## 待关注

- [x] 确认上游 SQLite 持久化版本要求 — 已验证 `/usage-sqlite/*` 端点正常可用（2026-05-15）
- [x] `POST /api-call` Claude OAuth token 自动刷新 — PR #3345 实现但被上游拒绝。上游选择 Home Center 方案，此路径不再适用。详见 `Project/Docs/guides/cliproxyapi-pr3345-status.md`
- [ ] 配额回退端点 `PUT /quota-exceeded/*` — 低优先级，未集成
- [ ] 路由策略端点 `GET/PUT /routing/strategy` — 低优先级，未集成
- [ ] Home 控制面（Redis 协议）— 上游新方向，暂不跟进

## 更新日志

- 2026-05-16: 文档审计——更新 lastUpdated
- 2026-05-15: PR #3345 方案被上游拒绝（api_tools.go 已删除相关代码）。SQLite 端点验证通过。Home 控制面为上游新方向，暂不跟进。
- 2026-05-11: 初始调研——Go 后端结构、API 端点清单、前端对接状态
