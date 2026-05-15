# Quota 凭证额度追踪 API 契约

> 日期: 2026-05-16 | 状态: 前端接口已设计，待后端实现

## 目标

在 MonitorPage 中展示每个凭证（auth file）的剩余额度、已用量、重置时间。

参考: cpa-usage-keeper v1.6.0 的 quota 追踪功能。

## API 端点

### `GET /v0/management/usage-sqlite/quota`

获取所有凭证的额度快照。

**请求参数**: 无

**响应** (200):
```json
{
  "quotas": [
    {
      "auth_index": "gemini-key-1",
      "provider": "gemini",
      "display_name": "Gemini #1",
      "quota_total": 1000000,
      "quota_used": 423000,
      "quota_remaining": 577000,
      "quota_unit": "tokens",
      "reset_time": "2026-05-16T00:00:00Z",
      "rate_limit_rpm": 1500,
      "rate_limit_tpm": 1000000,
      "last_updated": "2026-05-15T12:30:00Z"
    }
  ],
  "summary": {
    "total_credentials": 5,
    "total_quota_remaining": 12345678,
    "credentials_near_exhaustion": 1
  }
}
```

**错误响应** (500):
```json
{
  "error": "Failed to query quota data",
  "detail": "SQLite connection timeout"
}
```

### 数据结构

```typescript
interface QuotaEntry {
  auth_index: string;
  provider: string;
  display_name: string;
  quota_total: number | null;       // null = 无限制
  quota_used: number;
  quota_remaining: number | null;   // null = 无限制
  quota_unit: 'tokens' | 'requests' | 'credits';
  reset_time: string | null;        // RFC3339, null = 无重置周期
  rate_limit_rpm: number | null;
  rate_limit_tpm: number | null;
  last_updated: string;             // RFC3339
}

interface QuotaResponse {
  quotas: QuotaEntry[];
  summary: {
    total_credentials: number;
    total_quota_remaining: number | null;
    credentials_near_exhaustion: number;
  };
}
```

## 前端接入点

- `src/services/api/usageSqlite.ts` — 新增 `getQuota()` 方法
- `src/hooks/useSqliteUsage.ts` — 新增 quota 轮询逻辑
- `src/components/monitor/KpiCards.tsx` — 新增 Quota 卡片（加在现有 KPI 行下方）
- `src/i18n/locales/*.json` — 新增 `monitor.quota_*` 键

## 实现优先级

1. 后端实现 API 端点
2. 前端接入 `getQuota()` 并验证数据结构
3. MonitorPage 添加 Quota 摘要卡片
4. 可选：按凭证的详细额度表格
