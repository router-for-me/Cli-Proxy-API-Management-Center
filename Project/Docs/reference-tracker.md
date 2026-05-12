# 参考仓库版本追踪

> 基准时间: 2026-05-12 | 更新频率: 每次会话检查

## 追踪仓库

| 仓库 | 本地路径 | 分支 | 最新提交 | 日期 |
|------|---------|------|---------|------|
| cockpit-tools | cockpit-tools | main | `a170b22` docs: announce v0.23.0 withdrawal | 2026-05-12 |
| Kiro-account-manager | Kiro-account-manager | main | `76824f9` v1.6.1 | 2026-05-12 |
| codex2api | codex2api | main | `850af48` fix(deploy): route by first deployment state | 2026-05-11 |
| sub2api | sub2api | main | `18790386` fix(deploy): 移除数据库与 Redis 宿主机端口映射 | 2026-05-12 |
| CLIProxyAPI (上游) | CLIProxyAPI | fix/claude-oauth-api-call | `0219181a` fix: add Claude OAuth token refresh | 2026-05-12 |
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

### 2026-05-12
- 初始克隆 4 个参考仓库
- OAuth 架构深度分析完成 (cockpit-tools 11 平台, codex2api token 池, sub2api OIDC 通用登录, Kiro 本地代理)
- 9 个新目标平台 OAuth 可行性评估完成
- 多平台 OAuth 中转规划文档生成 (`oauth-multi-platform-relay-plan.md`)
