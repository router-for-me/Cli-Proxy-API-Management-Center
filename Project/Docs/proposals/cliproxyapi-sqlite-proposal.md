---
description: CLIProxyAPI SQLite 使用量持久化提案 — 提交给 CLIProxyAPI 项目维护者的后端改动方案，含完整改动清单与架构设计
version: 1.0.0
lastUpdated: 2026-05-16
---

# CLIProxyAPI SQLite 使用量持久化提案

> 本文档供 CLIProxyAPI 项目维护者参考。CPA Dashboard 团队不直接修改目标项目，
> 仅提供技术方案与改动清单，由目标方自行评估与实施。

## 动机

CLIProxyAPI 当前无数据持久化——使用记录仅存于内存队列，重启即丢失。
CPA Dashboard 作为管理面板需要持久化数据以提供历史统计、趋势分析与长期监控。

## 方案概述

在 CLIProxyAPI 中新增 `internal/sqliteusage/` 包，通过现有的 `usage.Plugin` 接口
（`sdk/cliproxy/usage`）自注册为插件，以**零侵入**方式将所有使用事件写入本地 SQLite。

### 架构原则

- **零侵入**：不修改任何现有请求处理路径或业务逻辑
- **自注册**：通过 `init()` 函数自动注册，仅当包被导入时生效
- **惰性启用**：注册后默认不工作，需在 `config.yaml` 中显式启用
- **纯 Go**：使用 `modernc.org/sqlite`（无 CGO），跨平台编译无忧

## 文件清单

### 新增文件

#### `internal/sqliteusage/store.go`
SQLite 数据库核心操作：建表、插入、查询。含 `Stats`、`ModelStat`、`DailyStat` 查询类型。

```go
package sqliteusage

// 全局单例 DB，读写锁保护
var (
    globalDB   *sql.DB
    dbMu       sync.RWMutex
    enabled    atomic.Bool
    initialized atomic.Bool
)

// Init(path) — 打开/创建数据库，执行 schema 迁移
// Close() — 安全关闭数据库
// Insert(UsageRecord) — 写入记录
// QueryResult / QueryRow — 通用查询接口
```

**Schema：** 单表 `usage_records`（20 个字段），含 6 个索引（timestamp/provider/model/api_key/failed/source）

#### `internal/sqliteusage/plugin.go`
实现 `usage.Plugin` 接口，通过 `init()` 自注册：

```go
func init() {
    coreusage.RegisterPlugin(&sqlitePlugin{})
}

func (p *sqlitePlugin) HandleUsage(ctx context.Context, record coreusage.Record) {
    if !IsEnabled() { return }
    // 将 coreusage.Record 展平为 UsageRecord，调用 Insert
}
```

#### `internal/api/handlers/management/usage_sqlite.go`
5 个管理 API 端点（依赖 `internal/sqliteusage` 包的查询函数）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/v0/management/usage-sqlite/stats?since=` | 聚合统计（请求数/Token/延迟） |
| GET | `/v0/management/usage-sqlite/records?since=&provider=&model=&api_key=&status=&limit=&offset=` | 分页查询记录 |
| GET | `/v0/management/usage-sqlite/model-stats?since=` | 按模型统计 |
| GET | `/v0/management/usage-sqlite/daily-stats?since=` | 按日统计 |
| GET | `/v0/management/usage-sqlite/enabled` | 检查是否启用 |

### 修改文件

#### `internal/config/config.go`
在 `Config` 结构体末尾新增字段：

```go
SQLiteUsage SQLiteUsageConfig `yaml:"sqlite-usage" json:"sqlite-usage"`
```

新增子结构体：

```go
type SQLiteUsageConfig struct {
    Enabled bool   `yaml:"enabled" json:"enabled"`
    Path    string `yaml:"path" json:"path"`
}
```

#### `internal/api/server.go`
4 处增量修改：

1. **import 新增** `"github.com/router-for-me/CLIProxyAPI/v7/internal/sqliteusage"`
2. **NewServer 启动初始化**（~290 行附近）：
   ```go
   if cfg.SQLiteUsage.Enabled {
       if err := sqliteusage.Init(cfg.SQLiteUsage.Path); err != nil {
           log.Errorf("sqlite usage init failed: %v", err)
       }
   }
   ```
3. **registerManagementRoutes 新增 5 条路由**（~591 行附近）
4. **Stop + UpdateClients 新增生命周期管理**

#### `go.mod`
新增依赖：

```
modernc.org/sqlite v1.50.0
```

## config.yaml 配置示例

```yaml
sqlite-usage:
  enabled: true
  path: "/root/.cli-proxy-api/usage.db"  # 默认 ~/.cli-proxy-api/usage.db
```

## API 响应格式

### GET /v0/management/usage-sqlite/stats

```json
{
  "total_requests": 1523,
  "success_count": 1487,
  "failed_count": 36,
  "total_tokens": 2456789,
  "input_tokens": 1234567,
  "output_tokens": 1222222,
  "reasoning_tokens": 0,
  "cached_tokens": 50000,
  "avg_latency_ms": 1234.5
}
```

### GET /v0/management/usage-sqlite/records

```json
{
  "records": [
    {
      "timestamp": "2026-05-10T06:30:00Z",
      "latency_ms": 1234,
      "source": "...",
      "auth_index": "...",
      "auth_type": "gemini",
      "api_key": "sk-...",
      "provider": "Gemini",
      "model": "gemini-2.5-pro",
      "alias": "g-2.5-p",
      "endpoint": "/v1/chat/completions",
      "input_tokens": 100,
      "output_tokens": 200,
      "reasoning_tokens": 0,
      "cached_tokens": 0,
      "total_tokens": 300,
      "failed": false,
      "fail_status_code": 200,
      "fail_body": "",
      "request_id": "req-xxx"
    }
  ],
  "total": 1523,
  "limit": 100,
  "offset": 0
}
```

## 安全与性能说明

- SQLite 数据库以 WAL 模式运行，支持并发读
- `SetMaxOpenConns(1)` 限制写并发，避免 SQLITE_BUSY
- DB 文件权限继承进程 umask
- 数据不外泄——仅存储于本地文件系统
- 索引覆盖高频查询字段（timestamp/provider/model/api_key）

## License

本提案与改动均沿用 CLIProxyAPI 的 MIT 协议。
