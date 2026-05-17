# CPA-Dashboard-kelen

CLI Proxy API 管理中心的独立 fork 前端项目。React 19 + TypeScript 5.9 + Vite 7，SCSS modules + CSS custom properties 主题系统，react-i18next 国际化，zustand 状态管理，react-router-dom Hash 路由。

## 项目结构

```
src/
├── App.tsx              # 根组件：Hash 路由 /login → ProtectedRoute → MainLayout
├── pages/               # 页面级组件（路由层）
├── components/
│   ├── ui/              # 通用 UI 组件 (Button, Card, Input, Select, Modal, ToggleSwitch...)
│   ├── layout/          # MainLayout, Sidebar, Header
│   ├── common/          # ConfirmationModal, ErrorBoundary, NotificationContainer, PageTransition, SecondaryScreenShell
│   ├── quota/           # Quota 展示（quotaConfigs.ts 为核心渲染逻辑）
│   ├── usage/           # Usage 统计（TokenBreakdownChart, StatCards, RequestEventsDetailsCard）
│   ├── monitor/         # 监控面板（KpiCards, DailyTrendChart, HourlyTokenChart）
│   ├── config/          # 配置编辑器相关
│   ├── providers/       # AI Provider 编辑器
│   └── modelAlias/      # 模型别名编辑器
├── features/
│   ├── authFiles/        # Auth Files 功能模块（常量、表格渲染）
│   └── webdavBackup/     # WebDAV 备份（store + hooks + 组件 + .scss 模块）
├── services/api/        # API 客户端层（axios, 17 个服务模块）
├── stores/              # zustand 全局状态（12 个 store）
├── stores/index.ts      # store 统一导出
├── test/                # 测试（setup.ts, utils.tsx，vitest + @testing-library）
├── hooks/               # 自定义 Hook（13 个：useApi, useDebounce, useSqliteUsage, useLocalStorage, ...）
├── utils/               # 纯函数工具
│   ├── usage.ts         # 核心：usage 数据解析（UsageDetail, collectUsageDetails, TokenBreakdown）
│   ├── format.ts        # 格式化（数字、日期、API key 脱敏）
│   ├── timestamp.ts     # RFC3339 高精度时间戳标准化
│   ├── sourceResolver.ts # usage source → 显示名/类型映射
│   ├── download.ts      # Blob 下载
│   ├── clipboard.ts     # 剪贴板操作
│   ├── error.ts         # 错误分类与本地化
│   ├── validation.ts    # 校验工具
│   ├── encryption.ts    # 加密工具
│   ├── compare.ts       # 对象比较
│   ├── heatmap.ts       # 热力图数据计算
│   ├── sqliteAdapter.ts # SQLite 适配层
│   ├── helpers.ts       # 通用辅助
│   ├── connection.ts    # 连接地址解析
│   ├── language.ts, models.ts, headers.ts, constants.ts  # 各领域常量/映射
│   ├── quota/           # Quota 数据解析（7 个子模块：parsers, validators, builders, formatters, resolvers, constants, index）
│   └── usage/           # 图表配置与延迟分析（chartConfig.ts, latency.ts, index）
├── types/               # TypeScript 类型定义
├── data/                # 静态数据（modelPricePresets.ts 模型价格预设）
├── i18n/locales/        # 翻译文件（en.json, zh-CN.json, zh-TW.json, ru.json）
├── styles/              # 全局样式
│   ├── themes.scss      # CSS 自定义属性主题（light/dark）
│   ├── variables.scss   # SCSS 变量（颜色、间距、圆角、阴影、z-index）
│   ├── components.scss  # 全局组件样式
│   ├── global.scss      # 全局基础样式
│   ├── layout.scss      # 布局相关
│   ├── mixins.scss      # SCSS mixins
│   └── reset.scss       # CSS reset
├── router/              # ProtectedRoute 路由守卫
└── assets/
    └── icons/           # SVG 图标（providers）
```

## 技术栈

| 领域 | 技术 |
|------|------|
| 框架 | React 19 + TypeScript 5.9 |
| 构建 | Vite 7 + vite-plugin-singlefile |
| 样式 | SCSS modules + CSS custom properties |
| 路由 | react-router-dom 7 HashRouter（ProtectedRoute 守卫） |
| 状态 | zustand 5 |
| 图表 | chart.js + react-chartjs-2 |
| HTTP | axios → apiClient (services/api/client.ts) |
| i18n | react-i18next + 本地 JSON |
| 代码编辑器 | @codemirror/lang-yaml + @uiw/react-codemirror |
| 动画 | motion (framer-motion) |
| 虚拟滚动 | @tanstack/react-virtual |
| 测试 | vitest + @testing-library/react + jsdom |
| 包管理 | bun（禁止 npm） |

## 关键约定

### 颜色系统
- **SCSS 变量** (`variables.scss`): `$primary-color`, `$success-color`, `$warning-color`, `$error-color`, `$gray-*`, `$spacing-*`, `$radius-*`, `$shadow-*`, `$transition-*`, `$z-content`(20), `$z-overlay`(50), `$z-max`(9999)
- **CSS 自定义属性** (`themes.scss`): `--bg-primary/secondary/tertiary`, `--text-primary/secondary/tertiary`, `--border-color`, `--primary-color/hover/contrast`, `--success-color`, `--warning-color`, `--error-color`
- **原则**: 禁止硬编码 hex 颜色，使用 SCSS 变量或 CSS 自定义属性 + fallback

### i18n
- 四个 locale: `en.json`, `zh-CN.json`, `zh-TW.json`, `ru.json`，顶级键与 auth_login 子键数量已对齐（4×37, auth_login 均 182 键）
- `useTranslation()` 返回的 `t` 函数，使用带命名空间的键：`'usage_stats.request_events_title'`
- 所有用户可见文字必须通过 `t()` 调用

### Usage 数据流
- 后端数据 → `collectUsageDetails()` → `UsageDetail[]` → 各组件通过 `useMemo` 转换
- Token 字段: `input_tokens`, `output_tokens`, `reasoning_tokens`, `cached_tokens`, `total_tokens`
- Thinking 字段: `UsageThinking` 接口 (intensity, mode, level, budget)
- reasoning_content 可选透传

### 供应商类型
- SourceResolver 识别: gemini / claude / codex / vertex / openai
- OpenAI 兼容供应商通过 `OpenAIProviderConfig` 配置接入

### ESLint
- 零 eslint-disable 注释策略
- 规则: react-hooks (含 set-state-in-effect), typescript-eslint, react-refresh
- `exhaustive-deps` 必须补齐依赖而非禁用

## 构建命令

```bash
bun install          # 安装依赖
bun run dev          # 开发服务器
bun run build        # 生产构建
bun run test         # vitest 测试
bun run test:watch   # vitest watch 模式
bun run format       # prettier 格式化
bun run type-check   # tsc --noEmit 类型检查
bun run lint         # ESLint 检查
bun run doctor       # git 状态诊断
```

## 参考仓库

| 仓库 | 用途 |
|------|------|
| cockpit-tools | OAuth 多平台参考实现 |
| codex2api | API 翻译/代理 |
| sub2api | OIDC 通用登录 |
| Kiro-account-manager | 本地代理 + thinking 转译 |
| CLIProxyAPI (fork) | 后端 API（PR #3345 Claude OAuth） |

详见 `Project/Docs/reference-tracker.md`。
