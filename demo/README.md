# Original-app Claude reset demo

Open `http://localhost:5179/demo/claude-reset.html#/quota` with Vite running on port 5179
(`bun run dev -- --host 127.0.0.1 --port 5179`).

This entry loads the real `src/main.tsx`, App, MainLayout and quota route. There is
no demo UI, toolbar or stylesheet. Four synthetic Claude accounts populate the
normal quota cards and timeline:

- `alex.max`: usable grant; confirmation clears usage and spends one reset.
- `design.team`: exhausted grant.
- `sam.free`: ineligible account.
- `retry.max`: first claim has an unknown outcome; retry must reuse its request ID.

Use the existing “储备重置次数” controls. Reload the page to reset all fixtures.
Other providers are intentionally empty. This is a quota-focused fixture, not a
complete mock of every route in the app; unsupported requests fail closed.

Before any application import, the HTML replaces local/session storage with
memory-only stores and blocks fetch/XHR. CSP permits only the local Vite socket.
The entry installs an Axios adapter before loading the API client. All mock
credentials use `example.invalid`; no real management key is supplied. Both the
initial quota cache and refresh actions use the real quota parser and API modules.

Regression check: `bun test demo/claude-reset-mocks.test.ts`.
