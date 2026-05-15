# CPA-Dashboard 独立化评估

> 评估时间: 2026-05-16 | 状态: ~90% 就绪

## 分支状态

| 指标 | 数值 |
|------|------|
| dev 领先 upstream/main | 156 commits |
| upstream/main 未合入 dev | 60 |
| 已精选上游提交 | 14 (3212f65, c43df08, 0546f43, c27707c, 7d3c570, 808f44d, 8ed837c, b4d5ffa, 1a056ec, 9f7c471, 126f7fa, 3bb4760, eb49c0d, 74badca) |
| main 分支发散 | 0（干净） |
| dev 领先 main | 75 commits |
| 文件变更 main vs dev | 186 files, +11000/-5034 |
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
- ESLint 清理：全部 exhaustive-deps 抑制已替换 → 零错误
- CLAUDE.md 项目说明文档
- reasoning_content 字段透传支持
- 死代码清理：SplashScreen 组件移除
- 参考仓库深度调研：全部 5 个依赖仓库独立架构分析完成（cockpit-tools 13平台OAuth, codex2api v2.1.5, sub2api v0.1.126, Kiro v1.6.5）
- Xiaomi MiMo 模型接入调研完成：5 个公开模型定价确认，OpenAI-compatible 接入方案（models.ts 已配置 mimo pattern）
- CLIProxyAPI PR #3345 结案：上游路线分歧分析、两套替代方案存档

## 剩余任务

| 任务 | 工作量 | 备注 |
|------|--------|------|
| Cherry-pick 33 上游提交 | L | 分 4 批：OpenAI(15) + usage(8) + auth/layout(10) + misc(14)，已处理 14/60 (23%) |
| 合并冲突解决 | M | 预计 5-8 个冲突集群 |
| 版本号对齐 | M | 上游 v1.10.2 |
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

### 2026-05-15
- ESLint 全部错误清零 — 所有 exhaustive-deps 抑制已替换为 useCallback/useMemo 方案 (9dc28ff)
- CLAUDE.md 创建：项目说明文档初始化 (4bd8a87)
- Xiaomi MiMo 模型接入调研完成：5 个公开模型确认（mimo-v2.5-pro/2.5/2-pro/2-omni/2-flash），OpenAI-compatible API endpoint 确认，定价文档验证 (4bd8a87)
- reasoning_content 字段透传支持：API 调用详情中展示推理过程 (c5387f9)
- SplashScreen 死代码组件移除 (3226168)
- React 命名空间导入修复：quotaConfigs.ts 缺失 React 导入 (cfb431c)
- i18n 清理：移除 11 个死 iflow_oauth_* 翻译键 (d8af8b7)
- OAuth UI 增强：8 个 OAuth provider 添加品牌 SVG 图标 (faccb5a)
- Cherry-pick: upstream 74badca — iflow cookie 登录清除 (7fd6022)
- 参考仓库更新：cockpit-tools v0.23.4、Kiro v1.6.5、codex2api fix import size limit、CLIProxyAPI PR #3345 最新 (722b82b1)
- 模型预设定价表扩展：新增 o3, o4-mini, claude-3-* (opus/sonnet/haiku), gemini-1.5-* (pro/flash)
- 参考仓库深度调研完成：全部 5 个仓库独立架构分析（cockpit-tools 13平台OAuth, codex2api v2.1.5, sub2api v0.1.126, Kiro v1.6.5）
- CLIProxyAPI PR #3345 结案记录：上游已选择 Home Control Center 路线，PR 存档不再推送，两套替代方案文档化
- WorkBuddy 添加：OAuthProvider 类型 + OAUTH_CARD_IDS/OAUTH_PROVIDERS 常量同步至完整 15 providers
- i18n 键修复：SystemPage GitHub 链接从无效仓库纠正为 fork 地址 (calonye/Cli-Proxy-API-Management-Center-fork)
- 独立化就绪度：75% → ~78%
- Cherry-pick 总进度: 14/47 (30%)

### 2026-05-16
- 文档完整性审计完成：CLAUDE.md 版本号修正（React 18→19, Vite 5→7, zustand 4→5）、i18n 语言环境数修正（2→4）、hooks/ 目录补充
- 独立化就绪度：78% → ~80%
- 已更正失效的 isOAuthFile 实现标记
- [文档同步] 最终状态审计：CLAUDE.md 所有版本号和计数器精确匹配（React 19/Vite 7/zustand 5/11 stores/12 hooks/17 services/4 locales 各 37 keys）
- [分支修正] dev 领先 main 42→75 commits，文件变更 105→186 files/+11000/-5034，dev 领先 upstream/main 153→156 commits
- [版本修正] 版本号 1.7.36-fork.1 → 1.7.36（与 package.json 对齐）
- [决策核查] reference-repos-tracking.md 决策 #11（isOAuthFile）确认已实现于 validators.ts，状态修正为 ✅
- [稳定化] 3 轮鲁棒性修复：Void Promise .catch() handlers ×8、key={index} 替换、JSON.parse 守卫、timer/DOM 泄漏修复、store 解耦、Record<string, unknown> 类型增强
- [i18n 完成] zh-TW locale 补齐 monitor 和 backup 键，4 语种均命中等效 37 top-level keys
- [独立化] upstream/main 当前为 v1.10.2，持续跟踪
- 独立化就绪度：~80% → ~90%
- Cherry-pick 总进度: 14/60 (23%)

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
