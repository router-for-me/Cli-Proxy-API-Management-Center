# Cli-Proxy-API-Management-Center
This is the modern WebUI for managing the CLI Proxy API.

[中文文档](README_CN.md)

Main Project: https://github.com/router-for-me/CLIProxyAPI  
Example URL: https://remote.router-for.me/  
Minimum required version: ≥ 6.3.0 (recommended ≥ 6.5.0)

Since 6.0.19 the WebUI ships with the main program; access it via `/management.html` on the API port once the service is running.

## Features

### Capabilities
- **Login & UX**: Auto-detects the current address (manual override/reset supported), encrypted auto-login, language/theme toggles, responsive layout with mobile sidebar.
- **Basic Settings**: Debug, proxy URL, request retries, quota fallback (auto-switch project/preview models), usage-statistics toggle, request logging & logging-to-file switches, WebSocket `/ws/*` auth switch.
- **Keys & Providers**: Manage proxy auth keys, Gemini/Codex/Claude configs, OpenAI-compatible providers (custom base URLs/headers/proxy/model aliases), Vertex AI credential import from service-account JSON with optional location.
- **Auth Files & OAuth**: Upload/download/search/paginate JSON credentials; type filters (Qwen/Gemini/GeminiCLI/AIStudio/Claude/Codex/Antigravity/iFlow/Vertex/Empty); delete-all; OAuth/Device flows for Codex, Anthropic (Claude), Antigravity (Google), Gemini CLI (optional project), Qwen; iFlow OAuth and cookie login.
- **Logs**: Live viewer with auto-refresh/incremental updates, download and clear; section appears when logging-to-file is enabled.
- **Usage Analytics**: Overview cards, hourly/daily toggles, up to three model lines per chart, per-API stats table (Chart.js).
- **Config Management**: In-browser CodeMirror YAML editor for `/config.yaml` with reload/save, syntax highlighting, and status feedback.
- **System Info & Versioning**: Connection/config cache status, last refresh time, server version/build date, and UI version in the footer.
- **Security & Preferences**: Masked secrets, secure local storage, persistent theme/language/sidebar state, real-time status feedback.

## How to Use

1) **After CLI Proxy API is running (recommended)**  
   Visit `http://your-server:8317/management.html`.

2) **Direct static use**  
   Open `index.html` (or the bundled `dist/index.html` from `npm run build`) directly in your browser.

3) **Local server**
```bash
npm install
npm start        # http://localhost:3000
npm run dev      # optional dev port: 3090
# or
python -m http.server 8000
```
   Then open the corresponding localhost URL.

4) **Configure connection**  
   The login page shows the detected address; you can override it, enter the management key, and click Connect. Saved credentials use encrypted local storage for auto-login.

Tip: The Logs navigation item appears after enabling "Logging to file" in Basic Settings.

## Tech Stack

- **Frontend**: Plain HTML, CSS, JavaScript (ES6+)
- **Styling**: CSS3 + Flexbox/Grid with CSS Variables
- **Icons**: Font Awesome 6.4.0
- **Charts**: Chart.js for interactive data visualization
- **Editor/Parsing**: CodeMirror + js-yaml
- **Fonts**: Segoe UI system font
- **Internationalization**: Custom i18n (EN/CN) and theme system (light/dark)
- **API**: RESTful management endpoints with automatic authentication
- **Storage**: LocalStorage with lightweight encryption for preferences/credentials

## Build & Development

- `npm run build` bundles everything into `dist/index.html` via webpack (`build.cjs`, `bundle-entry.js`, `build-scripts/prepare-html.js`).
- External CDNs remain for Font Awesome, Chart.js, and CodeMirror to keep the bundle lean.
- Development servers: `npm start` (3000) or `npm run dev` (3090); Python `http.server` also works for static hosting.

## Troubleshooting

### Connection Issues
1. Confirm that the CLI Proxy API service is running.
2. Check if the API address is correct.
3. Verify that the management key is valid.
4. Ensure your firewall settings allow the connection.

### Data Not Updating
1. Click the "Refresh All" button.
2. Check your network connection.
3. Check the browser's console for any error messages.

### Logs & Config Editor
- Logs: Requires server-side logging-to-file; 404 indicates the server build is too old or logging is disabled.
- Config editor: Requires `/config.yaml` endpoint; keep YAML valid before saving.

### Usage Stats
- Enable "Usage statistics" if charts stay empty; data resets on server restart.

## Project Structure
```
├── index.html
├── styles.css
├── app.js
├── i18n.js
├── src/                # Core/modules/utils source code
├── build.cjs           # Webpack build script
├── bundle-entry.js     # Bundling entry
├── build-scripts/      # Build utilities
│   └── prepare-html.js
├── dist/               # Bundled single-file output
├── api.md
├── management-guide_CN.md
├── BUILD_RELEASE.md
├── LICENSE
├── README.md
└── README_CN.md
```

## Contributing
We welcome Issues and Pull Requests to improve this project! We encourage more developers to contribute to the enhancement of this WebUI!

This project is licensed under the MIT License.
