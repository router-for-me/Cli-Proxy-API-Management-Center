# OAuth 多平台登录中转支持 — 研究与规划

> 创建时间: 2026-05-12 | 状态: 研究中

## 目标

在 CLIProxyAPI + CPA-Dashboard 中新增对以下平台 OAuth 登录中转的支持。

### 现有已支持 (5)
- Codex (OpenAI OAuth) ✅
- Anthropic (Claude OAuth) ✅
- Antigravity ✅
- Gemini CLI ✅
- Kimi ✅

### 新增目标 (9)
| 平台 | 难度 | Auth 方式 | OAuth 流程 |
|------|------|-----------|-----------|
| GitHub Copilot | 容易 | GitHub Device Code | device.code → polling → access_token → copilot token |
| Zed | 容易 | GitHub OAuth + API Key | 开源(z兴-industries/zed)，标准 GitHub SSO |
| Windsurf/Codeium | 中等 | 自定义 Device Code | api.codeium.com device_code → token |
| Kiro (AWS) | 中等 | AWS Builder ID Device Flow | id.aki.amazon.com device_authorization → token |
| Cursor | 中等 | GitHub OAuth via relay | authenticator.cursor.sh relay → GitHub device flow |
| Trae (ByteDance) | 中等 | GitHub/Google SSO | api.marscode.com ExchangeToken + GetUserInfo |
| CodeBuddy | 困难 | Tencent/WeChat | 腾讯云 OAuth，需逆向 |
| CodeBuddy CN | 困难 | 同上(国内版) | 同上 |
| Qoder | 困难/未知 | 未知 | 信息不足 |

## 参考仓库分析

### 1. cockpit-tools (最完整参考)
- **语言**: Rust (Tauri + Actix)
- **支持平台**: GitHub Copilot, Codex, Cursor, Kiro, Windsurf, Trae, Zed, Qoder, CodeBuddy, CodeBuddy CN, WorkBuddy (全部 11+)
- **架构**: 每个平台独立 `*_oauth.rs` 模块，共享 OAuth server + token keeper
- **统一模式**: `start_login()` → `complete_login()` → `cancel_login()`
- **Token 存储**: JSON 文件 `~/.antigravity_cockpit/accounts/`
- **后台刷新**: `provider_token_keeper.rs` 每 60s 遍历所有 provider

### 2. codex2api
- **语言**: Go (Gin)
- **支持平台**: OpenAI (Codex) OAuth only
- **亮点**: 账号池健康评分、优先级队列刷新调度、混合凭证模型(RT/session token/API key)、Resin 反向代理集成
- **Token 存储**: PostgreSQL/SQLite + Redis 缓存

### 3. sub2api
- **语言**: Go (Gin + Ent)
- **支持平台**: GitHub, Google, Generic OIDC (用户登录) + Claude OAuth (上游)
- **亮点**: 多租户 API 网关、通用 OIDC + PKCE + JWK 校验、按 token 计费
- **Token 存储**: PostgreSQL + Redis

### 4. Kiro-account-manager
- **语言**: Electron + React + TypeScript
- **支持平台**: Kiro (AWS Builder ID + Google + GitHub + IAM SSO)
- **亮点**: 自动化账号注册(邮件生成+AWS SSO注册)、device ID 随机化、本地反向代理、多协议转换(OpenAI/Claude/Gemini ↔ Kiro 原生 API)

## 架构方案

### CLIProxyAPI 后端 (Go)
```
internal/auth/oauth/
├── copilot/       # GitHub Copilot device code flow
├── windsurf/      # Codeium device code flow
├── kiro/          # AWS Builder ID device flow
├── cursor/        # Cursor relay + GitHub device flow
├── trae/          # ByteDance SSO
├── zed/           # GitHub OAuth
├── codebuddy/     # Tencent OAuth (待逆向)
└── qoder/         # Qoder (待调研)
```

每个模块实现统一接口：
```go
type OAuthProvider interface {
    StartAuth(ctx context.Context) (*DeviceAuthResponse, error)
    PollToken(ctx context.Context, deviceCode string) (*TokenResponse, error)
    RefreshToken(ctx context.Context, refreshToken string) (*TokenResponse, error)
    GetUserInfo(ctx context.Context, accessToken string) (*UserInfo, error)
}
```

### CPA-Dashboard 前端 (React)
- 新增 OAuth provider 类型定义 (`src/types/oauth.ts`)
- 新增 OAuth 页面卡片组件 (复用现有 OAuthPage 模式)
- 新增 i18n keys (en + zh-CN)
- 新增 provider icons

## 实施路线

### Phase 1: 容易平台 (当前)
- [ ] GitHub Copilot — 标准 GitHub device code，copilot token 交换
- [ ] Zed — GitHub OAuth，开源代码可参考

### Phase 2: 中等平台
- [ ] Windsurf/Codeium — device code flow，从 cockpit-tools 移植
- [ ] Kiro — AWS Builder ID device flow
- [ ] Cursor — GitHub device flow via Cursor relay
- [ ] Trae — ByteDance SSO

### Phase 3: 困难平台
- [ ] CodeBuddy / CodeBuddy CN — 需逆向 Tencent OAuth
- [ ] Qoder — 需先调研

## 版本追踪

持续关注以下参考仓库的版本迭代：

| 仓库 | 本地路径 | 上游 URL |
|------|---------|----------|
| cockpit-tools | `/Users/kelen/Software/github-star/cockpit-tools` | https://github.com/jlcodes99/cockpit-tools |
| Kiro-account-manager | `/Users/kelen/Software/github-star/Kiro-account-manager` | https://github.com/chaogei/Kiro-account-manager |
| codex2api | `/Users/kelen/Software/github-star/codex2api` | https://github.com/james-6-23/codex2api |
| sub2api | `/Users/kelen/Software/github-star/sub2api` | https://github.com/Wei-Shaw/sub2api |
| CLIProxyAPI (上游) | `/Users/kelen/Software/github-star/CLIProxyAPI` | https://github.com/router-for-me/CLIProxyAPI |

## 记录

- 2026-05-12: 完成 4 个参考仓库克隆与深度分析，完成 9 个目标平台 OAuth 机制调研，生成规划文档
