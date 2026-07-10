# Repository Guidelines

## Project Structure & Module Organization

This is a React 19 + TypeScript Vite frontend for the CLI Proxy API Management API. Main source lives in `src/`: routes in `src/router`, pages in `src/pages`, components in `src/components`, API clients in `src/services/api`, state in `src/stores`, hooks in `src/hooks`, styles in `src/styles`, and types in `src/types`. Assets live in `src/assets`, with provider icons under `src/assets/icons`. Localization files are in `src/i18n/locales`; update all supported locales when adding user-facing text. Production output is `dist/index.html`.

## Build, Test, and Development Commands

- `bun install --frozen-lockfile`: install dependencies from `bun.lock`.
- `bun run dev`: start the Vite dev server at `http://localhost:5173`.
- `bun run build`: run TypeScript compilation and build `dist/`.
- `bun run preview`: serve the built output locally.
- `bun run test`: run the Bun test suite.
- `bun run lint`: run ESLint over TypeScript/TSX files.
- `bun run verify`: run tests, lint, TypeScript compilation, and the production build.
- `bun run type-check`: run `tsc --noEmit`.
- `bun run format`: apply Prettier to `src/**/*.{ts,tsx,css,scss}`.

## Coding Style & Naming Conventions

Use 2-space indentation, semicolons, single quotes, ES5 trailing commas, and 100-character line width. Prefer typed React components and avoid new `any` unless it marks a boundary. Use the `@/` alias for `src` imports. Component files use PascalCase, hooks use `useName`, API modules use domain names such as `oauth.ts`, and SCSS Modules sit beside their page or component as `Name.module.scss`.

## Testing Guidelines

Tests use Bun's built-in test runner and are colocated under `tests/` as `*.test.ts`. Run `bun run test` for focused test work and `bun run verify` before handoff. Use `bun run type-check` as a fast standalone TypeScript check. For UI changes, verify the affected route in the browser and include screenshots or notes.

## Commit & Pull Request Guidelines

Git history follows Conventional Commit style, for example `feat: add support for xAI provider`, `fix(auth-files): keep disabled card actions visible`, and `ci: use node 24 for releases`. Keep commits focused and scoped when useful. Pull requests should include a change summary, linked issue when applicable, UI screenshots, backend version or reproduction details for integration work, and verification notes.

## Architecture & Configuration Notes

This UI is not the proxy; it talks to the backend Management API under `/v0/management`. Treat backend contracts as the source of truth. For OAuth/provider changes, inspect `../CLIProxyAPI` before changing route names, provider keys, callback parameters, or auth-file semantics. Store no secrets in the repo; management keys are entered at runtime and persisted only in browser storage.
