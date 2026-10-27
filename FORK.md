# akhial fork

This is the akhial fork of the CLI Proxy API Management Center: upstream plus
a short stack of fork commits (`git log --oneline upstream/main..main`). It adds
the prox shell theme, the pool quota forecast, the one-line account grid and the
`weekly-reset-weighted-round-robin` routing option.

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
`src/features/quota/forecast/`, `src/features/quota/accounts/`,
`src/features/quota/emailMask.ts`, `src/services/api/quotaHistory.ts`.
