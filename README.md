# Cli-Proxy-API-Management-Center
This is a modern web interface for managing the CLI Proxy API.

[中文文档](README_CN.md)

Main Project:
https://github.com/router-for-me/CLIProxyAPI

Example URL:
https://remote.router-for.me/

Minimum required version: ≥ 6.0.0
Recommended version: ≥ 6.1.3

Since version 6.0.19, the WebUI has been rolled into the main program. You can access it by going to `/management.html` on the external port after firing up the main project.

## Features

### Authentication Management
- Supports management key authentication
- Configurable API base address
- Real-time connection status detection
- Auto-login with saved credentials
- Language and theme switching

### Basic Settings
- **Debug Mode**: Enable/disable debugging
- **Proxy Settings**: Configure proxy server URL
- **Request Retries**: Set the number of request retries
- **Quota Management**: Configure behavior when the quota is exceeded
  - Auto-switch project when quota exceeded
  - Switch to preview models when quota exceeded

### API Key Management
- **Proxy Service Authentication Key**: Manage API keys for the proxy service
- **Gemini API**: Manage Google Gemini generative language API keys
- **Codex API**: Manage OpenAI Codex API configuration
- **Claude API**: Manage Anthropic Claude API configuration
- **OpenAI-Compatible Providers**: Manage OpenAI-compatible third-party providers

### Authentication File Management
- Upload authentication JSON files
- Download existing authentication files
- Delete single or all authentication files
- Display file details
- **Gemini Web Token**: Direct authentication using browser cookies

### Usage Statistics
- **Real-time Analytics**: Track API usage with interactive charts
- **Request Trends**: Visualize request patterns by hour/day
- **Token Usage**: Monitor token consumption over time
- **API Details**: Detailed statistics for each API endpoint
- **Success/Failure Rates**: Track API reliability metrics

### System Information
- **Connection Status**: Real-time connection monitoring
- **Configuration Status**: Track configuration loading state
- **Server Information**: Display server address and management key
- **Last Update**: Show when data was last refreshed


## How to Use

### 1. Using After CLI Proxy API Program Launch (Recommended)
Once the CLI Proxy API program is up and running, you can access the WebUI at `http://your-server-IP:8317/management.html`.

### 2. Direct Use
Simply open the `index.html` file directly in your browser to use it.

### 3. Use a Local Server

#### Option A: Using Node.js (npm)
```bash
# Install dependencies
npm install

# Start the server on the default port (3000)
npm start
```

#### Option B: Using Python
```bash
# Python 3.x
python -m http.server 8000

```

Then open `http://localhost:8000` in your browser.

### 3. Configure Connection
1. Open the management interface.
2. On the login screen, enter:
   - **Remote Address**: The current version automatically picks up the remote address from where you're connecting. But you can also set your own address if you prefer.
   - **Management Key**: Your management key
3. Click the "Connect" button.
4. Once connected successfully, all features will be available.

## Interface Description

### Navigation Menu
- **Basic Settings**: Basic configurations like debugging, proxy, retries, etc.
- **API Keys**: Management of keys for various API services.
- **AI Providers**: Configuration for AI service providers.
- **Auth Files**: Upload and download management for authentication files.
- **Usage Stats**: Real-time analytics and usage statistics with interactive charts.
- **System Info**: Connection status and system information.

### Login Interface
- **Auto-connection**: Automatically attempts to connect using saved credentials
- **Custom Connection**: Manual configuration of API base address
- **Current Address Detection**: Automatically detects and uses current access address
- **Language Switching**: Support for multiple languages (English/Chinese)
- **Theme Switching**: Light and dark theme support

## Feature Highlights

### Modern UI
- Responsive design, supports all screen sizes
- Beautiful gradient colors and shadow effects
- Smooth animations and transition effects
- Intuitive icons and status indicators
- Dark/Light theme support with system preference detection
- Mobile-friendly sidebar with overlay

### Real-time Updates
- Configuration changes take effect immediately
- Real-time status feedback
- Automatic data refresh
- Live usage statistics with interactive charts
- Real-time connection status monitoring

### Security Features
- Masked display for keys
- Secure credential storage
- Auto-login with encrypted local storage

### Responsive Design
- Perfectly adapts to desktop and mobile devices
- Adaptive layout with collapsible sidebar
- Touch-friendly interactions
- Mobile menu with overlay

### Analytics & Monitoring
- Interactive charts powered by Chart.js
- Real-time usage statistics
- Request trend visualization
- Token consumption tracking
- API performance metrics

## Tech Stack

- **Frontend**: Plain HTML, CSS, JavaScript (ES6+)
- **Styling**: CSS3 + Flexbox/Grid with CSS Variables
- **Icons**: Font Awesome 6.4.0
- **Charts**: Chart.js for interactive data visualization
- **Fonts**: Segoe UI system font
- **API**: RESTful API calls with automatic authentication
- **Internationalization**: Custom i18n system with English/Chinese support
- **Theme System**: CSS custom properties for dynamic theming
- **Storage**: LocalStorage for user preferences and credentials

## Troubleshooting

### Connection Issues
1. Confirm that the CLI Proxy API service is running.
2. Check if the API address is correct.
3. Verify that the management key is valid.
4. Ensure your firewall settings allow the connection.

### Data Not Updating
1. Click the "Refresh All" button.
2. Check your network connection.
3. Check the browser's console for any error messages.

## Development Information

### File Structure
```
webui/
├── index.html          # Main page with responsive layout
├── styles.css          # Stylesheet with theme support
├── app.js              # Application logic and API management
├── i18n.js             # Internationalization support (EN/CN)
├── package.json        # Project configuration
├── build.js            # Build script for production
├── bundle-entry.js     # Entry point for bundling
├── build-scripts/      # Build utilities
│   └── prepare-html.js # HTML preparation script
├── logo.jpg            # Application logo
├── LICENSE             # MIT License
├── README.md           # English documentation
├── README_CN.md        # Chinese documentation
└── BUILD_RELEASE.md    # Build and release notes
```

### API Calls
All API calls are handled through the `makeRequest` method of the `ManagerAPI` class, which includes:
- Automatic addition of authentication headers
- Error handling
- JSON response parsing

### State Management
- API address and key are saved in local storage
- Connection status is maintained in memory
- Real-time data refresh mechanism

## Contributing
We welcome Issues and Pull Requests to improve this project! We encourage more developers to contribute to the enhancement of this WebUI!

This project is licensed under the MIT License.
