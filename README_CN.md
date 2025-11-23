# Cli-Proxy-API-Management-Center
这是一个用于管理 CLI Proxy API 的现代化 Web 界面。

[English](README.md)

主项目: https://github.com/router-for-me/CLIProxyAPI  
示例网站: https://remote.router-for.me/  
最低版本 ≥ 6.3.0（推荐 ≥ 6.5.0）

自 6.0.19 起 WebUI 已集成到主程序中，启动后可通过 `/management.html` 访问。

## 功能特点

### 主要能力
- **登录与体验**: 自动检测当前地址（可自定义/重置），加密自动登录，语言/主题切换，响应式布局与移动端侧边栏。
- **基础设置**: 调试、代理 URL、请求重试，配额溢出自动切换项目/预览模型，使用统计开关，请求日志与文件日志开关，WebSocket `/ws/*` 鉴权开关。
- **密钥与提供商**: 管理代理服务密钥，Gemini/Codex/Claude 配置，OpenAI 兼容提供商（自定义 Base URL/Headers/Proxy/模型别名），Vertex AI 服务账号导入（可选区域）。
- **认证文件与 OAuth**: 上传/下载/搜索/分页 JSON 凭据，类型筛选（Qwen/Gemini/GeminiCLI/AIStudio/Claude/Codex/Antigravity/iFlow/Vertex/Empty），一键删除全部；Codex、Anthropic(Claude)、Antigravity(Google)、Gemini CLI（可选项目）、Qwen 设备码、iFlow OAuth 与 Cookie 登录。
- **日志**: 实时查看并增量刷新，支持下载和清空；启用“写入日志文件”后出现日志栏目。
- **使用统计**: 概览卡片、小时/天切换、最多三条模型曲线、按 API 统计表（Chart.js）。
- **配置管理**: 内置 CodeMirror YAML 编辑器，在线读取/保存 `/config.yaml`，语法高亮与状态提示。
- **系统与版本**: 连接/配置缓存状态、最后刷新时间，底栏显示服务版本、构建时间与 UI 版本。
- **安全与偏好**: 密钥遮蔽、加密本地存储，主题/语言/侧边栏状态持久化，实时状态反馈。

## 使用方法

1) **主程序启动后使用（推荐）**  
   访问 `http://您的服务器:8317/management.html`。

2) **直接静态打开**  
   浏览器打开 `index.html`（或 `npm run build` 生成的 `dist/index.html` 单文件）。

3) **本地服务器**
```bash
npm install
npm start        # 默认 http://localhost:3000
npm run dev      # 可选开发端口 3090
# 或
python -m http.server 8000
```
   然后在浏览器打开对应的 localhost 地址。

4) **配置连接**  
   登录页会显示自动检测的地址，可自行修改，填入管理密钥后点击连接。凭据将加密保存以便下次自动登录。

提示: 开启“写入日志文件”后才会显示“日志查看”导航。

## 技术栈

- **前端**: 纯 HTML、CSS、JavaScript (ES6+)
- **样式**: CSS3 + Flexbox/Grid，支持 CSS 变量
- **图标**: Font Awesome 6.4.0
- **图表**: Chart.js 交互式数据可视化
- **编辑/解析**: CodeMirror + js-yaml
- **国际化**: 自定义 i18n（中/英）与主题系统（明/暗）
- **API**: RESTful 管理接口，自动附加认证
- **存储**: LocalStorage 轻量加密存储偏好与凭据

## 构建与开发

- `npm run build` 通过 webpack（`build.cjs`、`bundle-entry.js`、`build-scripts/prepare-html.js`）打包为 `dist/index.html`。
- Font Awesome、Chart.js、CodeMirror 仍走 CDN，减小打包体积。
- 开发可用 `npm start` (3000) / `npm run dev` (3090) 或 `python -m http.server` 静态托管。

## 故障排除

### 连接问题
1. 确认 CLI Proxy API 服务正在运行
2. 检查 API 地址是否正确
3. 验证管理密钥是否有效
4. 确认防火墙设置允许连接

### 数据不更新
1. 点击"刷新全部"按钮
2. 检查网络连接
3. 查看浏览器控制台错误信息

### 日志与配置编辑
- 日志: 需要服务端开启写文件日志；返回 404 说明版本过旧或未启用。
- 配置编辑: 依赖 `/config.yaml` 接口，保存前请确保 YAML 语法正确。

### 使用统计
- 若图表为空，请开启“使用统计”；数据在服务重启后会清空。

## 项目结构
```
├── index.html
├── styles.css
├── app.js
├── i18n.js
├── src/                # 核心/模块/工具源码
├── build.cjs           # Webpack 构建脚本
├── bundle-entry.js     # 打包入口
├── build-scripts/      # 构建工具
│   └── prepare-html.js
├── dist/               # 打包输出单文件
├── api.md
├── management-guide_CN.md
├── BUILD_RELEASE.md
├── LICENSE
├── README.md
└── README_CN.md
```

## 贡献
欢迎提交 Issue 和 Pull Request 来改进这个项目！我们欢迎更多的大佬来对这个 WebUI 进行更新！

本项目采用 MIT 许可。
