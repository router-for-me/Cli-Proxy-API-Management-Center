# Cli-Proxy-API-Management-Center
This is a modern web interface for managing the CLI Proxy API.

Main Project:
https://github.com/router-for-me/CLIProxyAPI

Minimum required version: ≥ 5.0.0
Recommended version: ≥ 5.1.1

## Features

### Authentication Management
- Supports management key authentication
- Configurable API base address
- Real-time connection status detection

### Basic Settings
- **Debug Mode**: Enable/disable debugging
- **Proxy Settings**: Configure proxy server URL
- **Request Retries**: Set the number of request retries
- **Quota Management**: Configure behavior when the quota is exceeded
- **Local Access**: Manage local unauthenticated access

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


## How to Use

### 1. Direct Use (Recommended)
Simply open the `index.html` file directly in your browser to use it.

### 2. Use a Local Server
```bash
# Install dependencies
npm install

# Start the server on the default port (3000)
npm start
```

### 3. Configure API Connection
1. Open the management interface.
2. On the login screen, enter:
   - **Remote Address**: `http://localhost:8317` (`/v0/management` will be auto-completed for you)
   - **Management Key**: Your management key
3. Click the "Connect" button.
4. Once connected successfully, all features will be available.

## Interface Description

### Navigation Menu
- **Basic Settings**: Basic configurations like debugging, proxy, retries, etc.
- **API Keys**: Management of keys for various API services.
- **AI Providers**: Configuration for AI service providers.
- **Auth Files**: Upload and download management for authentication files.
- **System Info**: Connection status and system information.

## Feature Highlights

### Modern UI
- Responsive design, supports all screen sizes
- Beautiful gradient colors and shadow effects
- Smooth animations and transition effects
- Intuitive icons and status indicators

### Real-time Updates
- Configuration changes take effect immediately
- Real-time status feedback
- Automatic data refresh

### Security Features
- Masked display for keys

### Responsive Design
- Perfectly adapts to desktop and mobile devices
- Adaptive layout
- Touch-friendly interactions

## Tech Stack

- **Frontend**: Plain HTML, CSS, JavaScript
- **Styling**: CSS3 + Flexbox/Grid
- **Icons**: Font Awesome 6.4.0
- **Fonts**: Segoe UI system font
- **API**: RESTful API calls

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
├── index.html      # Main page
├── styles.css      # Stylesheet
├── app.js          # Application logic
├── package.json    # Project configuration
├── i18n.js         # Internationalization support
└── README.md       # README document
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