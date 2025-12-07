# CLI Proxy Web UI - React Version

CLI Proxy API Management Center 的 React + TypeScript 重构版本。

## ✨ 特性

- 🎯 完全使用 TypeScript 编写,类型安全
- ⚛️ 基于 React 18 + Vite 构建,开发体验极佳
- 🎨 SCSS 模块化样式,支持亮色/暗色主题
- 🌍 完整的国际化支持 (中文/英文)
- 📦 单文件部署,无需构建服务器
- 🔒 安全的本地存储,支持数据加密
- 📱 响应式设计,支持移动端

## 🚀 快速开始

### 开发模式

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 访问 http://localhost:5173
```

### 生产构建

```bash
# 构建生产版本
npm run build

# 产物在 dist/index.html
# 直接双击打开或部署到服务器
```

### 代码检查

```bash
# TypeScript 类型检查
npm run type-check

# ESLint 代码检查
npm run lint
```

## 📁 项目结构

```
src/
├── components/        # 公共组件
│   ├── common/       # 基础组件 (Button, Input, Card, Modal...)
│   └── layout/       # 布局组件 (MainLayout, Sidebar, Header...)
├── pages/            # 页面组件
│   ├── LoginPage.tsx
│   ├── SettingsPage.tsx
│   ├── ApiKeysPage.tsx
│   ├── AiProvidersPage.tsx
│   ├── AuthFilesPage.tsx
│   ├── OAuthPage.tsx
│   ├── UsagePage.tsx
│   ├── ConfigPage.tsx
│   ├── LogsPage.tsx
│   └── SystemPage.tsx
├── services/         # API 服务
│   ├── api/         # API 客户端
│   └── storage/     # 本地存储服务
├── stores/          # Zustand 状态管理
│   ├── useAuthStore.ts
│   ├── useConfigStore.ts
│   ├── useThemeStore.ts
│   └── useLanguageStore.ts
├── hooks/           # 自定义 Hooks
├── types/           # TypeScript 类型定义
├── utils/           # 工具函数
├── i18n/            # 国际化配置
├── styles/          # 全局样式
└── router/          # 路由配置
```

## 🔧 技术栈

- **框架**: React 18
- **语言**: TypeScript 5
- **构建工具**: Vite 7
- **路由**: React Router 7 (Hash 模式)
- **状态管理**: Zustand 5
- **样式**: SCSS Modules
- **国际化**: i18next
- **HTTP 客户端**: Axios
- **代码检查**: ESLint + TypeScript ESLint

## 📝 使用说明

### 首次使用

1. **清理旧数据** (如果从旧版本升级)
   - 打开 `CLEAR_STORAGE.html` 文件
   - 点击"清空 LocalStorage"按钮
   - 这将清理旧版本的存储数据

2. **打开应用**
   - 双击 `dist/index.html` 文件
   - 或使用 HTTP 服务器访问 (推荐)

3. **配置连接**
   - 输入 CLI Proxy API 服务器地址
   - 输入管理密钥
   - 点击"连接"按钮

### 部署方式

#### 方式 1: 本地文件 (file:// 协议)
直接双击 `dist/index.html` 即可使用。应用已配置为使用 Hash 路由,支持 file:// 协议。

#### 方式 2: HTTP 服务器 (推荐)
```bash
# 使用 Python
cd dist
python -m http.server 8080

# 使用 Node.js (需要安装 serve)
npx serve dist

# 访问 http://localhost:8080
```

#### 方式 3: Nginx/Apache
将 `dist/index.html` 部署到 Web 服务器即可。

## 🐛 故障排除

### 白屏问题

如果打开后显示白屏:

1. 检查浏览器控制台是否有错误
2. 确认是否清理了旧版本的 localStorage 数据
3. 尝试使用 HTTP 服务器访问而不是 file:// 协议

### LocalStorage 错误

如果看到 "Failed to parse stored data" 错误:

1. 打开 `CLEAR_STORAGE.html`
2. 清空所有存储数据
3. 刷新页面重新登录

### 路由问题

应用使用 Hash 路由 (#/login, #/settings),确保 URL 中包含 `#` 符号。

## 📊 构建信息

- **TypeScript**: 0 errors ✅
- **ESLint**: 0 errors, 137 warnings ⚠️
- **Bundle Size**: 473 KB (144 KB gzipped)
- **Build Time**: ~5 seconds

## 🔄 从旧版本迁移

旧版本 (原生 JS) 的数据存储格式已变更。首次使用新版本时:

1. 旧的 localStorage 数据会自动迁移
2. 如果迁移失败,请手动清理 localStorage
3. 重新输入连接信息即可

## 📄 License

Same as CLI Proxy API

## 🤝 贡献

欢迎提交 Issue 和 Pull Request!

---

**注意**: 此版本是原 CLI Proxy Web UI 的 React 重构版本,与原版功能保持一致。
