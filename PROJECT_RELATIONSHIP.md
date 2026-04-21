# Companion Project Relationship

This repository is the companion Management UI for CLIProxyAPI.

## Primary companion repository

- Service + OpenClaw autonomy fork:
  - https://github.com/luyuehm/CLIProxyAPI

## Role of this repository

This repository provides the human-facing Management API UI:
- config editing
- credentials/auth file handling
- usage and quota views
- log viewing
- interactive troubleshooting

It does **not** provide the OpenClaw autonomy/governance layer by itself.

## If you need automation

For heartbeat, self-heal, cron templates, OpenClaw installation, bootstrap docs, and fork sync maintenance, see the companion repository above.


## Do you need both repositories?

Not always.

### If you only need the UI
You can use this repository alone for Management API frontend development.

### If you need a real deployable/operator setup
You should also use the companion repository:
- https://github.com/luyuehm/CLIProxyAPI

Recommended default:
- required main repo: `luyuehm/CLIProxyAPI`
- optional UI companion: `luyuehm/Cli-Proxy-API-Management-Center`


## Repository selection

See `REPO_SELECTION.md` for a scenario-based selection matrix.
