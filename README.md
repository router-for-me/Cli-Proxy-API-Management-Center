# CLI Proxy API Management Center

[中文文档](README_CN.md)

A single-file Web UI for **CLI Proxy API (CPA)** plus an optional **Usage Service** for persistent usage analytics.

Since v6.10.0, CPA no longer includes built-in usage statistics. This project now supports usage analytics through a long-running Usage Service that consumes the CPA usage queue, persists request events to SQLite, and exposes panel-compatible usage APIs.

- **CPA Main project**: https://github.com/router-for-me/CLIProxyAPI
- **Recommended CPA version**: >= v6.10.8

## Panel Preview

![Account overview table mode showing compact rows, expanded quota details, token structure, and model usage](img/screenshot-20260511-203755.png)
![Account overview card mode showing health metrics, token usage, Codex quota, and model Top 2 details](img/screenshot-20260511-203905.png)
![Account overview card grid showing multiple account health and token usage summaries](img/screenshot-20260511-203945.png)
![Realtime monitoring table showing request status, latency, token usage, and cost](img/screenshot-20260509-105807.png)
![Codex account inspection progress with live probe logs and cleanup recommendations](img/screenshot-20260509-113713.png)

## What This Provides

- A single-file React management panel for CPA Management API (`/v0/management`)
- A Dockerized Usage Service for SQLite-backed usage persistence
- Native `amd64` and `arm64` packages for Windows, macOS, and Linux with the panel embedded
- Two deployment modes:
  - **Full Docker mode**: open the built-in panel from Usage Service and only enter the CPA URL + Management Key
  - **CPA panel mode**: keep using CPA's `/management.html`, then configure a separately deployed Usage Service inside the panel
- Runtime monitoring, account/model/channel breakdowns, model pricing, estimated token cost, imports/exports, auth-file operations, quota views, logs, config editing, and system utilities

## Choose a Deployment Mode

| Mode | Entry URL | What the user configures | Best for |
|---|---|---|---|
| Full Docker mode | `http://<host>:18317/management.html` | CPA URL + Management Key on login | New deployments, one entry point, least browser/CORS complexity |
| CPA panel mode | `http://<cpa-host>:8317/management.html` | Usage Service URL under **Configuration -> CPA-Manager Configuration** | Existing CPA automatic panel loading |
| Frontend only | Vite dev server or `dist/index.html` | CPA URL, optionally Usage Service URL | Development |

Full Docker mode does not bundle CPA itself. CPA still runs as the upstream service; the Docker image provides the Usage Service plus an embedded copy of this management panel.

## CPA Prerequisites

Request statistics require the CPA usage queue:

- CPA Management must be enabled because the usage queue uses the same availability and Management Key as `/v0/management`.
- Request monitoring requires CPA usage publishing: set `usage-statistics-enabled: true`, or submit `{ "value": true }` to `PUT /usage-statistics-enabled`. CPA-Manager enables this automatically when request monitoring is enabled during setup or configuration save.
- Disabling CPAM request monitoring only stops the Usage Service collector. It does not automatically disable CPA usage publishing or clear the CPA usage queue. If CPA usage publishing remains enabled, re-enabling request monitoring within the queue retention window may collect events retained while the collector was stopped.
- CPA `v6.10.8+` is preferred because it exposes the HTTP usage queue endpoint `/v0/management/usage-queue`, which can pass through regular HTTP reverse proxies.
- Older CPA versions use the RESP queue protocol. Usage Service falls back to RESP in `auto` mode when the HTTP queue endpoint is unavailable. RESP listens on the CPA API port, usually `8317`, and cannot pass through a regular HTTP reverse proxy.
- CPA keeps queue items in memory for `redis-usage-queue-retention-seconds`, default `60` seconds and maximum `3600` seconds. Keep Usage Service running continuously.
- Usage Service `pollIntervalMs` must be less than or equal to the CPA queue retention window converted to milliseconds. Saves are rejected when the collector would poll too slowly and risk expired queue items.
- Exactly one Usage Service should consume the same CPA usage queue.

## Architecture

### Full Docker Mode

