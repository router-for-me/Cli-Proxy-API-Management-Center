# CLI Proxy API Management Center

A modern React-based WebUI for managing the CLI Proxy API, completely refactored with a modern tech stack for enhanced maintainability, type safety, and user experience.

[中文文档](README_CN.md)

**Main Project**: https://github.com/router-for-me/CLIProxyAPI
**Example URL**: https://remote.router-for.me/
**Minimum Required Version**: ≥ 6.3.0 (recommended ≥ 6.5.0)

Since version 6.0.19, the WebUI ships with the main program; access it via `/management.html` on the API port once the service is running.

## Features

### Core Capabilities

- **Login & Authentication**: Auto-detects current address (manual override supported), encrypted auto-login with secure localStorage, session persistence
- **Basic Settings**: Debug mode, proxy URL, request retries with custom config, quota fallback (auto-switch project/preview models), usage statistics toggle, request logging & file logging, WebSocket `/ws/*` authentication
- **API Keys Management**: Manage proxy auth keys with add/edit/delete operations
- **AI Providers**: Configure Gemini/Codex/Claude settings, OpenAI-compatible providers with custom base URLs/headers/proxy/model aliases, Vertex AI credential import from service-account JSON
- **Auth Files & OAuth**: Upload/download/search/paginate JSON credentials; type filters (Qwen/Gemini/GeminiCLI/AIStudio/Claude/Codex/Antigravity/iFlow/Vertex/Empty); bulk delete; OAuth/Device flows for multiple providers
- **Logs Viewer**: Real-time log viewer with auto-refresh, download and clear capabilities (appears when logging-to-file is enabled)
- **Usage Analytics**: Overview cards, hourly/daily toggles, interactive charts with multiple model lines, per-API statistics table
- **Config Management**: In-browser YAML editor for `/config.yaml` with syntax highlighting, reload/save functionality
- **System Information**: Connection status, config cache, server version/build date, UI version in footer

### User Experience

- **Responsive Design**: Full mobile support with collapsible sidebar
- **Theme System**: Light/dark mode with persistent preference
- **Internationalization**: English and Simplified Chinese (zh-CN) with seamless switching
- **Real-time Feedback**: Toast notifications for all operations
- **Security**: Masked secrets, encrypted local storage

## Tech Stack

- **Frontend Framework**: React 19 with TypeScript
- **Build Tool**: Vite 7 with single-file output ([vite-plugin-singlefile](https://github.com/nicknisi/vite-plugin-singlefile))
- **State Management**: [Zustand](https://github.com/pmndrs/zustand) for global stores
- **Routing**: React Router 7 with HashRouter
- **HTTP Client**: Axios with interceptors for auth & error handling
- **Internationalization**: i18next + react-i18next
- **Styling**: SCSS with CSS Modules, CSS Variables for theming
- **Charts**: Chart.js + react-chartjs-2
- **Code Editor**: @uiw/react-codemirror with YAML support

## Getting Started

### Prerequisites

- Node.js 18+ (LTS recommended)
- npm 9+

### Installation

```bash
# Clone the repository
git clone https://github.com/router-for-me/Cli-Proxy-API-Management-Center.git
cd Cli-Proxy-API-Management-Center

# Install dependencies
npm install
```

### Development

```bash
npm run dev          # Start Vite dev server (default: http://localhost:5173)
```

### Build

```bash
npm run build        # TypeScript check + Vite production build
```

The build outputs a single `dist/index.html` file with all assets inlined.

### Other Commands

```bash
npm run preview      # Preview production build locally
npm run lint         # ESLint with strict mode (--max-warnings 0)
npm run format       # Prettier formatting for src/**/*.{ts,tsx,css,scss}
npm run type-check   # TypeScript type checking only (tsc --noEmit)
```

## Usage

### Access Methods

1. **Integrated with CLI Proxy API (Recommended)**
   After starting the CLI Proxy API service, visit `http://your-server:8317/management.html`

2. **Standalone (Built file)**
   Open the built `dist/index.html` directly in a browser, or host it on any static file server

3. **Development Server**
   Run `npm run dev` and open `http://localhost:5173`

### Initial Configuration

1. The login page auto-detects the current address; you can modify it if needed
2. Enter your management key
3. Click Connect to authenticate
4. Credentials are encrypted and saved locally for auto-login

> **Tip**: The Logs navigation item appears only after enabling "Logging to file" in Basic Settings.

## Project Structure

```
├── src/
│   ├── components/
│   │   ├── common/           # Shared components (NotificationContainer)
│   │   ├── layout/           # App shell (MainLayout with sidebar)
│   │   └── ui/               # Reusable UI primitives (Button, Input, Modal, etc.)
│   ├── hooks/                # Custom hooks (useApi, useDebounce, usePagination, etc.)
│   ├── i18n/
│   │   ├── locales/          # Translation files (zh-CN.json, en.json)
│   │   └── index.ts          # i18next configuration
│   ├── pages/                # Route page components with co-located .module.scss
│   ├── router/               # ProtectedRoute wrapper
│   ├── services/
│   │   ├── api/              # API layer (client.ts singleton, feature modules)
│   │   └── storage/          # Secure storage utilities
│   ├── stores/               # Zustand stores (auth, config, theme, language, notification)
│   ├── styles/               # Global SCSS (variables, mixins, themes, components)
│   ├── types/                # TypeScript type definitions
│   ├── utils/                # Utility functions (constants, format, validation, etc.)
│   ├── App.tsx               # Root component with routing
│   └── main.tsx              # Entry point
├── dist/                     # Build output (single-file bundle)
├── vite.config.ts            # Vite configuration
├── tsconfig.json             # TypeScript configuration
└── package.json
```

### Key Architecture Patterns

- **Path Alias**: Use `@/` to import from `src/` (configured in vite.config.ts and tsconfig.json)
- **API Client**: Singleton `apiClient` in `src/services/api/client.ts` with auth interceptors
- **State Management**: Zustand stores with localStorage persistence for auth/theme/language
- **Styling**: SCSS variables auto-injected; CSS Modules for component-scoped styles
- **Build Output**: Single-file bundle for easy distribution (all assets inlined)

## Troubleshooting

### Connection Issues

1. Confirm the CLI Proxy API service is running
2. Check if the API address is correct
3. Verify that the management key is valid
4. Ensure your firewall allows the connection

### Data Not Updating

1. Click the "Refresh All" button in the header
2. Check your network connection
3. Open browser DevTools console for error details

### Logs & Config Editor

- **Logs**: Requires server-side logging-to-file enabled; 404 indicates old server version or logging disabled
- **Config Editor**: Requires `/config.yaml` endpoint; ensure valid YAML syntax before saving

### Usage Statistics

- If charts are empty, enable "Usage statistics" in settings; data resets on server restart

## Contributing

We welcome Issues and Pull Requests! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes with clear messages
4. Push to your branch
5. Open a Pull Request

### Development Guidelines

- Run `npm run lint` and `npm run type-check` before committing
- Follow existing code patterns and naming conventions
- Use TypeScript strict mode
- Write meaningful commit messages

## License

This project is licensed under the MIT License.
