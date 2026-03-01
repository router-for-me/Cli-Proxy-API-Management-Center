# 发布管理面板 (management.html)

## 构建单文件

- **开发/本地**：`npm run build` → 生成 `dist/index.html`（静态资源已内联）。
- **产出 management.html**：`npm run build:management` → 额外复制为 `dist/management.html`。
- **CI**：推送 tag 后 GitHub Actions 会执行 `npm run build`，并将 `dist/index.html` 重命名为 `dist/management.html` 作为 Release 资产。

## GitHub Release（必须包含 management.html）

1. **推送代码到你的仓库**
   ```bash
   git remote add dear-tao https://github.com/Dear-Tao/Cli-Proxy-API-Management-Center.git
   git push dear-tao main
   ```

2. **创建 Release（二选一）**
   - **使用 `latest`（便于自动检测）**
     ```bash
     git tag latest
     git push dear-tao latest
     ```
     会创建标签为 `latest` 的 Release，资产为 `management.html`。
   - **使用版本号**
     ```bash
     git tag v1.0.0
     git push dear-tao v1.0.0
     ```

3. **资产要求**  
   每次 Release 必须包含文件名 **management.html**，当前工作流已自动上传该文件。