```text
Browser
  -> Usage Service :18317
      -> built-in management.html
      -> /v0/management/usage and /v0/management/model-prices from SQLite
      -> other /v0/management/* proxied to CPA
      -> HTTP/RESP consumer -> CPA API port
      -> SQLite /data/usage.sqlite
```

The login page detects that it is hosted by Usage Service. You enter the CPA URL, Management Key, and choose whether to enable request monitoring. When monitoring is enabled, you also set the collector polling interval; Usage Service validates the CPA Management API, enables CPA usage publishing, checks that the poll interval does not exceed the CPA queue retention window, stores CPA-Manager configuration in SQLite, starts the collector with the configured mode (`auto` by default: HTTP queue first, RESP fallback), and serves the panel from the same origin. When monitoring is disabled, the CPA connection is still saved for Management API proxying, but CPA usage publishing and the collector stay off.

### CPA Panel Mode

```text
Browser
  -> CPA /management.html
      -> normal CPA Management API calls stay on CPA
      -> usage calls go to configured Usage Service URL

Usage Service
  -> HTTP/RESP consumer -> CPA API port
  -> SQLite /data/usage.sqlite
```

Use this when CPA still auto-downloads and serves the panel. Request monitoring is optional; when Usage Service is not deployed, the panel hides the request monitoring entry and direct visits to the monitoring page show a setup hint. To use request monitoring, deploy Usage Service separately, then open **Configuration -> CPA-Manager Configuration**, enable it, enter the Usage Service URL, and save.

## Quick Start: Full Docker Mode

### Docker Hub Image

```bash
docker run -d \
  --name cpa-manager \
  --restart unless-stopped \
  -p 18317:18317 \
  -v cpa-manager-data:/data \
  seakee/cpa-manager:latest
```

Open:

```text
http://<host>:18317/management.html
```

Enter:

- CPA URL:
  - Docker Desktop host CPA: `http://host.docker.internal:8317`
  - Same compose network: `http://cli-proxy-api:8317`
  - Remote CPA: `https://your-cpa.example.com`
- Management Key

The published image supports `linux/amd64` and `linux/arm64`. If your image is published under another Docker Hub namespace, replace `seakee/cpa-manager:latest`.

### Native Packages

GitHub Releases also provide native packages with the panel embedded:

- `cpa-manager_<version>_linux_amd64.tar.gz`
- `cpa-manager_<version>_linux_arm64.tar.gz`
- `cpa-manager_<version>_darwin_amd64.tar.gz`
- `cpa-manager_<version>_darwin_arm64.tar.gz`
- `cpa-manager_<version>_windows_amd64.zip`
- `cpa-manager_<version>_windows_arm64.zip`

macOS/Linux:

```bash
tar -xzf cpa-manager_vX.Y.Z_linux_amd64.tar.gz
cd cpa-manager_vX.Y.Z_linux_amd64
./cpa-manager
```

The tar archives preserve execute permissions, so no extra `chmod +x` is normally required after extraction. If macOS blocks the unsigned binary, run `xattr -dr com.apple.quarantine .` in the extracted directory and start it again.

Windows PowerShell:

```powershell
Expand-Archive .\cpa-manager_vX.Y.Z_windows_amd64.zip -DestinationPath .
cd .\cpa-manager_vX.Y.Z_windows_amd64
.\cpa-manager.exe
```

You can double-click `cpa-manager.exe` on Windows, but PowerShell is recommended because it keeps logs and startup errors visible.

Then open:

```text
http://<host>:18317/management.html
```

Native packages do not include CPA itself. Run CPA separately, then enter the CPA URL and Management Key on the login page. Set `USAGE_DATA_DIR` or `USAGE_DB_PATH` only when you want to override the default data location.

On first start, if `USAGE_DATA_DIR` and `USAGE_DB_PATH` are not set, the native package creates `config.json` next to the binary and writes SQLite data to `data/usage.sqlite` in the same directory. The extracted package directory therefore contains both the program and its user data.

### Docker Compose

```yaml
services:
  cpa-manager:
    image: seakee/cpa-manager:latest
    restart: unless-stopped
    ports:
      - "18317:18317"
    volumes:
      - cpa-manager-data:/data

volumes:
  cpa-manager-data:
```

