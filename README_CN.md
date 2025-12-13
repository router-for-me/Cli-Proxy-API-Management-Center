# CLI Proxy API 管理中心

用于管理 CLI Proxy API 的现代化 React Web 界面，采用全新技术栈重构，提供更好的可维护性、类型安全性和用户体验。

[English](README.md)

**主项目**: https://github.com/router-for-me/CLIProxyAPI
**示例地址**: https://remote.router-for.me/
**最低版本要求**: ≥ 6.3.0（推荐 ≥ 6.5.0）

自 6.0.19 版本起，WebUI 已集成到主程序中，启动服务后可通过 `/management.html` 访问。

## 功能特点

### 核心功能

- **登录与认证**: 自动检测当前地址（支持手动修改），加密自动登录，会话持久化
- **基础设置**: 调试模式、代理 URL、请求重试配置、配额溢出自动切换项目/预览模型、使用统计开关、请求日志与文件日志、WebSocket `/ws/*` 鉴权
- **API 密钥管理**: 管理代理认证密钥，支持添加/编辑/删除操作
- **AI 提供商**: 配置 Gemini/Codex/Claude，OpenAI 兼容提供商（自定义 Base URL/Headers/代理/模型别名），Vertex AI 服务账号 JSON 导入
- **认证文件与 OAuth**: 上传/下载/搜索/分页 JSON 凭据；类型筛选（Qwen/Gemini/GeminiCLI/AIStudio/Claude/Codex/Antigravity/iFlow/Vertex/Empty）；批量删除；多提供商 OAuth/设备码流程
- **日志查看**: 实时日志查看，支持自动刷新、下载和清空（启用"写入日志文件"后显示）
- **使用统计**: 概览卡片、小时/天切换、多模型交互式图表、按 API 统计表格
- **配置管理**: 内置 YAML 编辑器，支持 `/config.yaml` 语法高亮、重载/保存
- **系统信息**: 连接状态、配置缓存、服务器版本/构建时间、底栏显示 UI 版本

### 用户体验

- **响应式设计**: 完整移动端支持，可折叠侧边栏
- **主题系统**: 明/暗模式切换，偏好持久化
- **国际化**: 简体中文和英文，无缝切换
- **实时反馈**: 所有操作的消息通知
- **安全性**: 密钥遮蔽、加密本地存储

## 技术栈

- **前端框架**: React 19 + TypeScript
- **构建工具**: Vite 7，单文件输出（[vite-plugin-singlefile](https://github.com/nicknisi/vite-plugin-singlefile)）
- **状态管理**: [Zustand](https://github.com/pmndrs/zustand)
- **路由**: React Router 7 (HashRouter)
- **HTTP 客户端**: Axios，带认证和错误处理拦截器
- **国际化**: i18next + react-i18next
- **样式**: SCSS + CSS Modules，CSS 变量主题
- **图表**: Chart.js + react-chartjs-2
- **代码编辑器**: @uiw/react-codemirror（YAML 支持）

## 快速开始

### 环境要求

- Node.js 18+（推荐 LTS 版本）
- npm 9+

### 安装

```bash
# 克隆仓库
git clone https://github.com/router-for-me/Cli-Proxy-API-Management-Center.git
cd Cli-Proxy-API-Management-Center

# 安装依赖
npm install
```

### 开发

```bash
npm run dev          # 启动 Vite 开发服务器（默认: http://localhost:5173）
```

### 构建

```bash
npm run build        # TypeScript 检查 + Vite 生产构建
```

构建输出单个 `dist/index.html` 文件，所有资源已内联。

### 其他命令

```bash
npm run preview      # 本地预览生产构建
npm run lint         # ESLint 严格模式（--max-warnings 0）
npm run format       # Prettier 格式化 src/**/*.{ts,tsx,css,scss}
npm run type-check   # 仅 TypeScript 类型检查（tsc --noEmit）
```

## 使用方法

### 访问方式

1. **与 CLI Proxy API 集成使用（推荐）**
   启动 CLI Proxy API 服务后，访问 `http://您的服务器:8317/management.html`

2. **独立使用（构建后文件）**
   直接在浏览器打开构建的 `dist/index.html`，或部署到任意静态文件服务器

3. **开发服务器**
   运行 `npm run dev` 后打开 `http://localhost:5173`

### 初始配置

1. 登录页会自动检测当前地址，可根据需要修改
2. 输入管理密钥
3. 点击连接进行认证
4. 凭据会加密保存到本地，下次自动登录

> **提示**: 只有在"基础设置"中启用"写入日志文件"后，才会显示"日志查看"导航项。

## 项目结构

```
├── src/
│   ├── components/
│   │   ├── common/           # 公共组件（NotificationContainer）
│   │   ├── layout/           # 应用外壳（MainLayout 侧边栏布局）
│   │   └── ui/               # 可复用 UI 组件（Button、Input、Modal 等）
│   ├── hooks/                # 自定义 Hooks（useApi、useDebounce、usePagination 等）
│   ├── i18n/
│   │   ├── locales/          # 翻译文件（zh-CN.json、en.json）
│   │   └── index.ts          # i18next 配置
│   ├── pages/                # 路由页面组件，配套 .module.scss 样式
│   ├── router/               # ProtectedRoute 路由守卫
│   ├── services/
│   │   ├── api/              # API 层（client.ts 单例，功能模块）
│   │   └── storage/          # 安全存储工具
│   ├── stores/               # Zustand 状态管理（auth、config、theme、language、notification）
│   ├── styles/               # 全局 SCSS（variables、mixins、themes、components）
│   ├── types/                # TypeScript 类型定义
│   ├── utils/                # 工具函数（constants、format、validation 等）
│   ├── App.tsx               # 根组件与路由
│   └── main.tsx              # 入口文件
├── dist/                     # 构建输出（单文件打包）
├── vite.config.ts            # Vite 配置
├── tsconfig.json             # TypeScript 配置
└── package.json
```

### 核心架构模式

- **路径别名**: 使用 `@/` 导入 `src/` 目录（在 vite.config.ts 和 tsconfig.json 中配置）
- **API 客户端**: `src/services/api/client.ts` 单例，带认证拦截器
- **状态管理**: Zustand stores，auth/theme/language 持久化到 localStorage
- **样式**: SCSS 变量自动注入；CSS Modules 实现组件作用域样式
- **构建输出**: 单文件打包，便于分发（所有资源内联）

## 故障排除

### 连接问题

1. 确认 CLI Proxy API 服务正在运行
2. 检查 API 地址是否正确
3. 验证管理密钥是否有效
4. 确认防火墙设置允许连接

### 数据不更新

1. 点击顶栏的"刷新全部"按钮
2. 检查网络连接
3. 打开浏览器开发者工具控制台查看错误信息

### 日志与配置编辑

- **日志**: 需要服务端启用写文件日志；返回 404 说明服务器版本过旧或未启用日志
- **配置编辑**: 依赖 `/config.yaml` 接口；保存前请确保 YAML 语法正确

### 使用统计

- 若图表为空，请在设置中启用"使用统计"；数据在服务重启后会清空

## 贡献

欢迎提交 Issue 和 Pull Request！请遵循以下指南：

1. Fork 本仓库
2. 创建功能分支（`git checkout -b feature/amazing-feature`）
3. 提交更改，使用清晰的提交信息
4. 推送到分支
5. 开启 Pull Request

### 开发规范

- 提交前运行 `npm run lint` 和 `npm run type-check`
- 遵循现有代码模式和命名规范
- 使用 TypeScript 严格模式
- 编写有意义的提交信息

## 许可证

本项目采用 MIT 许可证。
