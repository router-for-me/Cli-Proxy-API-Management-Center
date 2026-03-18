# CLI Proxy API 管理中心

这是一个用于 **CLI Proxy API** 管理与排障的单文件 Web UI。
它通过 **Management API** 完成配置、凭据、日志和使用统计等操作。

[English](README.md)

- **主项目**: https://github.com/router-for-me/CLIProxyAPI
- **示例地址**: https://remote.router-for.me/
- **最低版本要求**: `>= 6.8.0`（推荐 `>= 6.8.15`）

> 从 `6.0.19` 开始，这个 Web UI 已随 CLI Proxy API 主程序一起发布。
> 服务启动后，直接访问 API 端口上的 `/management.html` 即可。

---

## 一眼看懂

### 如果你已经在运行 CLI Proxy API

直接打开：

```text
http://<host>:<api_port>/management.html
```

然后输入 **管理密钥** 即可连接。

### 如果你想本地开发

```bash
npm install
npm run dev
```

打开：

```text
http://localhost:5173
```

再连接到你的 CLI Proxy API 后端。

### 如果你想构建单文件版本

```bash
npm install
npm run build
```

输出文件：

```text
dist/index.html
```

---

## 这个项目是什么

本仓库只包含 **Web 管理界面本身**。

它可以用来：
- 读取和更新配置
- 管理 API keys 与 provider 配置
- 上传认证文件
- 查看日志与使用统计
- 做管理侧排障

它**不是**：
- 代理服务本体
- 流量转发器
- CLI Proxy API 主项目的替代品

Web UI 通过下面这个管理接口与后端通信：

```text
/v0/management
```

---

## 快速开始

### 方式 A：使用 CLI Proxy API 自带的 Web UI（推荐）

1. 启动 CLI Proxy API。
2. 打开：

   ```text
   http://<host>:<api_port>/management.html
   ```

3. 输入 **管理密钥**。
4. 点击连接。

页面会根据当前 URL 自动推断后端地址，也支持手动修改。

### 方式 B：启动开发服务器

```bash
npm install
npm run dev
```

然后打开：

```text
http://localhost:5173
```

### 方式 C：构建单文件 HTML

```bash
npm install
npm run build
npm run preview
```

说明：
- 构建输出为 `dist/index.html`
- 发布流程里会重命名为 `management.html`
- 直接用 `file://` 打开可能会遇到浏览器 CORS 限制
- 更稳妥的方式是使用 `npm run preview` 或静态服务器访问

---

## 如何连接

### API 地址支持哪些格式

下面这些格式都可以，UI 会自动归一化：

- `localhost:8317`
- `http://192.168.1.10:8317`
- `https://example.com:8317`
- `http://example.com:8317/v0/management`

### 管理密钥是什么

**管理密钥** 会以以下方式发送：

```text
Authorization: Bearer <MANAGEMENT_KEY>
```

注意，这和 UI 里管理的代理 `api-keys` **不是一回事**。

- **管理密钥** → 用于访问 Web UI / Management API
- **API Keys** → 用于客户端调用代理接口

### 远程管理

如果你是从非 localhost 浏览器访问，服务端通常需要开启远程管理，例如：

```yaml
allow-remote-management: true
```

---

## 你可以管理什么

### 仪表盘
- 连接状态
- 服务版本 / 构建时间
- 核心数量概览
- 可用模型快照

### 基础设置
- 调试模式
- 代理 URL
- 重试设置
- 配额回退策略
- 使用统计
- 请求日志
- 文件日志
- WebSocket 鉴权

### API Keys
- 增 / 改 / 删 代理 `api-keys`

### AI 提供商
- Gemini / Codex / Claude / Vertex 配置
- Base URL、Headers、代理、模型别名、排除模型、Prefix
- OpenAI 兼容提供商支持多 API key
- 支持从 `/v1/models` 导入模型
- OpenAI 兼容提供商支持浏览器侧 `chat/completions` 测试
- 支持 Ampcode 集成