Start:

```bash
docker compose up -d
```

### Linux Host CPA

If CPA runs directly on a Linux host and Usage Service runs in Docker, add a host gateway:

```bash
docker run -d \
  --name cpa-manager \
  --restart unless-stopped \
  --add-host=host.docker.internal:host-gateway \
  -p 18317:18317 \
  -v cpa-manager-data:/data \
  seakee/cpa-manager:latest
```

Then enter `http://host.docker.internal:8317` as the CPA URL.

## Quick Start: CPA Panel Mode

1. Start CPA as usual and open:

   ```text
   http://<cpa-host>:8317/management.html
   ```

2. Deploy Usage Service:

   ```bash
   docker run -d \
     --name cpa-manager \
     --restart unless-stopped \
     -p 18317:18317 \
     -v cpa-manager-data:/data \
     seakee/cpa-manager:latest
   ```

3. In the CPA panel, go to:

   ```text
   Configuration -> CPA-Manager Configuration
   ```

4. Enable it and enter:

   ```text
   http://<usage-service-host>:18317
   ```

5. Save the CPA-Manager configuration.

The panel sends the current CPA URL and Management Key to Usage Service. After that, monitoring reads usage data from Usage Service while other management calls continue to use CPA.

## Build Locally

```bash
docker compose -f docker-compose.usage.yml up --build
```

This builds the React panel and embeds it into the Go Usage Service binary.

## Usage Service Configuration

Most users can configure CPA URL, Management Key, request monitoring enablement, collection mode, and polling interval from **Configuration -> CPA-Manager Configuration**. CPA-Manager configuration is persisted in SQLite. Environment variables are mainly for first bootstrap and unattended deployments.

| Variable | Default | Description |
|---|---:|---|
| `CPA_MANAGER_CONFIG` | empty | Optional config file path. When empty, native packages use `config.json` next to the binary |
| `HTTP_ADDR` | `0.0.0.0:18317` | Usage Service HTTP listen address |
| `USAGE_DB_PATH` | Docker: `/data/usage.sqlite`; native: `./data/usage.sqlite` | SQLite database path |
| `USAGE_DATA_DIR` | Docker: `/data`; native: `./data` | Base data directory when `USAGE_DB_PATH` is not overridden |
| `CPA_UPSTREAM_URL` | empty | Optional CPA base URL for unattended startup |
| `CPA_MANAGEMENT_KEY` | empty | Optional CPA Management Key for unattended startup |
| `CPA_MANAGEMENT_KEY_FILE` | `/run/secrets/cpa_management_key` | Optional file containing the Management Key |
| `USAGE_COLLECTOR_MODE` | `auto` | Collection mode: `auto` prefers the HTTP usage queue and falls back to RESP for older CPA; `http` forces HTTP; `resp` forces RESP |
| `USAGE_RESP_QUEUE` | `usage` | RESP key argument; CPA currently ignores it, leave the default unless upstream changes |
| `USAGE_RESP_POP_SIDE` | `right` | `right` uses `RPOP`; `left` uses `LPOP` |
| `USAGE_BATCH_SIZE` | `100` | Maximum queue records per pop |
| `USAGE_POLL_INTERVAL_MS` | `500` | Idle polling interval |
| `USAGE_QUERY_LIMIT` | `50000` | Maximum recent events returned through compatible `/usage` |
| `USAGE_CORS_ORIGINS` | `*` | Allowed browser origins for CPA panel mode |
| `USAGE_RESP_TLS_SKIP_VERIFY` | `false` | Skip TLS verification for RESP connection |
| `PANEL_PATH` | empty | Serve a custom `management.html` instead of the embedded one |

Startup configuration precedence is: environment variables > `config.json` > program defaults. Relative paths in the config file are resolved from the config file directory. The generated default config is:

```json
{
  "httpAddr": "0.0.0.0:18317",
  "dataDir": "./data"
}
```

If `CPA_UPSTREAM_URL` and `CPA_MANAGEMENT_KEY` are set, collection starts automatically on boot and the connection is shown as environment-managed in the panel. Otherwise, use the web panel setup flow; the result is saved to SQLite `settings.manager_config_v1`. The legacy `settings.setup` value is still written for compatibility and rollback.

