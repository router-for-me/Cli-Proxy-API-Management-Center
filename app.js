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
import { maskApiKey, formatFileSize } from './src/utils/string.js';
import { normalizeArrayResponse } from './src/utils/array.js';
import { debounce } from './src/utils/dom.js';
import {
    CACHE_EXPIRY_MS,
    MAX_LOG_LINES,
    LOG_FETCH_LIMIT,
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
import { ApiClient } from './src/core/api-client.js';
import { ConfigService } from './src/core/config-service.js';
import { createEventBus } from './src/core/event-bus.js';

// CLI Proxy API 管理界面 JavaScript
class CLIProxyManager {
    constructor() {
        // 事件总线
        this.events = createEventBus();

        // API 客户端（规范化基础地址、封装请求）
        this.apiClient = new ApiClient({
            onVersionUpdate: (headers) => this.updateVersionFromHeaders(headers)
        });
        const detectedBase = this.detectApiBaseFromLocation();
        this.apiClient.setApiBase(detectedBase);
        this.apiBase = this.apiClient.apiBase;
        this.apiUrl = this.apiClient.apiUrl;
        this.managementKey = '';
        this.isConnected = false;
        this.isLoggedIn = false;
        this.uiVersion = null;
        this.serverVersion = null;
        this.serverBuildDate = null;
        this.latestVersion = null;
        this.versionCheckStatus = 'muted';
        this.versionCheckMessage = i18n.t('system_info.version_check_idle');

        // 配置缓存 - 改为分段缓存（交由 ConfigService 管理）
        this.cacheExpiry = CACHE_EXPIRY_MS;
        this.configService = new ConfigService({
            apiClient: this.apiClient,
            cacheExpiry: this.cacheExpiry
        });
        this.configCache = this.configService.cache;
        this.cacheTimestamps = this.configService.cacheTimestamps;
        this.availableModels = [];
        this.availableModelApiKeysCache = null;
        this.availableModelsLoading = false;

        // 状态更新定时器
        this.statusUpdateTimer = null;
        this.lastConnectionStatusEmitted = null;
        this.isGlobalRefreshInProgress = false;

        this.registerCoreEventHandlers();

        // 日志自动刷新定时器
        this.logsRefreshTimer = null;

        // 当前展示的日志行
        this.allLogLines = [];
        this.displayedLogLines = [];
        this.logSearchQuery = '';
        this.maxDisplayLogLines = MAX_LOG_LINES;
        this.logFetchLimit = LOG_FETCH_LIMIT;

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

        // OAuth 模型排除列表状态
        this.oauthExcludedModels = {};
        this._oauthExcludedLoading = false;

        // Vertex AI credential import state
        this.vertexImportState = {
            file: null,
            loading: false,
            result: null
        };

        // 顶栏标题动画状态
        this.brandCollapseTimer = null;
        this.brandCollapseDelayMs = 5000;
        this.brandIsCollapsed = false;
        this.brandAnimationReady = false;
        this.brandElements = {
            toggle: null,
            wrapper: null,
            fullText: null,
            shortText: null
        };
        this.brandResizeHandler = null;
        this.brandToggleHandler = null;

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
        this.registerCoreEventHandlers();
        this.registerSettingsListeners();
        this.registerUsageListeners();
        if (typeof this.registerLogsListeners === 'function') {
            this.registerLogsListeners();
        }
        if (typeof this.registerConfigEditorListeners === 'function') {
            this.registerConfigEditorListeners();
        }
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
        if (typeof this.registerAuthFilesListeners === 'function') {
            this.registerAuthFilesListeners();
        }
    }

    registerCoreEventHandlers() {
        if (!this.events || typeof this.events.on !== 'function') {
            return;
        }
        this.events.on('config:refresh-requested', async (event) => {
            const detail = event?.detail || {};
            const forceRefresh = detail.forceRefresh !== false;
            // 避免并发触发导致重复请求
            if (this.isGlobalRefreshInProgress) {
                return;
            }
            await this.runGlobalRefresh(forceRefresh);
        });
    }

    async runGlobalRefresh(forceRefresh = false) {
        this.isGlobalRefreshInProgress = true;
        try {
            await this.loadAllData(forceRefresh);
        } finally {
            this.isGlobalRefreshInProgress = false;
        }
    }

    isLocalHostname(hostname = (typeof window !== 'undefined' ? window.location.hostname : '')) {
        const host = (hostname || '').toLowerCase();
        return host === 'localhost' || host === '127.0.0.1' || host === '::1';
    }

    isIflowOAuthAllowed(hostname = (typeof window !== 'undefined' ? window.location.hostname : '')) {
        const host = (hostname || '').toLowerCase();
        // iFlow OAuth 仅允许在本机回环地址访问
        return host === '127.0.0.1' || host === 'localhost' || host === '::1';
    }

    // 检查主机名并隐藏 OAuth 登录框
    checkHostAndHideOAuth() {
        const hostname = window.location.hostname;
        const isLocalhost = this.isLocalHostname(hostname);
        const isIflowOAuthAllowed = this.isIflowOAuthAllowed(hostname);

        if (!isLocalhost) {
            // 隐藏所有 OAuth 登录卡片(除了 iFlow, 因为它有 Cookie 登录功能可远程使用)
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
                // 不再隐藏包含 'iFlow' 的卡片
                if (cardText.includes('Codex OAuth') ||
                    cardText.includes('Anthropic OAuth') ||
                    cardText.includes('Antigravity OAuth') ||
                    cardText.includes('Gemini CLI OAuth') ||
                    cardText.includes('Qwen OAuth')) {
                    card.style.display = 'none';
                }
            });

            console.log(`当前主机名: ${hostname}，已隐藏 OAuth 登录框(保留 iFlow Cookie 登录)`);
        }

        if (!isIflowOAuthAllowed) {
            // 对于 iFlow card, 仅在本机允许 OAuth，其余情况只保留 Cookie 登录
            const iflowCard = document.getElementById('iflow-oauth-card');
            if (iflowCard) {
                const oauthContent = document.getElementById('iflow-oauth-content');
                const oauthButton = document.getElementById('iflow-oauth-btn');
                const oauthStatus = document.getElementById('iflow-oauth-status');
                const oauthUrlGroup = document.getElementById('iflow-oauth-url')?.closest('.form-group');
                const oauthHint = iflowCard.querySelector('[data-i18n="auth_login.iflow_oauth_hint"]');

                if (oauthContent) oauthContent.style.display = 'none';
                if (oauthButton) oauthButton.style.display = 'none';
                if (oauthStatus) {
                    oauthStatus.textContent = i18n.t('auth_login.iflow_oauth_local_only');
                    oauthStatus.style.display = 'block';
                    oauthStatus.style.color = 'var(--warning-text)';
                }
                if (oauthUrlGroup) oauthUrlGroup.style.display = 'none';
                if (oauthHint) oauthHint.style.display = 'none';

                // 保持整个 card 可见, 因为 Cookie 登录部分仍然可用
                iflowCard.style.display = 'block';
            }

            console.log(`当前主机名: ${hostname}，iFlow OAuth 已限制为本机访问，仅保留 Cookie 登录`);
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
        const availableModelsRefresh = document.getElementById('available-models-refresh');
        const versionCheckBtn = document.getElementById('version-check-btn');

        if (connectionStatus) {
            connectionStatus.addEventListener('click', () => this.checkConnectionStatus());
        }
        if (refreshAll) {
            refreshAll.addEventListener('click', () => this.refreshAllData());
        }
        if (availableModelsRefresh) {
            availableModelsRefresh.addEventListener('click', () => this.loadAvailableModels({ forceRefresh: true }));
        }
        if (versionCheckBtn) {
            versionCheckBtn.addEventListener('click', () => this.checkLatestVersion());
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
        const selectErrorLog = document.getElementById('select-error-log');
        const downloadLogs = document.getElementById('download-logs');
        const clearLogs = document.getElementById('clear-logs');
        const logsAutoRefreshToggle = document.getElementById('logs-auto-refresh-toggle');
        const logsSearchInput = document.getElementById('logs-search-input');

        if (refreshLogs) {
            refreshLogs.addEventListener('click', () => this.refreshLogs());
        }
        if (selectErrorLog) {
            selectErrorLog.addEventListener('click', () => this.openErrorLogsModal());
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
        if (logsSearchInput) {
            const debouncedLogSearch = this.debounce((value) => {
                this.updateLogSearchQuery(value);
            }, 200);
            logsSearchInput.addEventListener('input', (e) => {
                debouncedLogSearch(e?.target?.value ?? '');
            });
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

        // OAuth 排除列表
        const oauthExcludedAdd = document.getElementById('oauth-excluded-add');
        const oauthExcludedRefresh = document.getElementById('oauth-excluded-refresh');

        if (oauthExcludedAdd) {
            oauthExcludedAdd.addEventListener('click', () => this.openOauthExcludedEditor());
        }
        if (oauthExcludedRefresh) {
            oauthExcludedRefresh.addEventListener('click', () => this.loadOauthExcludedModels(true));
        }

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

        // Antigravity OAuth
        const antigravityOauthBtn = document.getElementById('antigravity-oauth-btn');
        const antigravityOpenLink = document.getElementById('antigravity-open-link');
        const antigravityCopyLink = document.getElementById('antigravity-copy-link');

        if (antigravityOauthBtn) {
            antigravityOauthBtn.addEventListener('click', () => this.startAntigravityOAuth());
        }
        if (antigravityOpenLink) {
            antigravityOpenLink.addEventListener('click', () => this.openAntigravityLink());
        }
        if (antigravityCopyLink) {
            antigravityCopyLink.addEventListener('click', () => this.copyAntigravityLink());
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
        const iflowCookieSubmit = document.getElementById('iflow-cookie-submit');

        if (iflowOauthBtn) {
            iflowOauthBtn.addEventListener('click', () => this.startIflowOAuth());
        }
        if (iflowOpenLink) {
            iflowOpenLink.addEventListener('click', () => this.openIflowLink());
        }
        if (iflowCopyLink) {
            iflowCopyLink.addEventListener('click', () => this.copyIflowLink());
        }
        if (iflowCookieSubmit) {
            iflowCookieSubmit.addEventListener('click', () => this.submitIflowCookieLogin());
        }

        // 使用统计
        const refreshUsageStats = document.getElementById('refresh-usage-stats');
        const requestsHourBtn = document.getElementById('requests-hour-btn');
        const requestsDayBtn = document.getElementById('requests-day-btn');
        const tokensHourBtn = document.getElementById('tokens-hour-btn');
        const tokensDayBtn = document.getElementById('tokens-day-btn');
        const costHourBtn = document.getElementById('cost-hour-btn');
        const costDayBtn = document.getElementById('cost-day-btn');
        const addChartLineBtn = document.getElementById('add-chart-line');
        const chartLineSelects = document.querySelectorAll('.chart-line-select');
        const chartLineDeleteButtons = document.querySelectorAll('.chart-line-delete');
        const modelPriceForm = document.getElementById('model-price-form');
        const resetModelPricesBtn = document.getElementById('reset-model-prices');
        const modelPriceSelect = document.getElementById('model-price-model-select');

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
        if (costHourBtn) {
            costHourBtn.addEventListener('click', () => this.switchCostPeriod('hour'));
        }
        if (costDayBtn) {
            costDayBtn.addEventListener('click', () => this.switchCostPeriod('day'));
        }
        if (addChartLineBtn) {
            addChartLineBtn.addEventListener('click', () => this.changeChartLineCount(1));
        }
        if (chartLineSelects.length) {
            chartLineSelects.forEach(select => {
                select.addEventListener('change', (event) => {
                    const index = Number.parseInt(select.getAttribute('data-line-index'), 10);
                    this.handleChartLineSelectionChange(Number.isNaN(index) ? -1 : index, event.target.value);
                });
            });
        }
        if (chartLineDeleteButtons.length) {
            chartLineDeleteButtons.forEach(button => {
                button.addEventListener('click', () => {
                    const index = Number.parseInt(button.getAttribute('data-line-index'), 10);
                    this.removeChartLine(Number.isNaN(index) ? -1 : index);
                });
            });
        }
        this.updateChartLineControlsUI();
        if (modelPriceForm) {
            modelPriceForm.addEventListener('submit', (event) => {
                event.preventDefault();
                this.handleModelPriceSubmit();
            });
        }
        if (resetModelPricesBtn) {
            resetModelPricesBtn.addEventListener('click', () => this.handleModelPriceReset());
        }
        if (modelPriceSelect) {
            modelPriceSelect.addEventListener('change', () => this.prefillModelPriceInputs());
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

    // 顶栏标题动画与状态
    isMobileViewport() {
        return typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
    }

    setupBrandTitleAnimation() {
        const mainPage = document.getElementById('main-page');
        if (mainPage && mainPage.style.display === 'none') {
            return;
        }

        const toggle = document.getElementById('brand-name-toggle');
        const wrapper = document.getElementById('brand-texts');
        const fullText = document.querySelector('.brand-text-full');
        const shortText = document.querySelector('.brand-text-short');

        if (!toggle || !wrapper || !fullText || !shortText) {
            return;
        }

        this.brandElements = { toggle, wrapper, fullText, shortText };

        if (!this.brandToggleHandler) {
            this.brandToggleHandler = () => this.handleBrandToggle();
            toggle.addEventListener('click', this.brandToggleHandler);
        }
        if (!this.brandResizeHandler) {
            this.brandResizeHandler = () => this.handleBrandResize();
            window.addEventListener('resize', this.brandResizeHandler);
        }

        if (this.isMobileViewport()) {
            this.applyMobileBrandState();
        } else {
            this.enableBrandAnimation();
        }
    }

    enableBrandAnimation() {
        const { toggle } = this.brandElements || {};
        if (toggle) {
            toggle.removeAttribute('aria-disabled');
            toggle.style.pointerEvents = '';
        }
        this.brandAnimationReady = true;
    }

    applyMobileBrandState() {
        const { toggle, wrapper, shortText } = this.brandElements || {};
        if (!toggle || !wrapper || !shortText) {
            return;
        }

        this.clearBrandCollapseTimer();
        this.brandIsCollapsed = true;
        this.brandAnimationReady = false;

        toggle.classList.add('collapsed');
        toggle.classList.remove('expanded');
        toggle.setAttribute('aria-disabled', 'true');
        toggle.style.pointerEvents = 'none';

        const targetWidth = this.getBrandTextWidth(shortText);
        this.applyBrandWidth(targetWidth, { animate: false });
    }

    getBrandTextWidth(element) {
        if (!element) {
            return 0;
        }
        const width = element.scrollWidth || element.getBoundingClientRect().width || 0;
        return Number.isFinite(width) ? Math.ceil(width) : 0;
    }

    applyBrandWidth(targetWidth, { animate = true } = {}) {
        const wrapper = this.brandElements?.wrapper;
        if (!wrapper || !Number.isFinite(targetWidth)) {
            return;
        }

        if (!animate) {
            const previousTransition = wrapper.style.transition;
            wrapper.style.transition = 'none';
            wrapper.style.width = `${targetWidth}px`;
            wrapper.getBoundingClientRect(); // 强制重绘以应用无动画的宽度
            wrapper.style.transition = previousTransition;
            return;
        }

        wrapper.style.width = `${targetWidth}px`;
    }

    updateBrandTextWidths(options = {}) {
        const { wrapper, fullText, shortText } = this.brandElements || {};
        if (!wrapper || !fullText || !shortText) {
            return;
        }

        const targetSpan = this.brandIsCollapsed ? shortText : fullText;
        const targetWidth = this.getBrandTextWidth(targetSpan);
        this.applyBrandWidth(targetWidth, { animate: !options.immediate });
    }

    setBrandCollapsed(collapsed, options = {}) {
        const { toggle, fullText, shortText } = this.brandElements || {};
        if (!toggle || !fullText || !shortText) {
            return;
        }

        this.brandIsCollapsed = collapsed;
        const targetSpan = collapsed ? shortText : fullText;
        const targetWidth = this.getBrandTextWidth(targetSpan);

        this.applyBrandWidth(targetWidth, { animate: options.animate !== false });
        toggle.classList.toggle('collapsed', collapsed);
        toggle.classList.toggle('expanded', !collapsed);
    }

    handleBrandResize() {
        if (!this.brandElements?.wrapper) {
            return;
        }

        if (this.isMobileViewport()) {
            this.applyMobileBrandState();
            return;
        }

        if (!this.brandAnimationReady) {
            this.enableBrandAnimation();
            this.brandIsCollapsed = false;
            this.setBrandCollapsed(false, { animate: false });
            this.scheduleBrandCollapse(this.brandCollapseDelayMs);
            return;
        }

        this.updateBrandTextWidths({ immediate: true });
    }

    scheduleBrandCollapse(delayMs = this.brandCollapseDelayMs) {
        this.clearBrandCollapseTimer();
        this.brandCollapseTimer = window.setTimeout(() => {
            this.setBrandCollapsed(true);
            this.brandCollapseTimer = null;
        }, delayMs);
    }

    clearBrandCollapseTimer() {
        if (this.brandCollapseTimer) {
            clearTimeout(this.brandCollapseTimer);
            this.brandCollapseTimer = null;
        }
    }

    startBrandCollapseCycle() {
        this.setupBrandTitleAnimation();

        if (this.isMobileViewport()) {
            this.applyMobileBrandState();
            return;
        }

        if (!this.brandAnimationReady) {
            return;
        }

        this.clearBrandCollapseTimer();
        this.brandIsCollapsed = false;
        this.setBrandCollapsed(false, { animate: false });
        this.scheduleBrandCollapse(this.brandCollapseDelayMs);
    }

    resetBrandTitleState() {
        this.clearBrandCollapseTimer();
        const mainPage = document.getElementById('main-page');

        if (this.isMobileViewport()) {
            this.applyMobileBrandState();
            return;
        }

        if (!this.brandAnimationReady || (mainPage && mainPage.style.display === 'none')) {
            this.brandIsCollapsed = false;
            return;
        }

        this.brandIsCollapsed = false;
        this.setBrandCollapsed(false, { animate: false });
    }

    refreshBrandTitleAfterTextChange() {
        if (this.isMobileViewport()) {
            this.applyMobileBrandState();
            return;
        }

        if (!this.brandAnimationReady) {
            return;
        }
        this.updateBrandTextWidths({ immediate: true });
        if (!this.brandIsCollapsed) {
            this.scheduleBrandCollapse(this.brandCollapseDelayMs);
        }
    }

    handleBrandToggle() {
        if (!this.brandAnimationReady) {
            return;
        }

        const nextCollapsed = !this.brandIsCollapsed;
        this.setBrandCollapsed(nextCollapsed);
        this.clearBrandCollapseTimer();

        if (!nextCollapsed) {
            // 展开后给用户留出一点时间阅读再收起
            this.scheduleBrandCollapse(this.brandCollapseDelayMs + 1500);
        }
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
    costChart = null;
    currentUsageData = null;
    chartLineMaxCount = 9;
    chartLineVisibleCount = 3;
    chartLineSelections = Array(3).fill('none');
    chartLineSelectionsInitialized = false;
    chartLineSelectIds = Array.from({ length: 9 }, (_, idx) => `chart-line-select-${idx}`);
    chartLineStyles = [
        { borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.15)' },
        { borderColor: '#a855f7', backgroundColor: 'rgba(168, 85, 247, 0.15)' },
        { borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.15)' },
        { borderColor: '#f97316', backgroundColor: 'rgba(249, 115, 22, 0.15)' },
        { borderColor: '#ec4899', backgroundColor: 'rgba(236, 72, 153, 0.15)' },
        { borderColor: '#14b8a6', backgroundColor: 'rgba(20, 184, 166, 0.15)' },
        { borderColor: '#8b5cf6', backgroundColor: 'rgba(139, 92, 246, 0.15)' },
        { borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.15)' },
        { borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.15)' }
    ];
    modelPriceStorageKey = 'cli-proxy-model-prices-v2';
    modelPrices = {};
    modelPriceInitialized = false;

    showModal() {
        const modal = document.getElementById('modal');
        if (modal) {
            modal.style.display = 'block';
        }
    }

    // 关闭模态框
    closeModal() {
        document.getElementById('modal').style.display = 'none';
        if (typeof this.closeOpenAIModelDiscovery === 'function') {
            this.closeOpenAIModelDiscovery();
        }
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
CLIProxyManager.prototype.formatFileSize = formatFileSize;
CLIProxyManager.prototype.normalizeArrayResponse = normalizeArrayResponse;
CLIProxyManager.prototype.debounce = debounce;

// 全局管理器实例
let manager;

// 让内联事件处理器可以访问到 manager 实例
function exposeManagerInstance(instance) {
    if (typeof window !== 'undefined') {
        window.manager = instance;
    } else if (typeof globalThis !== 'undefined') {
        globalThis.manager = instance;
    }
}

// 尝试自动加载根目录 Logo（支持多种常见文件名/扩展名）
function setupSiteLogo() {
    const img = document.getElementById('site-logo');
    const loginImg = document.getElementById('login-logo');
    const favicon = document.getElementById('favicon-link');
    if (!img && !loginImg && !favicon) return;

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
        if (favicon) {
            favicon.href = inlineLogo;
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
            if (favicon) {
                favicon.href = test.src;
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
    exposeManagerInstance(manager);
});
