// 模块导入
import { themeModule } from './src/modules/theme.js';
import { navigationModule } from './src/modules/navigation.js';
import { languageModule } from './src/modules/language.js';
import { loginModule } from './src/modules/login.js';
import { configEditorModule } from './src/modules/config-editor.js';
import { logsModule } from './src/modules/logs.js';
import { apiKeysModule } from './src/modules/api-keys.js';
import { authFilesModule } from './src/modules/auth-files.js';
import { oauthModule } from './src/modules/oauth.js';
import { usageModule } from './src/modules/usage.js';
import { settingsModule } from './src/modules/settings.js';
import { aiProvidersModule } from './src/modules/ai-providers.js';

// 工具函数导入
import { escapeHtml } from './src/utils/html.js';
import { maskApiKey } from './src/utils/string.js';
import { normalizeArrayResponse } from './src/utils/array.js';
import { debounce } from './src/utils/dom.js';
import {
    CACHE_EXPIRY_MS,
    MAX_LOG_LINES,
    DEFAULT_AUTH_FILES_PAGE_SIZE,
    MIN_AUTH_FILES_PAGE_SIZE,
    MAX_AUTH_FILES_PAGE_SIZE,
    OAUTH_CARD_IDS,
    STORAGE_KEY_AUTH_FILES_PAGE_SIZE,
    NOTIFICATION_DURATION_MS
} from './src/utils/constants.js';

// 核心服务导入
import { createErrorHandler } from './src/core/error-handler.js';
import { connectionModule } from './src/core/connection.js';

// CLI Proxy API 管理界面 JavaScript
class CLIProxyManager {
    constructor() {
        // 仅保存基础地址（不含 /v0/management），请求时自动补齐
        const detectedBase = this.detectApiBaseFromLocation();
        this.apiBase = detectedBase;
        this.apiUrl = this.computeApiUrl(this.apiBase);
        this.managementKey = '';
        this.isConnected = false;
        this.isLoggedIn = false;
        this.uiVersion = null;
        this.serverVersion = null;
        this.serverBuildDate = null;

        // 配置缓存 - 改为分段缓存
        this.configCache = {};  // 改为对象，按配置段缓存
        this.cacheTimestamps = {};  // 每个配置段的时间戳
        this.cacheExpiry = CACHE_EXPIRY_MS;

        // 状态更新定时器
        this.statusUpdateTimer = null;

        // 日志自动刷新定时器
        this.logsRefreshTimer = null;

        // 当前展示的日志行
        this.displayedLogLines = [];
        this.maxDisplayLogLines = MAX_LOG_LINES;

        // 日志时间戳（用于增量加载）
        this.latestLogTimestamp = null;

        // Auth file filter state cache
        this.currentAuthFileFilter = 'all';
        this.cachedAuthFiles = [];
        this.authFilesPagination = {
            pageSize: DEFAULT_AUTH_FILES_PAGE_SIZE,
            currentPage: 1,
            totalPages: 1
        };
        this.authFileStatsCache = {};
        this.authFileSearchQuery = '';
        this.authFilesPageSizeKey = STORAGE_KEY_AUTH_FILES_PAGE_SIZE;
        this.loadAuthFilePreferences();

        // Vertex AI credential import state
        this.vertexImportState = {
            file: null,
            loading: false,
            result: null
        };

        // 主题管理
        this.currentTheme = 'light';

        // 配置文件编辑器状态
        this.configYamlCache = '';
        this.isConfigEditorDirty = false;
        this.configEditorElements = {
            textarea: null,
            editorInstance: null,
            saveBtn: null,
            reloadBtn: null,
            statusEl: null
        };
        this.lastConfigFetchUrl = null;
        this.lastEditorConnectionState = null;

        // 初始化错误处理器
        this.errorHandler = createErrorHandler((message, type) => this.showNotification(message, type));

        this.init();
    }

    loadAuthFilePreferences() {
        try {
            if (typeof localStorage === 'undefined') {
                return;
            }
            const savedPageSize = parseInt(localStorage.getItem(this.authFilesPageSizeKey), 10);
            if (Number.isFinite(savedPageSize)) {
                this.authFilesPagination.pageSize = this.normalizeAuthFilesPageSize(savedPageSize);
            }
        } catch (error) {
            console.warn('Failed to restore auth file preferences:', error);
        }
    }

