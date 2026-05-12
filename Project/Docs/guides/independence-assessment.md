# CPA-Dashboard 独立化评估

> 评估时间: 2026-05-12 | 状态: 60% 就绪

## 分支状态

| 指标 | 数值 |
|------|------|
| dev 领先 upstream/main | 108 commits |
| upstream/main 未合入 dev | 60 (47 有意义，13 CI/merge/deps) |
| main 分支发散 | 0（干净） |
| dev 领先 main | 27 commits |
| 文件变更 main vs dev | 87 files, +2190/-1269 |
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
