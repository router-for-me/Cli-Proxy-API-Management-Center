# 参考仓库版本追踪

> 基准时间: 2026-05-16 | 更新频率: 每次会话检查

## 追踪仓库

| 仓库 | 本地路径 | 分支 | 最新提交 | 日期 |
|------|---------|------|---------|------|
| cockpit-tools | cockpit-tools | main | `922bc94` merge (v0.23.4) | 2026-05-15 |
| Kiro-account-manager | Kiro-account-manager | main | `0aa9a28` v1.6.5 | 2026-05-15 |
| codex2api | codex2api | main | `18de86a` fix import file size limit to 20mb | 2026-05-15 |
| sub2api | sub2api | main | `18790386` fix(deploy): 移除端口映射 | 2026-05-12 |
| CLIProxyAPI (fork) | CLIProxyAPI | fork/fix/claude-oauth-api-call | `722b82b1` fix(api-call): delete Authorization when injecting x-api-key | 2026-05-13 |
| CPA-Dashboard (上游) | CPA-Dashboard-kelen | upstream/main | — | — |

## 检查命令

```bash
for d in cockpit-tools Kiro-account-manager codex2api sub2api CLIProxyAPI; do
  echo "=== $d ==="
  cd "/Users/kelen/Software/github-star/$d"
  git fetch origin 2>/dev/null
  echo "branch: $(git rev-parse --abbrev-ref HEAD)"
  echo "HEAD: $(git log --oneline -1)"
  echo "date: $(git log -1 --format=%ci)"
  echo "behind: $(git rev-list --count HEAD..origin/$(git rev-parse --abbrev-ref HEAD) 2>/dev/null || echo '?')"
done
```

## 变更日志

### 2026-05-16
- 文档完整性审计完成：CLAUDE.md、reference-repos-tracking.md、independence-assessment.md 等 15 个文档日期/版本/内容更新
- 基准时间更新至 2026-05-16

### 2026-05-15
- cockpit-tools: v0.23.4 remote advance (922bc94, 5 ahead), Kiro-account-manager: v1.6.3→v1.6.5 (0aa9a28, AmazonQ CLI endpoint 变更)
- codex2api: 4922b64→18de86a (fix import file size limit to 20mb), sub2api: 无变更
- CLIProxyAPI: 分支从 origin/fix/claude-oauth-api-call 迁移至 fork/fix/claude-oauth-api-call, 代码无变更
- CPA-Dashboard: TypeScript 编译修复 (quotaConfigs.ts React 导入), 代码质量审计完成
- 参考检查脚本验证：全部 5 个仓库本地与远程一致，0 behind
- 深度调研完成：cockpit-tools v0.23.4 — 13 平台 OAuth 架构分析（Anthropic 服务授权、Google OAuth 等 11 内置 + 2 扩展），三层 Token/Account 池设计
- 深度调研完成：codex2api v2.1.5 — 版本号语义（major.feature.hotfix），token 池 / Cookie 池 / Account 池三层架构
- 深度调研完成：sub2api v0.1.126 — OIDC 通用登录架构，GitHub/Google/Microsoft 认证流程
- 深度调研完成：Kiro-account-manager v1.6.5 — 本地代理架构，AmazonQ CLI 端点变更（AI_EDITOR）
- CLIProxyAPI PR #3345 结案：上游已选择 Home Control Center 路线，PR 存档不再推送

### 2026-05-14
- cockpit-tools: v0.23.3 (158acf0, homebrew cask 更新), Kiro-account-manager: v1.6.2→v1.6.3 (f08ea9c, Claude Code 兼容性增强), codex2api: 44 commits since 71d0ee5 (4922b64), CLIProxyAPI: PR #3345 fix (722b82b1)
- sub2api: 无变更

### 2026-05-13
- cockpit-tools: v0.23.2 发布 (+7 commits)，codex2api: 账号池优化 + 用量面板 (+10 commits)
- CPA-Dashboard: session affinity 路由设置 cherry-pick 完成

### 2026-05-12
- 初始克隆 4 个参考仓库
- OAuth 架构深度分析完成 (cockpit-tools 11 平台, codex2api token 池, sub2api OIDC 通用登录, Kiro 本地代理)
- 9 个新目标平台 OAuth 可行性评估完成
- 多平台 OAuth 中转规划文档生成 (`oauth-multi-platform-relay-plan.md`)