    normalizeAuthFilesPageSize(value) {
        const defaultSize = DEFAULT_AUTH_FILES_PAGE_SIZE;
        const minSize = MIN_AUTH_FILES_PAGE_SIZE;
        const maxSize = MAX_AUTH_FILES_PAGE_SIZE;
        const parsed = parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return defaultSize;
        }
        return Math.min(maxSize, Math.max(minSize, parsed));
    }

    init() {
        this.initUiVersion();
        this.initializeTheme();
        this.checkLoginStatus();
        this.bindEvents();
        this.setupNavigation();
        this.setupLanguageSwitcher();
        this.setupThemeSwitcher();
        this.setupConfigEditor();
        this.updateConfigEditorAvailability();
        // loadSettings 将在登录成功后调用
        this.updateLoginConnectionInfo();
        // 检查主机名，如果不是 localhost 或 127.0.0.1，则隐藏 OAuth 登录框
        this.checkHostAndHideOAuth();
    }

    // 检查主机名并隐藏 OAuth 登录框
    checkHostAndHideOAuth() {
        const hostname = window.location.hostname;
        const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

        if (!isLocalhost) {
            // 隐藏所有 OAuth 登录卡片
            OAUTH_CARD_IDS.forEach(cardId => {
                const card = document.getElementById(cardId);
                if (card) {
                    card.style.display = 'none';
                }
            });

            // 如果找不到具体的卡片 ID，尝试通过类名查找
            const oauthCardElements = document.querySelectorAll('.card');
            oauthCardElements.forEach(card => {
                const cardText = card.textContent || '';
                if (cardText.includes('Codex OAuth') ||
                    cardText.includes('Anthropic OAuth') ||
                    cardText.includes('Gemini CLI OAuth') ||
                    cardText.includes('Qwen OAuth') ||
                    cardText.includes('iFlow OAuth')) {
                    card.style.display = 'none';
                }
            });

            console.log(`当前主机名: ${hostname}，已隐藏 OAuth 登录框`);
        }
    }

    // 检查登录状态
    // 处理登录表单提交
    // 事件绑定
    bindEvents() {
        // 登录相关（安全绑定）
        const loginSubmit = document.getElementById('login-submit');
        const logoutBtn = document.getElementById('logout-btn');

        if (loginSubmit) {
            loginSubmit.addEventListener('click', () => this.handleLogin());
        }
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }

        // 密钥可见性切换事件
        this.setupKeyVisibilityToggle();

        // 主页面元素（延迟绑定，在显示主页面时绑定）
        this.bindMainPageEvents();
    }

    // 设置密钥可见性切换
    setupKeyVisibilityToggle() {
        const toggleButtons = document.querySelectorAll('.toggle-key-visibility');
        toggleButtons.forEach(button => {
            button.addEventListener('click', () => this.toggleLoginKeyVisibility(button));
        });
    }

    // 绑定主页面事件
    bindMainPageEvents() {
        // 连接状态检查
        const connectionStatus = document.getElementById('connection-status');
        const refreshAll = document.getElementById('refresh-all');

        if (connectionStatus) {
            connectionStatus.addEventListener('click', () => this.checkConnectionStatus());
        }
        if (refreshAll) {
            refreshAll.addEventListener('click', () => this.refreshAllData());
        }

        // 基础设置
        const debugToggle = document.getElementById('debug-toggle');
        const updateProxy = document.getElementById('update-proxy');
        const clearProxy = document.getElementById('clear-proxy');
        const updateRetry = document.getElementById('update-retry');
        const switchProjectToggle = document.getElementById('switch-project-toggle');
        const switchPreviewToggle = document.getElementById('switch-preview-model-toggle');
        const usageStatisticsToggle = document.getElementById('usage-statistics-enabled-toggle');
        const requestLogToggle = document.getElementById('request-log-toggle');
        const wsAuthToggle = document.getElementById('ws-auth-toggle');

        if (debugToggle) {
            debugToggle.addEventListener('change', (e) => this.updateDebug(e.target.checked));
        }
        if (updateProxy) {
            updateProxy.addEventListener('click', () => this.updateProxyUrl());
        }
        if (clearProxy) {
            clearProxy.addEventListener('click', () => this.clearProxyUrl());
        }
        if (updateRetry) {
            updateRetry.addEventListener('click', () => this.updateRequestRetry());
        }
        if (switchProjectToggle) {
            switchProjectToggle.addEventListener('change', (e) => this.updateSwitchProject(e.target.checked));
        }
        if (switchPreviewToggle) {
            switchPreviewToggle.addEventListener('change', (e) => this.updateSwitchPreviewModel(e.target.checked));
        }
        if (usageStatisticsToggle) {
            usageStatisticsToggle.addEventListener('change', (e) => this.updateUsageStatisticsEnabled(e.target.checked));
        }
        if (requestLogToggle) {
            requestLogToggle.addEventListener('change', (e) => this.updateRequestLog(e.target.checked));
        }
        if (wsAuthToggle) {
            wsAuthToggle.addEventListener('change', (e) => this.updateWsAuth(e.target.checked));
        }

        // 日志记录设置
        const loggingToFileToggle = document.getElementById('logging-to-file-toggle');
        if (loggingToFileToggle) {
            loggingToFileToggle.addEventListener('change', (e) => this.updateLoggingToFile(e.target.checked));
        }

        // 日志查看
        const refreshLogs = document.getElementById('refresh-logs');
        const downloadLogs = document.getElementById('download-logs');
        const clearLogs = document.getElementById('clear-logs');
        const logsAutoRefreshToggle = document.getElementById('logs-auto-refresh-toggle');

        if (refreshLogs) {
            refreshLogs.addEventListener('click', () => this.refreshLogs());
        }
        if (downloadLogs) {
            downloadLogs.addEventListener('click', () => this.downloadLogs());
        }
        if (clearLogs) {
            clearLogs.addEventListener('click', () => this.clearLogs());
        }
        if (logsAutoRefreshToggle) {
            logsAutoRefreshToggle.addEventListener('change', (e) => this.toggleLogsAutoRefresh(e.target.checked));
        }

        // API 密钥管理
        const addApiKey = document.getElementById('add-api-key');
        const addGeminiKey = document.getElementById('add-gemini-key');
        const addCodexKey = document.getElementById('add-codex-key');
        const addClaudeKey = document.getElementById('add-claude-key');
        const addOpenaiProvider = document.getElementById('add-openai-provider');

        if (addApiKey) {
            addApiKey.addEventListener('click', () => this.showAddApiKeyModal());
        }
        if (addGeminiKey) {
            addGeminiKey.addEventListener('click', () => this.showAddGeminiKeyModal());
        }
        if (addCodexKey) {
            addCodexKey.addEventListener('click', () => this.showAddCodexKeyModal());
        }
        if (addClaudeKey) {
            addClaudeKey.addEventListener('click', () => this.showAddClaudeKeyModal());
        }
        if (addOpenaiProvider) {
            addOpenaiProvider.addEventListener('click', () => this.showAddOpenAIProviderModal());
        }


        // 认证文件管理
        const uploadAuthFile = document.getElementById('upload-auth-file');
        const deleteAllAuthFiles = document.getElementById('delete-all-auth-files');
        const authFileInput = document.getElementById('auth-file-input');

        if (uploadAuthFile) {
            uploadAuthFile.addEventListener('click', () => this.uploadAuthFile());
        }
        if (deleteAllAuthFiles) {
            deleteAllAuthFiles.addEventListener('click', () => this.deleteAllAuthFiles());
        }
        if (authFileInput) {
            authFileInput.addEventListener('change', (e) => this.handleFileUpload(e));
        }
        this.bindAuthFilesPaginationEvents();
        this.bindAuthFilesSearchControl();
        this.bindAuthFilesPageSizeControl();
        this.syncAuthFileControls();

        // Vertex AI credential import
        const vertexSelectFile = document.getElementById('vertex-select-file');
        const vertexFileInput = document.getElementById('vertex-file-input');
        const vertexImportBtn = document.getElementById('vertex-import-btn');

        if (vertexSelectFile) {
            vertexSelectFile.addEventListener('click', () => this.openVertexFilePicker());
        }
        if (vertexFileInput) {
            vertexFileInput.addEventListener('change', (e) => this.handleVertexFileSelection(e));
        }
        if (vertexImportBtn) {
            vertexImportBtn.addEventListener('click', () => this.importVertexCredential());
        }
        this.updateVertexFileDisplay();
        this.updateVertexImportButtonState();
        this.renderVertexImportResult(this.vertexImportState.result);

        // Codex OAuth
        const codexOauthBtn = document.getElementById('codex-oauth-btn');
        const codexOpenLink = document.getElementById('codex-open-link');
        const codexCopyLink = document.getElementById('codex-copy-link');

        if (codexOauthBtn) {
            codexOauthBtn.addEventListener('click', () => this.startCodexOAuth());
        }
        if (codexOpenLink) {
            codexOpenLink.addEventListener('click', () => this.openCodexLink());
        }
        if (codexCopyLink) {
            codexCopyLink.addEventListener('click', () => this.copyCodexLink());
        }

        // Anthropic OAuth
        const anthropicOauthBtn = document.getElementById('anthropic-oauth-btn');
        const anthropicOpenLink = document.getElementById('anthropic-open-link');
        const anthropicCopyLink = document.getElementById('anthropic-copy-link');

        if (anthropicOauthBtn) {
            anthropicOauthBtn.addEventListener('click', () => this.startAnthropicOAuth());
        }
        if (anthropicOpenLink) {
            anthropicOpenLink.addEventListener('click', () => this.openAnthropicLink());
        }
        if (anthropicCopyLink) {
            anthropicCopyLink.addEventListener('click', () => this.copyAnthropicLink());
        }

        // Gemini CLI OAuth
        const geminiCliOauthBtn = document.getElementById('gemini-cli-oauth-btn');
        const geminiCliOpenLink = document.getElementById('gemini-cli-open-link');
        const geminiCliCopyLink = document.getElementById('gemini-cli-copy-link');

        if (geminiCliOauthBtn) {
            geminiCliOauthBtn.addEventListener('click', () => this.startGeminiCliOAuth());
        }
        if (geminiCliOpenLink) {
            geminiCliOpenLink.addEventListener('click', () => this.openGeminiCliLink());
        }
        if (geminiCliCopyLink) {
            geminiCliCopyLink.addEventListener('click', () => this.copyGeminiCliLink());
        }

        // Qwen OAuth
        const qwenOauthBtn = document.getElementById('qwen-oauth-btn');
        const qwenOpenLink = document.getElementById('qwen-open-link');
        const qwenCopyLink = document.getElementById('qwen-copy-link');

        if (qwenOauthBtn) {
            qwenOauthBtn.addEventListener('click', () => this.startQwenOAuth());
        }
        if (qwenOpenLink) {
            qwenOpenLink.addEventListener('click', () => this.openQwenLink());
        }
        if (qwenCopyLink) {
            qwenCopyLink.addEventListener('click', () => this.copyQwenLink());
        }

        // iFlow OAuth
        const iflowOauthBtn = document.getElementById('iflow-oauth-btn');
        const iflowOpenLink = document.getElementById('iflow-open-link');
        const iflowCopyLink = document.getElementById('iflow-copy-link');

        if (iflowOauthBtn) {
            iflowOauthBtn.addEventListener('click', () => this.startIflowOAuth());
        }
        if (iflowOpenLink) {
            iflowOpenLink.addEventListener('click', () => this.openIflowLink());
        }
        if (iflowCopyLink) {
            iflowCopyLink.addEventListener('click', () => this.copyIflowLink());
        }

        // 使用统计
        const refreshUsageStats = document.getElementById('refresh-usage-stats');
        const requestsHourBtn = document.getElementById('requests-hour-btn');
        const requestsDayBtn = document.getElementById('requests-day-btn');
        const tokensHourBtn = document.getElementById('tokens-hour-btn');
        const tokensDayBtn = document.getElementById('tokens-day-btn');
        const chartLineSelects = document.querySelectorAll('.chart-line-select');

        if (refreshUsageStats) {
            refreshUsageStats.addEventListener('click', () => this.loadUsageStats());
        }
        if (requestsHourBtn) {
            requestsHourBtn.addEventListener('click', () => this.switchRequestsPeriod('hour'));
        }
        if (requestsDayBtn) {
            requestsDayBtn.addEventListener('click', () => this.switchRequestsPeriod('day'));
        }
        if (tokensHourBtn) {
            tokensHourBtn.addEventListener('click', () => this.switchTokensPeriod('hour'));
        }
        if (tokensDayBtn) {
            tokensDayBtn.addEventListener('click', () => this.switchTokensPeriod('day'));
        }
        if (chartLineSelects.length) {
            chartLineSelects.forEach(select => {
                select.addEventListener('change', (event) => {
                    const index = Number.parseInt(select.getAttribute('data-line-index'), 10);
                    this.handleChartLineSelectionChange(Number.isNaN(index) ? -1 : index, event.target.value);
                });
            });
        }

        // 模态框
        const closeBtn = document.querySelector('.close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeModal());
        }

        // 移动端菜单按钮
        const mobileMenuBtn = document.getElementById('mobile-menu-btn');
        const sidebarOverlay = document.getElementById('sidebar-overlay');
        const sidebar = document.getElementById('sidebar');

        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('click', () => this.toggleMobileSidebar());
        }

        if (sidebarOverlay) {
            sidebarOverlay.addEventListener('click', () => this.closeMobileSidebar());
        }

        // 侧边栏收起/展开按钮（桌面端）
        const sidebarToggleBtnDesktop = document.getElementById('sidebar-toggle-btn-desktop');
        if (sidebarToggleBtnDesktop) {
            sidebarToggleBtnDesktop.addEventListener('click', () => this.toggleSidebar());
        }

        // 从本地存储恢复侧边栏状态
        this.restoreSidebarState();

        // 监听窗口大小变化
        window.addEventListener('resize', () => {
            const sidebar = document.getElementById('sidebar');
            const layout = document.getElementById('layout-container');

            if (window.innerWidth <= 1024) {
                // 移动端：移除收起状态
                if (sidebar && layout) {
                    sidebar.classList.remove('collapsed');
                    layout.classList.remove('sidebar-collapsed');
                }
            } else {
                // 桌面端：恢复保存的状态
                this.restoreSidebarState();
            }
        });

        // 点击侧边栏导航项时在移动端关闭侧边栏
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', () => {
                if (window.innerWidth <= 1024) {
                    this.closeMobileSidebar();
                }
            });
        });
    }


    // 显示通知
    showNotification(message, type = 'info') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type}`;
        notification.classList.add('show');

        setTimeout(() => {
            notification.classList.remove('show');
        }, NOTIFICATION_DURATION_MS);
    }

    // 密钥可见性切换
    toggleKeyVisibility() {
        const keyInput = document.getElementById('management-key');
        const toggleButton = document.getElementById('toggle-key-visibility');

        if (keyInput.type === 'password') {
            keyInput.type = 'text';
            toggleButton.innerHTML = '<i class="fas fa-eye-slash"></i>';
        } else {
            keyInput.type = 'password';
            toggleButton.innerHTML = '<i class="fas fa-eye"></i>';
        }
    }

    // ===== 使用统计相关方法 =====

    // 使用统计状态
    requestsChart = null;
    tokensChart = null;
    currentUsageData = null;
    chartLineSelections = ['none', 'none', 'none'];
    chartLineSelectIds = ['chart-line-select-0', 'chart-line-select-1', 'chart-line-select-2'];
    chartLineStyles = [
        { borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.15)' },
        { borderColor: '#a855f7', backgroundColor: 'rgba(168, 85, 247, 0.15)' },
        { borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.15)' }
    ];

    showModal() {
        const modal = document.getElementById('modal');
        if (modal) {
            modal.style.display = 'block';
        }
    }

    // 关闭模态框
    closeModal() {
        document.getElementById('modal').style.display = 'none';
    }

}

Object.assign(
    CLIProxyManager.prototype,
    themeModule,
    navigationModule,
    languageModule,
    loginModule,
    configEditorModule,
    logsModule,
    apiKeysModule,
    authFilesModule,
    oauthModule,
    usageModule,
    settingsModule,
    aiProvidersModule,
    connectionModule
);

// 将工具函数绑定到原型上，供模块使用
CLIProxyManager.prototype.escapeHtml = escapeHtml;
CLIProxyManager.prototype.maskApiKey = maskApiKey;
CLIProxyManager.prototype.normalizeArrayResponse = normalizeArrayResponse;
CLIProxyManager.prototype.debounce = debounce;

// 全局管理器实例
let manager;

// 尝试自动加载根目录 Logo（支持多种常见文件名/扩展名）
function setupSiteLogo() {
    const img = document.getElementById('site-logo');
    const loginImg = document.getElementById('login-logo');
    if (!img && !loginImg) return;

    const inlineLogo = typeof window !== 'undefined' ? window.__INLINE_LOGO__ : null;
    if (inlineLogo) {
        if (img) {
            img.src = inlineLogo;
            img.style.display = 'inline-block';
        }
        if (loginImg) {
            loginImg.src = inlineLogo;
            loginImg.style.display = 'inline-block';
        }
        return;
    }

    const candidates = [
        '../logo.svg', '../logo.png', '../logo.jpg', '../logo.jpeg', '../logo.webp', '../logo.gif',
        'logo.svg', 'logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp', 'logo.gif',
        '/logo.svg', '/logo.png', '/logo.jpg', '/logo.jpeg', '/logo.webp', '/logo.gif'
    ];
    let idx = 0;
    const tryNext = () => {
        if (idx >= candidates.length) return;
        const test = new Image();
        test.onload = () => {
            if (img) {
                img.src = test.src;
                img.style.display = 'inline-block';
            }
            if (loginImg) {
                loginImg.src = test.src;
                loginImg.style.display = 'inline-block';
            }
        };
        test.onerror = () => {
            idx++;
            tryNext();
        };
        test.src = candidates[idx];
    };
    tryNext();
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 初始化国际化
    i18n.init();

    setupSiteLogo();
    manager = new CLIProxyManager();
});
