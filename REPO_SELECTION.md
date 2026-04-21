# Repository Selection Matrix

This repository is optional in most setups.

## Default choice

Start with:
- `https://github.com/luyuehm/CLIProxyAPI`

Use this repository additionally when you need:
- a dedicated browser Management Center UI
- frontend development for the Management API UI itself

## Matrix

| Scenario | Required repo | Optional repo |
|---|---|---|
| I want the service/backend fork | `luyuehm/CLIProxyAPI` | — |
| I want OpenClaw autonomy/self-heal/bootstrap | `luyuehm/CLIProxyAPI` | — |
| I want the Management UI in browser | `luyuehm/CLIProxyAPI` | `luyuehm/Cli-Proxy-API-Management-Center` |
| I am only working on the UI project | — | `luyuehm/Cli-Proxy-API-Management-Center` |
| I want a full operator stack | `luyuehm/CLIProxyAPI` | `luyuehm/Cli-Proxy-API-Management-Center` |
