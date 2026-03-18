# ⚙️ CLI Proxy API Management Center

> A clean, single-file Web UI for managing and troubleshooting **CLI Proxy API**.
> Connects to the **Management API** for config, credentials, logs, and usage insights.

[![Main Project](https://img.shields.io/badge/Main%20Project-CLIProxyAPI-2563eb?style=flat-square)](https://github.com/router-for-me/CLIProxyAPI)
[![Minimum Version](https://img.shields.io/badge/Minimum%20Version-%E2%89%A5%206.8.0-16a34a?style=flat-square)](https://github.com/router-for-me/CLIProxyAPI)
[![Recommended](https://img.shields.io/badge/Recommended-%E2%89%A5%206.8.15-0f766e?style=flat-square)](https://github.com/router-for-me/CLIProxyAPI)
[![Single File UI](https://img.shields.io/badge/Build-Single%20HTML-f59e0b?style=flat-square)](#-build-and-release)

🌐 [中文文档](README_CN.md)

- **Main Project**: https://github.com/router-for-me/CLIProxyAPI
- **Example URL**: https://remote.router-for.me/
- **Minimum Version**: `>= 6.8.0`
- **Recommended Version**: `>= 6.8.15`

> [!TIP]
> Since `6.0.19`, this Web UI is bundled with the main CLI Proxy API program.
> Once the service is running, open `/management.html` on the API port.

---

## ✨ TL;DR

### 🚀 Already running CLI Proxy API?

Open:

```text
http://<host>:<api_port>/management.html
```

Then enter your **management key** and connect.

### 🛠 Want to develop locally?

```bash
npm install
npm run dev
```

Open `http://localhost:5173` and connect it to your CLI Proxy API backend.

### 📦 Want a standalone build?

```bash
npm install
npm run build
```

Output:

```text
dist/index.html
```

---

## 📌 What this project is

This repository contains the **Web UI only**.

### ✅ It is used to
- manage config
- manage API keys and provider settings
- upload auth files
- inspect logs and usage data
- troubleshoot management-side issues

### ❌ It is not
- the proxy server itself
- a traffic forwarder
- a replacement for the main CLI Proxy API project

The UI talks to the CLI Proxy API **Management API** at:

```text
/v0/management
```

---

## 🚀 Quick Start

### Option A — Use the bundled UI (recommended)

1. Start CLI Proxy API.
2. Open:

   ```text
   http://<host>:<api_port>/management.html
   ```

3. Enter the **management key**.
4. Connect.

> [!NOTE]
> The UI auto-detects the server address from the current page URL, but you can still override it manually.

### Option B — Run the dev server

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:5173
```

### Option C — Build a single HTML file

```bash
npm install
npm run build
npm run preview
```

**Notes:**
- output is `dist/index.html`
- release packaging renames it to `management.html`
- opening `dist/index.html` with `file://` may fail because of browser CORS restrictions
- using `npm run preview` or another static server is more reliable

---

## 🔌 How to connect

### 1) API address formats

The UI accepts any of the following and normalizes them automatically:

- `localhost:8317`
- `http://192.168.1.10:8317`
- `https://example.com:8317`
- `http://example.com:8317/v0/management`

### 2) Management key

The **management key** is sent as:

```text
Authorization: Bearer <MANAGEMENT_KEY>
```

This is **not the same thing** as the proxy `api-keys` managed inside the UI.

| Item | Purpose |
|---|---|
| **Management key** | Access the Web UI / Management API |
| **API keys** | Authenticate client requests sent to proxy endpoints |

### 3) Remote management

If you access the UI from a non-localhost browser, the server usually needs remote management enabled, for example:

```yaml
allow-remote-management: true
```

> [!WARNING]
> Enabling remote management increases exposure. Treat it as an operational security decision, not just a convenience toggle.

---

## 🧭 What you can manage

### 📊 Dashboard
- connection status
- server version / build date
- quick counts
- model availability snapshot

### ⚙️ Basic Settings
- debug mode
- proxy URL
- retry settings
- quota fallback behavior
- usage statistics
- request logging
- file logging
- WebSocket auth

### 🔑 API Keys
- add / edit / delete proxy `api-keys`

### 🤖 AI Providers
- Gemini / Codex / Claude / Vertex provider configs
- base URL, headers, proxy, model aliases, excluded models, prefix
- OpenAI-compatible providers with multiple API keys
- import models from `/v1/models`
- browser-side `chat/completions` test for OpenAI-compatible providers
- Ampcode integration

### 🪪 Auth Files
- upload / download / delete JSON credentials
- search / filter / pagination
- runtime-only indicators
- supported-model display when backend supports it
- OAuth excluded models and model alias mapping

### 🔐 OAuth
- start OAuth / device flows
- poll status
- submit optional callback `redirect_url`
- iFlow cookie import

### 📉 Quota Management
- manage quota and usage for Claude, Antigravity, Codex, Gemini CLI, and others

### 📈 Usage
- requests / tokens charts
- per-API and per-model breakdown
- cached / reasoning token breakdown
- RPM / TPM windows
- optional local pricing-based cost estimation

### 🧾 Config
- edit `/config.yaml` in browser
- YAML highlighting + search
- save and reload

### 📜 Logs
- incremental log polling
- auto-refresh
- search
- hide management traffic
- clear logs
- download request error logs

### 🖥 System
- quick links
- fetch and group `/v1/models`
- requires at least one proxy API key

---

## 🪜 Typical usage flow

```text
Open /management.html
        ↓
Login with management key
        ↓
Check Dashboard for server status
        ↓
Configure API Keys and AI Providers
        ↓
Upload Auth Files if needed
        ↓
Use Logs + Usage to troubleshoot
```

---

## 🧱 Tech stack

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

## 🌍 Internationalization

Current languages:
- English (`en`)
- Simplified Chinese (`zh-CN`)
- Russian (`ru`)

The UI language is auto-detected from the browser and can also be switched manually at the bottom of the page.

---

## 🧪 Browser support

- build target: `ES2020`
- modern Chrome / Firefox / Safari / Edge
- responsive layout for tablet and mobile access

---

## 📦 Build and release

- output is a **single HTML file**: `dist/index.html`
- assets are inlined via `vite-plugin-singlefile`
- tagging `vX.Y.Z` triggers `.github/workflows/release.yml`
- release packaging publishes `dist/management.html`
- footer version is injected at build time from `VERSION`, git tag, or `package.json`

---

## 🔒 Security notes

- the management key is stored in browser `localStorage`
- it uses a lightweight obfuscation format: `enc::v1::...`
- treat it as sensitive anyway
- use a dedicated browser profile/device for management if possible
- be cautious when enabling remote management

---

## 🩺 Troubleshooting

### Can’t connect / 401
- verify the API address
- verify the management key
- check whether remote management is enabled on the server

### Repeated auth failures
- the server may temporarily block remote IPs after repeated failed attempts

### Logs page missing
- enable **Logging to file** in **Basic Settings**

### Some features show as unsupported
- backend version may be too old
- endpoint may be disabled or missing

### OpenAI provider test fails
- the test runs in the browser
- it depends on the provider endpoint network/CORS behavior
- a browser-side failure does not always mean the server cannot reach the provider

---

## 👨‍💻 Development

```bash
npm run dev        # start Vite dev server
npm run build      # TypeScript + Vite build
npm run preview    # preview dist locally
npm run lint       # ESLint
npm run format     # Prettier
npm run type-check # TypeScript only
```

---

## 🤝 Contributing

Issues and PRs are welcome.

Please include:
- reproduction steps
- server version + UI version
- screenshots for UI changes
- verification notes such as `npm run lint` and `npm run type-check`

---

## 📄 License

MIT