### 认证文件
- 上传 / 下载 / 删除 JSON 凭据
- 搜索 / 筛选 / 分页
- runtime-only 标记
- 后端支持时可查看单个凭据对应模型
- 管理 OAuth 排除模型与模型别名映射

### OAuth
- 发起 OAuth / 设备码流程
- 轮询状态
- 提交可选回调 `redirect_url`
- 导入 iFlow Cookie

### 配额管理
- 管理 Claude、Antigravity、Codex、Gemini CLI 等提供商配额与使用情况

### 使用统计
- 请求 / Token 图表
- 按 API 和按模型拆分
- 缓存 / 推理 Token 拆分
- RPM / TPM 时间窗
- 支持基于本地价格表的费用估算

### 配置文件
- 浏览器内编辑 `/config.yaml`
- YAML 高亮 + 搜索
- 保存并重载

### 日志
- 增量拉取日志
- 自动刷新
- 搜索
- 隐藏管理流量
- 清空日志
- 下载请求错误日志

### 系统信息
- 快捷链接
- 拉取并分组展示 `/v1/models`
- 需要至少一个代理 API key

---

## 典型使用流程

1. 打开 `/management.html`
2. 用 **管理密钥** 登录
3. 在 **仪表盘** 检查服务状态
4. 在 **API Keys** 和 **AI 提供商** 里完成配置
5. 按需上传 **认证文件**
6. 用 **日志** 和 **使用统计** 做排障

---

## 技术栈

- React 19
- TypeScript 5.9
- Vite 7
- Zustand
- Axios
- react-router-dom v7
- Chart.js
- CodeMirror 6
- SCSS Modules
- i18next

---

## 多语言支持

当前支持：
- 英文（`en`）
- 简体中文（`zh-CN`）
- 俄文（`ru`）

界面语言会根据浏览器自动检测，也可以在页面底部手动切换。

---

## 浏览器支持

- 构建目标：`ES2020`
- 支持现代 Chrome / Firefox / Safari / Edge
- 适配平板与移动端响应式布局

---

## 构建与发布

- 输出为 **单文件 HTML**：`dist/index.html`
- 资源通过 `vite-plugin-singlefile` 内联
- 打 `vX.Y.Z` 标签会触发 `.github/workflows/release.yml`
- 发布产物为 `dist/management.html`
- 页脚版本号在构建期从 `VERSION`、git tag 或 `package.json` 注入

---

## 安全提示

- 管理密钥会存进浏览器 `localStorage`
- 存储格式是轻量混淆：`enc::v1::...`
- 但它依然是敏感信息
- 建议使用独立浏览器配置或独立设备进行管理
- 开启远程管理前，请先评估暴露面

---

## 常见问题

### 无法连接 / 401
- 检查 API 地址
- 检查管理密钥
- 确认服务端是否开启远程管理

### 连续认证失败
- 服务端可能会对远程 IP 进行临时封禁

### 日志页面不显示
- 需要在 **基础设置** 中开启 **写入日志文件**

### 某些功能显示 unsupported
- 可能是后端版本太旧
- 也可能是接口未启用或不存在

### OpenAI 提供商测试失败
- 测试是在浏览器侧执行
- 会受网络与 CORS 影响
- 浏览器侧失败不一定代表服务端无法访问上游

---

## 开发命令

```bash
npm run dev        # 启动 Vite 开发服务器
npm run build      # TypeScript + Vite 构建
npm run preview    # 本地预览 dist
npm run lint       # ESLint
npm run format     # Prettier
npm run type-check # 仅执行 TypeScript 检查
```

---

## 贡献

欢迎提 Issue 和 PR。

建议附上：
- 复现步骤
- 服务端版本 + UI 版本
- UI 改动截图
- 验证记录，例如 `npm run lint`、`npm run type-check`

---

## 许可证

MIT
