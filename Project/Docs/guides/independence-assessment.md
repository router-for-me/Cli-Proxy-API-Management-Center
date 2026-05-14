# CPA-Dashboard 独立化评估

> 评估时间: 2026-05-13 | 状态: 67% 就绪

## 分支状态

| 指标 | 数值 |
|------|------|
| dev 领先 upstream/main | 119 commits |
| upstream/main 未合入 dev | 60 |
| 已精选上游提交 | 13 (3212f65, c43df08, 0546f43, c27707c, 7d3c570, 808f44d, 8ed837c, b4d5ffa, 1a056ec, 9f7c471, 126f7fa, 3bb4760, eb49c0d) |
| main 分支发散 | 0（干净） |
| dev 领先 main | 31 commits |
| 文件变更 main vs dev | 91 files, +5600/-4500 |
| 上游最新 tag | v1.10.2 |
| 当前版本 | 1.7.36 |

## 上游待精选（按类别）

| 类别 | 数量 | 状态 |
|------|------|------|
| OpenAI provider (排序/筛选/切换/卡片 UI) | ~15 | 未处理 |
| Token breakdown / usage 重构 | ~8 | 未处理 |
| Auth files (禁用筛选/删除确认) | ~4 | 部分完成 |
| Layout/styles (box-shadow/blur/sidebar) | ~6 | 部分完成 |
| i18n zh-TW locale + mapping | ~3 | 不支持，跳过 |
| Config/settings (session affinity/配额) | ~2 | 部分完成 |
| Quota (Claude Team/thinking intensity) | ~2 | 未处理 |
| 各种修复 (timestamp/card/opacity) | ~7 | 部分完成 |

## 我方独有功能

- OAuth 增强：9 个新 provider 类型、Claude token refresh
- Monitor 增强：E5/E6/E7 错误状态、KpiCards O(1) 桶聚合、费用预估卡、凭证筛选、suspiciousToken
- Phase 4 UI 一致化：SCSS 变量迁移、样式解耦、模型预设定价表
- webdavBackup 重构：41 处行内样式 → SCSS module
- SQLite 适配器：双通道 MonitorPage
- Codex Inspection：实时 key 检测
- 身份独立：commit b26de4c 已建立独立仓库标识
- ESLint 清理：全部 exhaustive-deps 抑制已替换

## 剩余任务

| 任务 | 工作量 | 备注 |
|------|--------|------|
| Cherry-pick 47 上游提交 | L | 分 4 批：OpenAI(15) + usage(8) + auth/layout(10) + misc(14) |
| 合并冲突解决 | M | 预计 5-8 个冲突集群 |
| 版本号对齐 | S | 上游 v1.10.2 |
| README/docs 独立化 | M | 移除 fork 声明 |
| 全流程测试 | M | OAuth、monitor、backup、SQLite 均需验证 |
| 移除 upstream remote（可选） | S | 独立决策后执行 |

## 建议方案

**保持 fork 结构 + 独立 main**：
1. 分批 cherry-pick 上游（本周 1-2 批，下周 3-4 批）
2. 全部 47 提交完成后，最终验证
3. dev → main merge
4. 暂不完全断联上游（上游仍在活跃开发 v1.10.2+）

**预计总工作量：L（1-2 天专注冲突解决和测试）**

## 进展记录

### 2026-05-14
- OAuth 多平台前端准备完成：Phase 1 前端部分收尾
  - 新增 9 个 OAuth provider 卡片到 OAuthPage (d9f6cb7)
  - SCSS @use 变量导入修复 5 个模块 (4208519)
- 参考仓库追踪更新：cockpit-tools v0.23.3、Kiro v1.6.3、codex2api 44 commits、CLIProxyAPI PR #3345

### 2026-05-13
- 精选 3 个上游提交：session affinity (3212f65)、Claude Team (c43df08)、antigravity credits (0546f43)
- OAuth 多平台：新增 9 个 provider i18n keys (99/locale)，OAuthProvider 类型去重统一到 @/types/oauth
- 参考仓库追踪：cockpit-tools v0.23.2、codex2api 10 commits 已同步
- 代码质量：reset.scss body 块合并
- 上游精选总进度：13/47 (28%)
- 剩余可安全精选的提交已近枯竭（layout.scss/LogsPage.module.scss 均为重写文件，冲突严重）