### CPA vs CPA-Manager Configuration Boundary

- **CPA configuration**: `usage-statistics-enabled`, `redis-usage-queue-retention-seconds`, proxy, logging, routing, auth files, and related fields still belong to CPA and are managed by `/config` / `/config.yaml`.
- **CPA-Manager configuration**: CPA URL, Management Key, request monitoring enablement, Usage Service collection mode, `pollIntervalMs`, `batchSize`, `queryLimit`, and the CPA panel mode Usage Service bootstrap URL are persisted in Usage Service SQLite.
- The configuration panel shows CPA and CPA-Manager settings separately. Saving CPAM settings does not write to CPA `config.yaml`; enabling request monitoring calls CPA Management API to enable usage publishing, while disabling request monitoring only stops the CPAM collector.

### Migration Guide

1. Back up the Usage Service data directory, especially `/data/usage.sqlite`.
2. After upgrading, open **Configuration -> CPA-Manager Configuration** and verify the CPA URL, request monitoring switch, collection mode, and polling interval. Older stored configs without the switch are treated as monitoring enabled.
3. If an older version already saved CPA URL and Management Key through `/setup`, the service can read `settings.setup` as a fallback and writes the new `settings.manager_config_v1` structure on the next save.
4. If you use `CPA_UPSTREAM_URL` / `CPA_MANAGEMENT_KEY`, the connection remains environment-managed. To switch to panel persistence, remove those environment variables, restart, and save from the panel.
5. In CPA panel mode, the browser still needs the Usage Service URL before it can read that service's SQLite configuration. Once entered, the value is saved to SQLite and kept in local storage as bootstrap data.

## Data and Security Notes

- SQLite data is stored under `/data`; mount it to persistent storage.
- In full Docker mode, CPA URL and Management Key are stored in the SQLite `settings` table so collection can resume after restart.
- New versions prefer SQLite `settings.manager_config_v1`; legacy `settings.setup` is kept as compatibility data.
- Protect the `/data` volume. It contains usage metadata and the saved Management Key.
- Usage Service redacts key-like fields before storing raw JSON payload snapshots, but request metadata may still expose models, endpoints, account labels, and token usage.
- RESP queue consumption is pop-based. Do not run multiple Usage Service consumers against the same CPA instance.
- If Usage Service is down longer than CPA's queue retention window, that period's usage cannot be recovered without CPA-side persistence.
- If only the CPAM collector is stopped while CPA usage publishing remains enabled, restarting the collector within the retention window may consume queue items produced while collection was disabled.

## Runtime Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | Basic health check |
| `GET /status` | Collector, SQLite, event count, and error status |
| `GET /usage-service/info` | Allows the frontend to detect full Docker mode |
| `GET /usage-service/config` | Reads persistent CPA-Manager configuration and CPA usage publishing status |
| `PUT /usage-service/config` | Saves CPA-Manager configuration and restarts the collector when needed |
| `POST /setup` | Save CPA URL + Management Key and start collection |
| `GET /v0/management/usage` | Compatible usage payload for the panel |
| `GET /v0/management/usage/export` | Export usage events as JSONL |
| `POST /v0/management/usage/import` | Import JSONL usage events or legacy JSON snapshots |
| `GET /v0/management/model-prices` | Read SQLite-backed model pricing |
| `PUT /v0/management/model-prices` | Replace saved model pricing |
| `POST /v0/management/model-prices/sync` | Sync model prices from LiteLLM pricing metadata |
| `GET /models`, `GET /v1/models` | Proxy model-list requests to CPA after setup |
| `/v0/management/*` | Proxied to CPA except usage endpoints |

After setup, `/status`, usage, model-pricing, and `/v0/management/*` proxy endpoints require the same Management Key as a Bearer token.

