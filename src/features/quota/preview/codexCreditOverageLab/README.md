# 临时 Codex Credit Mock 验收入口

使用已有 Vite 开发服务打开：

- 入口：<http://localhost:5173/codex-overage-mock.html?scenario=unknown>
- 超时与延迟生效：`?scenario=timeout`
- 无邮箱账号锁：`?scenario=no-email`
- 旧连接 401：`?scenario=race-connection`
- A → B → A：`?scenario=race-aba`
- 会话代次：`?scenario=race-session`
- 清理额度缓存：`?scenario=race-cache`
- 凭证替换：`?scenario=race-replace`

完整场景列表和预期结果由 `scenarios.ts` 定义，页面下方提供所有直达链接。

若服务尚未启动，按仓库约定使用 Bun 1.4.3 安装锁定依赖并执行 `bun run dev`。

## 如何验收

1. 选择场景，每次切换/重置都创建一个新的 iframe，清除上一个场景的内存状态。
2. 在 iframe 中使用真实卡片的“设置”和对话框。初始状态只读取额度，初始 PATCH 必须为 0。
3. 挂起请求由外侧工具栏放行，因此即使真实对话框锁定关闭，仍可模拟返回、切换连接、清理缓存。
4. 对照请求记录、连接代次、账号快照、未决写入记录、模拟上游值和全局事件检查结果。
5. 对超时场景先重试相同值，再点击“延迟写入生效”，验证迟到写入不会让界面错误地宣称反向设置已确认。
6. 用宽度、主题、语言选择器检查 320px / 390px、三个主题、七个语言；这些选择保留当前打开的对话框。

## 隔离与覆盖边界

- bootstrap 先将当前窗口的 localStorage/sessionStorage 替换成独立内存实现，再动态导入应用模块。不会读取、覆盖真实管理密钥或登录偏好。
- Axios 使用只接受 `.mock.invalid` 两个固定地址的终止适配器；所有真实应用请求都经过它，不使用真实凭证、真实 CPA 或 ChatGPT。
- 复用真实 `QuotaCard`、`useCodexCreditOverage`、额度 GET 解析器、PATCH 构造器、Axios 拦截器和 Zustand 状态。预置确认状态仅用于展示历史快照，不会自动写入。
- 适配器能模拟客户端已超时、服务端仍未执行完的情况；这不是用“立即停止服务端”来掩盖竞态。
- 该入口覆盖已列出的前端状态与接口契约分支，不代表真实未公开 ChatGPT 接口兼容性、代理网络或 CPA 集成已经通过。
- 账号锁与未决记录属于当前页面会话；本工具不证明跨标签页、跨浏览器或其他客户端的全局写入串行性。

## 生产与清理

`codex-overage-mock.html` 是独立开发 HTML 入口，不被 `src/main.tsx` 或 App 路由导入。生产默认仍只构建 `index.html`，需确认 dist 只有单文件且不含本工具标记。

验收结束后，删除根目录的 `codex-overage-mock.html`、本目录和 `tests/codexCreditOverageLab.test.ts` 即可；无需调整业务代码、正式路由或 Vite 配置。
