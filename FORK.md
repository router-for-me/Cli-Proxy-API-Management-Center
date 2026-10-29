# akhial fork

This is the akhial fork of the CLI Proxy API Management Center: upstream plus
a short stack of fork commits (`git log --oneline upstream/main..main`). It adds
the prox shell theme, the pool quota forecast, the one-line account grid, the
`weekly-reset-weighted-round-robin` routing option, its own dashboard (the
upstream `DashboardPage` stays in the tree but is no longer routed) and a plain
loading screen.

The forecast needs the backend fork's `GET /v8/management/quota/history`
(github.com/akhial/CLIProxyAPI).

Syncing with upstream, release builds and deployment are covered for both forks
in the backend repository's
[`fork/PLAYBOOK.md`](https://github.com/akhial/CLIProxyAPI/blob/main/fork/PLAYBOOK.md).
In short:

```sh
/srv/work/code/akhial/CLIProxyAPI/fork/sync-upstream.sh /srv/work/code/akhial/Cli-Proxy-API-Management-Center
```

Fork-specific files: `src/styles/fork.scss`, `src/components/layout/ForkBrandLogo.tsx`,
`src/components/layout/BootLoader.*`, `src/features/dashboard/prox/`,
`src/landOnDashboard.ts`, `src/features/quota/forecast/`, `src/features/quota/accounts/`,
`src/features/quota/emailMask.ts`, `src/services/api/quotaHistory.ts`.

Edited upstream file worth checking on sync: `src/utils/quota/relativeTime.ts`
counts hours up to 48 ("in 46 hours", not "in 1 day"), so a weekly reset reads
clearly against the 36-hour priority window.

The dashboard's provider colors (`#d4734d` / `#5b88d6` dark, `#c2603d` / `#3f68b5`
light) pass the categorical palette checks (lightness band, chroma floor, colorblind
separation) against each theme's card surface; re-check them if the surfaces change.