Usage import accepts two file families: JSONL/NDJSON event files exported by Usage Service, and legacy JSON snapshots produced by older CPA `/usage/export`. Legacy JSON can be converted only when `usage.apis.*.models.*.details[]` request details are present. Files that contain only aggregate totals are rejected because request-level monitoring data cannot be reconstructed. Legacy import is a migration/recovery path, not a perfect continuation of newly collected Usage Service data: old files may miss metadata such as `api_key_hash`, channel, request ID, method/path, latency, cache tokens, or failure reason, so account matching, API Key level analysis, and detail accuracy may be lower. Importing legacy files affects totals, trend charts, and account/key breakdowns; use a test or backup database first when accuracy matters.

## Feature Overview

- **Dashboard**: connection state, backend version, quick health summary
- **Configuration**: visual/source editing for CPA configuration and separate CPA-Manager configuration
- **AI Providers**: Gemini, Codex, Claude, Vertex, OpenAI-compatible providers, and Ampcode
- **Auth Files**: upload, download, delete, status, OAuth exclusions, model aliases
- **Quota**: quota views for supported providers
- **Request Monitoring**: persisted usage KPIs, model/channel/account breakdowns, model pricing, estimated token cost, failure analysis, realtime tables
- **Codex Account Inspection**: batch probing and cleanup suggestions for Codex auth pools
- **Logs**: incremental file log reading and filtering
- **Management Center Info**: model list, version checks, and local state tools

## Development

Frontend:

```bash
npm install
npm run dev
npm run type-check
npm run lint
npm run build
```

Usage Service:

```bash
cd usage-service
go test ./...
go run ./cmd/cpa-manager
```

## Build and Release

- Vite builds a single-file `dist/index.html`.
- Tagging `vX.Y.Z` triggers `.github/workflows/release.yml`.
- The release workflow uploads `dist/management.html`, native packages, and `checksums.txt` to GitHub Releases.
- Native packages are published for `linux`, `darwin`, and `windows` on both `amd64` and `arm64`, with the management panel embedded.
- The same workflow builds `Dockerfile.usage-service` and pushes `seakee/cpa-manager`.
- The Docker image is published for `linux/amd64` and `linux/arm64`.
- The workflow syncs `README.md` to the Docker Hub overview.
- Required GitHub secrets:
  - `DOCKERHUB_USERNAME`
  - `DOCKERHUB_TOKEN`

## Troubleshooting

- **Cannot connect in full Docker mode**: verify the CPA URL from inside the Usage Service container. For host CPA on Linux, use `--add-host=host.docker.internal:host-gateway`.
- **Monitoring is empty**: enable CPA usage publishing, verify Usage Service `/status`, and confirm only one consumer is running.
- **`unsupported RESP prefix 'H'`**: upgrade CPA to `v6.10.8+` and keep the default `USAGE_COLLECTOR_MODE=auto` so Usage Service uses the HTTP usage queue first. On older CPA or forced RESP mode, the CPA URL must be a container/host direct address for port `8317`, not a regular HTTP reverse-proxy domain.
- **401 from Usage Service**: use the same Management Key that was saved during setup.
- **Docker panel shows stale data**: check `/status` for `lastConsumedAt`, `lastInsertedAt`, and `lastError`.
- **CPA panel mode has CORS errors**: set `USAGE_CORS_ORIGINS` to the CPA panel origin or keep the default `*` for private deployments.
- **Data disappears after container rebuild**: mount `/data` to a Docker volume or host directory.
- **Detailed FAQ**: see [FAQ and Troubleshooting](https://github.com/seakee/CPA-Manager/wiki/CPA-Manager-FAQ-and-Troubleshooting) or the [Chinese FAQ](https://github.com/seakee/CPA-Manager/wiki/CPA%E2%80%90Manager-%E5%B8%B8%E8%A7%81%E9%97%AE%E9%A2%98%E4%B8%8E%E8%A7%A3%E5%86%B3%E6%96%B9%E6%A1%88).

## References

- CLIProxyAPI: https://github.com/router-for-me/CLIProxyAPI
- Redis usage queue documentation: https://help.router-for.me/management/redis-usage-queue.html

## Acknowledgements

- Thanks to the upstream projects [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) and [Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center) for the foundation and inspiration.
- Thanks to the [Linux.do](https://linux.do/) community for project promotion and feedback.

## License

MIT
