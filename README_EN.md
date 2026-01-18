# CLI Proxy API Management Center (CPAMC)

> A Web management interface based on the official repository with custom modifications

**[English](README_EN.md) | [中文](README.md)**

---

## About This Project

This project is a log monitoring and data visualization management interface developed based on the official [CLI Proxy API WebUI](https://github.com/router-for-me/Cli-Proxy-API-Management-Center)

### Differences from Official Version

This version is consistent with the official version in other functions, with the main difference being the **new monitoring center**, which enhances log analysis and viewing

### Interface Preview

Management interface display

![Dashboard Preview](dashboard-preview.png)

---

## Quick Start

### Using This Management Interface

Modify following configuration in your `config.yaml`:

```yaml
remote-management:
  panel-github-repository: "https://github.com/kongkongyo/CLIProxyAPI-Web-Dashboard"
```

After configuration, restart the CLI Proxy API service and visit `http://<host>:<api_port>/management.html` to view the management interface

For detailed configuration instructions, please refer to the official documentation: https://help.router-for.me/cn/management/webui.html

---

## Main Features

### Monitoring Center - Core New Feature

This is the only new feature of this management interface compared to the official version, providing comprehensive data visualization and monitoring capabilities

> Note: The CLI Proxy API main program currently does not have data persistence functionality. Statistical data will be lost after restarting the program. You need to use related services through the API first to generate data before you can see statistical information in the monitoring center.

#### KPI Dashboard

Real-time display of core operational metrics, supports filtering by time range:
- **Request Count**: Total requests, success/failure statistics, success rate percentage
- **Token Count**: Total tokens, input tokens, output tokens
- **Average TPM**: Tokens per minute
- **Average RPM**: Requests per minute
- **Average RPD**: Daily average requests

All metrics are dynamically calculated and updated in real-time based on the selected time range (today/7 days/14 days/30 days)

#### Model Usage Distribution

Intuitive pie chart showing the usage distribution of different models:
- Distribution by request count
- Distribution by token count
- Switchable between request percentage and token percentage

#### Daily Trend Analysis

Detailed time series charts showing daily usage trends:
- Request count trend curve
- Input token trend
- Output token trend
- Thinking token trend (if supported)
- Cache token trend

#### Hourly Analysis

Two detailed hourly charts to help identify peak periods:

**Hourly Model Request Distribution**
- Bar chart showing requests for different models in each hour
- Supports switching between recent 6 hours/12 hours/24 hours/all views

**Hourly Token Usage**
- Stacked bar chart showing token usage composition
- Distinguishes between input tokens, output tokens, thinking tokens, cache tokens

#### Channel Statistics

Detailed table showing usage of each channel (API Key/model):
- Filter by all channels/specific channel
- Filter by all models/specific model
- Filter by all status/success only/failure only
- Display channel name, request count, success rate
- Click to expand and view detailed statistics of each model under that channel
- Display recent request status (mini status bar of recent 10 requests)
- Most recent request time

#### Failure Source Analysis

Help locate problematic channels and models:
- Statistics of failure counts by channel
- Display most recent failure time
- List of main failed models
- Click to expand and view all failed request details under that channel

#### Request Logs - Advanced Feature

Powerful request log table, supports smooth browsing of massive data

**Multi-dimensional Filtering**
- Filter by API Key
- Filter by provider type (OpenAI/Gemini/Claude, etc.)
- Filter by model name
- Filter by source channel
- Filter by request status (all/success/failure)

**Independent Time Range**
- Supports today/7 days/14 days/30 days/custom date range
- Independent control from main page time range

**Virtual Scrolling**
- Supports smooth browsing of 100,000+ logs
- Display current visible range statistics
- Performance optimized, only renders visible rows

**Smart Information Display**
- Automatically match API Key to provider name (based on configuration)
- Complete channel information (provider name + masked key)
- Request type/model name/request status
- Status visualization of recent 10 requests (green dot=success, red dot=failure)
- Success rate percentage
- Total requests/input tokens/output tokens/total tokens
- Request time (complete timestamp)

**Auto Refresh**
- Supports manual refresh / 5s / 10s / 15s / 30s / 60s auto refresh
- Countdown display for next refresh time
- Independent data loading, does not block main page

**One-click Disable Model**
- Supports directly disabling a specific model of a channel in logs
- Only effective for channel types that support this operation
- Shows prompt and manual operation guide when not supported

---

## Official Version Features

The following features are consistent with the official version, providing a better user experience through an improved interface

### Dashboard
- Real-time connection status monitoring
- Server version and build information at a glance
- Quick overview of usage data
- Available model statistics

### API Key Management
- Add, edit, delete API keys
- Manage proxy service authentication

### AI Provider Configuration
- **Gemini**: API key management, model exclusion, model prefix
- **Claude**: API key and configuration, custom model list
- **Codex**: Complete configuration management (API key, Base URL, proxy)
- **Vertex**: Model mapping configuration
- **OpenAI Compatible**: Multi-key management, model alias import, connectivity testing
- **Ampcode**: Upstream integration and model mapping

### Authentication File Management
- Upload, download, delete JSON authentication files
- Supports multiple providers (Qwen, Gemini, Claude, etc.)
- Search, filter, paginated browsing
- View models supported by each credential

### OAuth Login
- One-click start OAuth authorization flow
- Supports Codex, Anthropic, Gemini CLI, Qwen, iFlow, etc.
- Automatically save authentication files
- Supports remote browser callback submission

### Quota Management
- Antigravity quota query
- Codex quota query (5 hours, weekly limit, code review)
- Gemini CLI quota query
- One-click refresh all quotas

### Usage Statistics
- Request/Token trend charts
- Detailed statistics by model and API
- RPM/TPM real-time rates
- Cache and reasoning token breakdown
- Cost estimation (supports custom prices)

### Configuration Management
- Online editing of `config.yaml`
- YAML syntax highlighting
- Search and navigation
- Save and reload configuration

### Log Viewing
- Real-time log stream
- Search and filtering
- Auto refresh
- Download error logs
- Mask management traffic

### Center Information
- Connection status check
- Version update check
- Available model list display
- Quick link entry

---

## Connection Instructions

### API Address Format

The following formats are all supported, and the system will automatically recognize them

```
localhost:8317
http://192.168.1.10:8317
https://example.com:8317
```

### Management Key

The management key is the key for verifying management operations and is different from the API key used by clients

### Remote Management

When accessing from a non-local browser, you need to enable remote management on the server (`allow-remote-management: true`)

---

## Interface Features

### Theme Switching
- Light mode
- Dark mode
- Follow system

### Language Support
- Simplified Chinese
- English

### Responsive Design
- Full functionality on desktop
- Mobile-adapted experience
- Collapsible sidebar

---

## FAQ

**Q: How to use this custom UI?**

A: Add the following configuration to your CLI Proxy API configuration file
```yaml
remote-management:
  panel-github-repository: "https://github.com/kongkongyo/CLIProxyAPI-Web-Dashboard"
```

**Q: Cannot connect to the server?**

A: Please check the following
- Is the API address correct?
- Is the management key correct?
- Is the server started?
- Is remote access enabled?

**Q: Log page not displaying?**

A: You need to enable the "Log to file" function in "Basic Settings"

**Q: Some functions show "not supported"?**

A: The server version may be too old. Upgrade to the latest version of CLI Proxy API

**Q: OpenAI provider test failed?**

A: Tests are executed in the browser and may be subject to CORS restrictions. Failure does not necessarily mean it won't work on the server side

**Q: What is the difference between this version and the official version?**

A: There are two main differences:
1. **Interface Style**: Completely new visual design with more refined UI details
2. **Monitoring Center**: This is the only newly added feature module, providing powerful data visualization and monitoring capabilities, including KPI dashboard, model usage distribution, trend analysis, hourly charts, channel statistics, failure analysis, and advanced request logs

All other features remain consistent with the official version

---

## Related Links

- **Official Main Program**: https://github.com/router-for-me/CLIProxyAPI
- **Official WebUI**: https://github.com/router-for-me/Cli-Proxy-API-Management-Center
- **This Repository**: https://github.com/kongkongyo/CLIProxyAPI-Web-Dashboard

## License

MIT License
