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

        // 配置缓存
        this.configCache = null;
        this.cacheTimestamp = null;
        this.cacheExpiry = 30000; // 30秒缓存过期时间

        // 状态更新定时器
        this.statusUpdateTimer = null;

        // 日志自动刷新定时器
        this.logsRefreshTimer = null;

        // 当前展示的日志行
        this.displayedLogLines = [];
        this.maxDisplayLogLines = 10000;

        // 日志时间戳（用于增量加载）
        this.latestLogTimestamp = null;

        // Auth file filter state cache
        this.currentAuthFileFilter = 'all';
        this.cachedAuthFiles = [];
        this.authFilesPagination = {
            pageSize: 9,
            currentPage: 1,
            totalPages: 1
        };
        this.authFileStatsCache = {};
        this.authFileSearchQuery = '';
        this.authFilesPageSizeKey = 'authFilesPageSize';
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
        const defaultSize = 9;
        const minSize = 3;
        const maxSize = 60;
        const parsed = parseInt(value, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            return defaultSize;
        }
        return Math.min(maxSize, Math.max(minSize, parsed));
    }

    // 简易防抖，减少频繁写 localStorage
    debounce(fn, delay = 400) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    // 初始化主题
    initializeTheme() {
        // 从本地存储获取用户偏好主题
        const savedTheme = localStorage.getItem('preferredTheme');
        if (savedTheme && ['light', 'dark'].includes(savedTheme)) {
            this.currentTheme = savedTheme;
        } else {
            if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
                this.currentTheme = 'dark';
            } else {
                this.currentTheme = 'light';
            }
        }

        this.applyTheme(this.currentTheme);
        this.updateThemeButtons();

        // 监听系统主题变化
        if (window.matchMedia) {
            window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                if (!localStorage.getItem('preferredTheme')) {
                    this.currentTheme = e.matches ? 'dark' : 'light';
                    this.applyTheme(this.currentTheme);
                    this.updateThemeButtons();
                }
            });
        }
    }

    // 应用主题
    applyTheme(theme) {
        if (theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
        this.currentTheme = theme;
    }

    // 切换主题
    toggleTheme() {
        const newTheme = this.currentTheme === 'light' ? 'dark' : 'light';
        this.applyTheme(newTheme);
        this.updateThemeButtons();
        localStorage.setItem('preferredTheme', newTheme);
    }

    // 更新主题按钮状态
    updateThemeButtons() {
        const loginThemeBtn = document.getElementById('theme-toggle');
        const mainThemeBtn = document.getElementById('theme-toggle-main');

        const updateButton = (btn) => {
            if (!btn) return;
            const icon = btn.querySelector('i');
            if (this.currentTheme === 'dark') {
                icon.className = 'fas fa-sun';
                btn.title = i18n.t('theme.switch_to_light');
            } else {
                icon.className = 'fas fa-moon';
                btn.title = i18n.t('theme.switch_to_dark');
            }
        };

        updateButton(loginThemeBtn);
        updateButton(mainThemeBtn);
    }

    init() {
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
            const oauthCards = [
                'codex-oauth-card',
                'anthropic-oauth-card',
                'gemini-cli-oauth-card',
                'qwen-oauth-card',
                'iflow-oauth-card'
            ];

            oauthCards.forEach(cardId => {
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
    async checkLoginStatus() {
        // 检查是否有保存的连接信息
        const savedBase = localStorage.getItem('apiBase');
        const savedKey = localStorage.getItem('managementKey');
        const wasLoggedIn = localStorage.getItem('isLoggedIn') === 'true';

        // 如果有完整的连接信息且之前已登录，尝试自动登录
        if (savedBase && savedKey && wasLoggedIn) {
            try {
                console.log(i18n.t('auto_login.title'));
                this.showAutoLoginLoading();
                await this.attemptAutoLogin(savedBase, savedKey);
                return; // 自动登录成功，不显示登录页面
            } catch (error) {
                console.log(`${i18n.t('notification.login_failed')}: ${error.message}`);
                // 清除无效的登录状态
                localStorage.removeItem('isLoggedIn');
                this.hideAutoLoginLoading();
            }
        }

        // 如果没有连接信息或自动登录失败，显示登录页面
        this.showLoginPage();
        this.loadLoginSettings();
    }

    // 显示自动登录加载页面
    showAutoLoginLoading() {
        document.getElementById('auto-login-loading').style.display = 'flex';
        document.getElementById('login-page').style.display = 'none';
        document.getElementById('main-page').style.display = 'none';
    }

    // 隐藏自动登录加载页面
    hideAutoLoginLoading() {
        document.getElementById('auto-login-loading').style.display = 'none';
    }

    // 尝试自动登录
    async attemptAutoLogin(apiBase, managementKey) {
        try {
            // 设置API基础地址和密钥
            this.setApiBase(apiBase);
            this.managementKey = managementKey;

            // 恢复代理设置（如果有）
            const savedProxy = localStorage.getItem('proxyUrl');
            if (savedProxy) {
                // 代理设置会在后续的API请求中自动使用
            }

            // 测试连接
            await this.testConnection();

            // 自动登录成功
            this.isLoggedIn = true;
            this.hideAutoLoginLoading();
            this.showMainPage();

            console.log(i18n.t('auto_login.title'));
            return true;
        } catch (error) {
            console.error('自动登录失败:', error);
            // 重置状态
            this.isLoggedIn = false;
            this.isConnected = false;
            throw error;
        }
    }

    // 显示登录页面
    showLoginPage() {
        document.getElementById('login-page').style.display = 'flex';
        document.getElementById('main-page').style.display = 'none';
        this.isLoggedIn = false;
        this.updateLoginConnectionInfo();
    }

    // 显示主页面
    showMainPage() {
        document.getElementById('login-page').style.display = 'none';
        document.getElementById('main-page').style.display = 'block';
        this.isLoggedIn = true;
        this.updateConnectionInfo();
    }

    // 登录验证
    async login(apiBase, managementKey) {
        try {
            // 设置API基础地址和密钥
            this.setApiBase(apiBase);
            this.managementKey = managementKey;
            localStorage.setItem('managementKey', this.managementKey);

            // 测试连接并加载所有数据
            await this.testConnection();

            // 登录成功
            this.isLoggedIn = true;
            localStorage.setItem('isLoggedIn', 'true');

            this.showMainPage();
            // 不需要再调用loadSettings，因为内部状态已经在上面设置了

            return true;
        } catch (error) {
            console.error('登录失败:', error);
            throw error;
        }
    }

    // 登出
    logout() {
        this.isLoggedIn = false;
        this.isConnected = false;
        this.clearCache();
        this.stopStatusUpdateTimer();

        // 清除本地存储
        localStorage.removeItem('isLoggedIn');
        localStorage.removeItem('managementKey');

        this.showLoginPage();
    }

    // 处理登录表单提交
    async handleLogin() {
        const apiBaseInput = document.getElementById('login-api-base');
        const managementKeyInput = document.getElementById('login-management-key');
        const managementKey = managementKeyInput ? managementKeyInput.value.trim() : '';

        if (!managementKey) {
            this.showLoginError(i18n.t('login.error_required'));
            return;
        }

        if (apiBaseInput && apiBaseInput.value.trim()) {
            this.setApiBase(apiBaseInput.value.trim());
        }

        const submitBtn = document.getElementById('login-submit');
        const originalText = submitBtn ? submitBtn.innerHTML : '';

        try {
            if (submitBtn) {
                submitBtn.innerHTML = `<div class="loading"></div> ${i18n.t('login.submitting')}`;
                submitBtn.disabled = true;
            }
            this.hideLoginError();

            this.managementKey = managementKey;
            localStorage.setItem('managementKey', this.managementKey);

            await this.login(this.apiBase, this.managementKey);
        } catch (error) {
            this.showLoginError(`${i18n.t('login.error_title')}: ${error.message}`);
        } finally {
            if (submitBtn) {
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
            }
        }
    }

    // 切换登录页面密钥可见性
    toggleLoginKeyVisibility(button) {
        const inputGroup = button.closest('.input-group');
        const keyInput = inputGroup.querySelector('input[type="password"], input[type="text"]');

        if (keyInput.type === 'password') {
            keyInput.type = 'text';
            button.innerHTML = '<i class="fas fa-eye-slash"></i>';
        } else {
            keyInput.type = 'password';
            button.innerHTML = '<i class="fas fa-eye"></i>';
        }
    }

    // 显示登录错误
    showLoginError(message) {
        const errorDiv = document.getElementById('login-error');
        const errorMessage = document.getElementById('login-error-message');

        errorMessage.textContent = message;
        errorDiv.style.display = 'flex';
    }

    // 隐藏登录错误
    hideLoginError() {
        const errorDiv = document.getElementById('login-error');
        errorDiv.style.display = 'none';
    }

    // 更新连接信息显示
    updateConnectionInfo() {
        const apiUrlElement = document.getElementById('display-api-url');
        const statusElement = document.getElementById('display-connection-status');

        // 显示API地址
        if (apiUrlElement) {
            apiUrlElement.textContent = this.apiBase || '-';
        }

        // 显示密钥（遮蔽显示）

        // 显示连接状态
        if (statusElement) {
            let statusHtml = '';
            if (this.isConnected) {
                statusHtml = `<span class="status-indicator connected"><i class="fas fa-circle"></i> ${i18n.t('common.connected')}</span>`;
            } else {
                statusHtml = `<span class="status-indicator disconnected"><i class="fas fa-circle"></i> ${i18n.t('common.disconnected')}</span>`;
            }
            statusElement.innerHTML = statusHtml;
        }
    }


    // 加载登录页面设置
    loadLoginSettings() {
        const savedBase = localStorage.getItem('apiBase');
        const savedKey = localStorage.getItem('managementKey');
        const loginKeyInput = document.getElementById('login-management-key');
        const apiBaseInput = document.getElementById('login-api-base');

        if (savedBase) {
            this.setApiBase(savedBase);
        } else {
            this.setApiBase(this.detectApiBaseFromLocation());
        }

        if (apiBaseInput) {
            apiBaseInput.value = this.apiBase || '';
        }

        if (loginKeyInput && savedKey) {
            loginKeyInput.value = savedKey;
        }

        this.setupLoginAutoSave();
    }

    setupLoginAutoSave() {
        const loginKeyInput = document.getElementById('login-management-key');
        const apiBaseInput = document.getElementById('login-api-base');
        const resetButton = document.getElementById('login-reset-api-base');

        const saveKey = (val) => {
            if (val.trim()) {
                this.managementKey = val;
                localStorage.setItem('managementKey', this.managementKey);
            }
        };
        const saveKeyDebounced = this.debounce(saveKey, 500);

        if (loginKeyInput) {
            loginKeyInput.addEventListener('change', (e) => saveKey(e.target.value));
            loginKeyInput.addEventListener('input', (e) => saveKeyDebounced(e.target.value));
        }

        if (apiBaseInput) {
            const persistBase = (val) => {
                const normalized = this.normalizeBase(val);
                if (normalized) {
                    this.setApiBase(normalized);
                }
            };
            const persistBaseDebounced = this.debounce(persistBase, 500);

            apiBaseInput.addEventListener('change', (e) => persistBase(e.target.value));
            apiBaseInput.addEventListener('input', (e) => persistBaseDebounced(e.target.value));
        }

        if (resetButton) {
            resetButton.addEventListener('click', () => {
                const detected = this.detectApiBaseFromLocation();
                this.setApiBase(detected);
                if (apiBaseInput) {
                    apiBaseInput.value = detected;
                }
            });
        }
    }

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

    // 切换移动端侧边栏
    toggleMobileSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const layout = document.getElementById('layout-container');
        const mainWrapper = document.getElementById('main-wrapper');

        if (sidebar && overlay) {
            const isOpen = sidebar.classList.toggle('mobile-open');
            overlay.classList.toggle('active');
            if (layout) {
                layout.classList.toggle('sidebar-open', isOpen);
            }
            if (mainWrapper) {
                mainWrapper.classList.toggle('sidebar-open', isOpen);
            }
        }
    }

    // 关闭移动端侧边栏
    closeMobileSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const layout = document.getElementById('layout-container');
        const mainWrapper = document.getElementById('main-wrapper');

        if (sidebar && overlay) {
            sidebar.classList.remove('mobile-open');
            overlay.classList.remove('active');
            if (layout) {
                layout.classList.remove('sidebar-open');
            }
            if (mainWrapper) {
                mainWrapper.classList.remove('sidebar-open');
            }
        }
    }

    // 切换侧边栏收起/展开状态
    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const layout = document.getElementById('layout-container');

        if (sidebar && layout) {
            const isCollapsed = sidebar.classList.toggle('collapsed');
            layout.classList.toggle('sidebar-collapsed', isCollapsed);

            // 保存状态到本地存储
            localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');

            // 更新按钮提示文本
            const toggleBtn = document.getElementById('sidebar-toggle-btn-desktop');
            if (toggleBtn) {
                toggleBtn.setAttribute('data-i18n-title', isCollapsed ? 'sidebar.toggle_expand' : 'sidebar.toggle_collapse');
                toggleBtn.title = i18n.t(isCollapsed ? 'sidebar.toggle_expand' : 'sidebar.toggle_collapse');
            }
        }
    }

    // 恢复侧边栏状态
    restoreSidebarState() {
        // 只在桌面端恢复侧栏状态
        if (window.innerWidth > 1024) {
            const savedState = localStorage.getItem('sidebarCollapsed');
            if (savedState === 'true') {
                const sidebar = document.getElementById('sidebar');
                const layout = document.getElementById('layout-container');

                if (sidebar && layout) {
                    sidebar.classList.add('collapsed');
                    layout.classList.add('sidebar-collapsed');

                    // 更新按钮提示文本
                    const toggleBtn = document.getElementById('sidebar-toggle-btn-desktop');
                    if (toggleBtn) {
                        toggleBtn.setAttribute('data-i18n-title', 'sidebar.toggle_expand');
                        toggleBtn.title = i18n.t('sidebar.toggle_expand');
                    }
                }
            }
        }
    }

    // 设置导航
    setupNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();

                // 移除所有活动状态
                navItems.forEach(nav => nav.classList.remove('active'));
                document.querySelectorAll('.content-section').forEach(section => section.classList.remove('active'));

                // 添加活动状态
                item.classList.add('active');
                const sectionId = item.getAttribute('data-section');
                document.getElementById(sectionId).classList.add('active');

                // 如果点击的是日志查看页面，自动加载日志
                if (sectionId === 'logs') {
                    this.refreshLogs(false);
                } else if (sectionId === 'config-management') {
                    this.loadConfigFileEditor();
                    this.refreshConfigEditor();
                }
            });
        });
    }

    // 设置语言切换
    setupLanguageSwitcher() {
        const loginToggle = document.getElementById('language-toggle');
        const mainToggle = document.getElementById('language-toggle-main');

        if (loginToggle) {
            loginToggle.addEventListener('click', () => this.toggleLanguage());
        }
        if (mainToggle) {
            mainToggle.addEventListener('click', () => this.toggleLanguage());
        }
    }

    // 设置主题切换
    setupThemeSwitcher() {
        const loginToggle = document.getElementById('theme-toggle');
        const mainToggle = document.getElementById('theme-toggle-main');

        if (loginToggle) {
            loginToggle.addEventListener('click', () => this.toggleTheme());
        }
        if (mainToggle) {
            mainToggle.addEventListener('click', () => this.toggleTheme());
        }
    }

    // 初始化配置文件编辑器
    setupConfigEditor() {
        const textarea = document.getElementById('config-editor');
        const saveBtn = document.getElementById('config-save-btn');
        const reloadBtn = document.getElementById('config-reload-btn');
        const statusEl = document.getElementById('config-editor-status');

        this.configEditorElements = {
            textarea,
            editorInstance: null,
            saveBtn,
            reloadBtn,
            statusEl
        };

        if (!textarea || !saveBtn || !reloadBtn || !statusEl) {
            return;
        }

        if (window.CodeMirror) {
            const editorInstance = window.CodeMirror.fromTextArea(textarea, {
                mode: 'yaml',
                theme: 'default',
                lineNumbers: true,
                indentUnit: 2,
                tabSize: 2,
                lineWrapping: true,
                autoCloseBrackets: true,
                extraKeys: {
                    'Ctrl-/': 'toggleComment',
                    'Cmd-/': 'toggleComment'
                }
            });

            editorInstance.setSize('100%', '100%');
            editorInstance.on('change', () => {
                this.isConfigEditorDirty = true;
                this.updateConfigEditorStatus('info', i18n.t('config_management.status_dirty'));
            });

            this.configEditorElements.editorInstance = editorInstance;
        } else {
            textarea.addEventListener('input', () => {
                this.isConfigEditorDirty = true;
                this.updateConfigEditorStatus('info', i18n.t('config_management.status_dirty'));
            });
        }

        saveBtn.addEventListener('click', () => this.saveConfigFile());
        reloadBtn.addEventListener('click', () => this.loadConfigFileEditor(true));

        this.refreshConfigEditor();
    }

    // 更新配置编辑器可用状态
    updateConfigEditorAvailability() {
        const { textarea, editorInstance, saveBtn, reloadBtn } = this.configEditorElements;
        if ((!textarea && !editorInstance) || !saveBtn || !reloadBtn) {
            return;
        }

        const disabled = !this.isConnected;
        if (editorInstance) {
            editorInstance.setOption('readOnly', disabled ? 'nocursor' : false);
            const wrapper = editorInstance.getWrapperElement();
            if (wrapper) {
                wrapper.classList.toggle('cm-readonly', disabled);
            }
        } else if (textarea) {
            textarea.disabled = disabled;
        }

        saveBtn.disabled = disabled;
        reloadBtn.disabled = disabled;

        if (disabled) {
            this.updateConfigEditorStatus('info', i18n.t('config_management.status_disconnected'));
        }

        this.refreshConfigEditor();
        this.lastEditorConnectionState = this.isConnected;
    }

    refreshConfigEditor() {
        const instance = this.configEditorElements && this.configEditorElements.editorInstance;
        if (instance && typeof instance.refresh === 'function') {
            setTimeout(() => instance.refresh(), 0);
        }
    }

    // 更新配置编辑器状态显示
    updateConfigEditorStatus(type, message) {
        const statusEl = (this.configEditorElements && this.configEditorElements.statusEl) || document.getElementById('config-editor-status');
        if (!statusEl) {
            return;
        }

        statusEl.textContent = message;
        statusEl.classList.remove('success', 'error');

        if (type === 'success') {
            statusEl.classList.add('success');
        } else if (type === 'error') {
            statusEl.classList.add('error');
        }
    }

    // 加载配置文件内容
    async loadConfigFileEditor(forceRefresh = false) {
        const { textarea, editorInstance, reloadBtn } = this.configEditorElements;
        if (!textarea && !editorInstance) {
            return;
        }

        if (!this.isConnected) {
            this.updateConfigEditorStatus('info', i18n.t('config_management.status_disconnected'));
            return;
        }

        if (reloadBtn) {
            reloadBtn.disabled = true;
        }
        this.updateConfigEditorStatus('info', i18n.t('config_management.status_loading'));

        try {
            const yamlText = await this.fetchConfigFile(forceRefresh);

            if (editorInstance) {
                editorInstance.setValue(yamlText || '');
                if (typeof editorInstance.markClean === 'function') {
                    editorInstance.markClean();
                }
            } else if (textarea) {
                textarea.value = yamlText || '';
            }

            this.isConfigEditorDirty = false;
            this.updateConfigEditorStatus('success', i18n.t('config_management.status_loaded'));
            this.refreshConfigEditor();
        } catch (error) {
            console.error('加载配置文件失败:', error);
            this.updateConfigEditorStatus('error', `${i18n.t('config_management.status_load_failed')}: ${error.message}`);
        } finally {
            if (reloadBtn) {
                reloadBtn.disabled = !this.isConnected;
            }
        }
    }

    // 获取配置文件内容
    async fetchConfigFile(forceRefresh = false) {
        if (!forceRefresh && this.configYamlCache) {
            return this.configYamlCache;
        }

        const requestUrl = '/config.yaml';

        try {
            const response = await fetch(`${this.apiUrl}${requestUrl}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.managementKey}`,
                    'Accept': 'application/yaml'
                }
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                const message = errorText || `HTTP ${response.status}`;
                throw new Error(message);
            }

            const contentType = response.headers.get('content-type') || '';
            if (!/yaml/i.test(contentType)) {
                throw new Error(i18n.t('config_management.error_yaml_not_supported'));
            }

            const text = await response.text();
            this.lastConfigFetchUrl = requestUrl;
            this.configYamlCache = text;
            return text;
        } catch (error) {
            throw error instanceof Error ? error : new Error(String(error));
        }
    }

    // 保存配置文件
    async saveConfigFile() {
        const { textarea, editorInstance, saveBtn, reloadBtn } = this.configEditorElements;
        if ((!textarea && !editorInstance) || !saveBtn) {
            return;
        }

        if (!this.isConnected) {
            this.updateConfigEditorStatus('error', i18n.t('config_management.status_disconnected'));
            return;
        }

        const yamlText = editorInstance ? editorInstance.getValue() : (textarea ? textarea.value : '');

        saveBtn.disabled = true;
        if (reloadBtn) {
            reloadBtn.disabled = true;
        }
        this.updateConfigEditorStatus('info', i18n.t('config_management.status_saving'));

        try {
            try {
                await this.writeConfigFile('/config.yaml', yamlText);
                this.lastConfigFetchUrl = '/config.yaml';
                this.configYamlCache = yamlText;
                this.isConfigEditorDirty = false;
                if (editorInstance && typeof editorInstance.markClean === 'function') {
                    editorInstance.markClean();
                }
                this.showNotification(i18n.t('config_management.save_success'), 'success');
                this.updateConfigEditorStatus('success', i18n.t('config_management.status_saved'));
                this.clearCache();
                await this.loadAllData(true);
                return;
            } catch (error) {
                const errorMessage = `${i18n.t('config_management.status_save_failed')}: ${error.message}`;
                this.updateConfigEditorStatus('error', errorMessage);
                this.showNotification(errorMessage, 'error');
                this.isConfigEditorDirty = true;
            }
        } finally {
            saveBtn.disabled = !this.isConnected;
            if (reloadBtn) {
                reloadBtn.disabled = !this.isConnected;
            }
        }
    }

    // 写入配置文件到指定端点
    async writeConfigFile(endpoint, yamlText) {
        const response = await fetch(`${this.apiUrl}${endpoint}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${this.managementKey}`,
                'Content-Type': 'application/yaml',
                'Accept': 'application/json, text/plain, */*'
            },
            body: yamlText
        });

        if (!response.ok) {
            const contentType = response.headers.get('content-type') || '';
            let errorText = '';
            if (contentType.includes('application/json')) {
                const data = await response.json().catch(() => ({}));
                errorText = data.message || data.error || '';
            } else {
                errorText = await response.text().catch(() => '');
            }
            throw new Error(errorText || `HTTP ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const data = await response.json().catch(() => null);
            if (data && data.ok === false) {
                throw new Error(data.message || data.error || 'Server rejected the update');
            }
        }
    }

    // 切换语言
    toggleLanguage() {
        const currentLang = i18n.currentLanguage;
        const newLang = currentLang === 'zh-CN' ? 'en-US' : 'zh-CN';
        i18n.setLanguage(newLang);

        // 更新主题按钮文本
        this.updateThemeButtons();

        // 更新连接状态显示
        this.updateConnectionStatus();

        // 重新加载所有数据以更新动态内容
        if (this.isLoggedIn && this.isConnected) {
            this.loadAllData(true);
        }
    }

    // 规范化基础地址，移除尾部斜杠与 /v0/management
    normalizeBase(input) {
        let base = (input || '').trim();
        if (!base) return '';
        // 若用户粘贴了完整地址，剥离后缀
        base = base.replace(/\/?v0\/management\/?$/i, '');
        base = base.replace(/\/+$/i, '');
        // 自动补 http://
        if (!/^https?:\/\//i.test(base)) {
            base = 'http://' + base;
        }
        return base;
    }

    // 由基础地址生成完整管理 API 地址
    computeApiUrl(base) {
        const b = this.normalizeBase(base);
        if (!b) return '';
        return b.replace(/\/$/, '') + '/v0/management';
    }

    setApiBase(newBase) {
        this.apiBase = this.normalizeBase(newBase);
        this.apiUrl = this.computeApiUrl(this.apiBase);
        localStorage.setItem('apiBase', this.apiBase);
        localStorage.setItem('apiUrl', this.apiUrl); // 兼容旧字段
        this.updateLoginConnectionInfo();
    }

    // 加载设置（简化版，仅加载内部状态）
    loadSettings() {
        const savedBase = localStorage.getItem('apiBase');
        const savedUrl = localStorage.getItem('apiUrl');
        const savedKey = localStorage.getItem('managementKey');

        if (savedBase) {
            this.setApiBase(savedBase);
        } else if (savedUrl) {
            const base = (savedUrl || '').replace(/\/?v0\/management\/?$/i, '');
            this.setApiBase(base);
        } else {
            this.setApiBase(this.detectApiBaseFromLocation());
        }

        if (savedKey) {
            this.managementKey = savedKey;
        }

        this.updateLoginConnectionInfo();
    }

    // API 请求方法
    async makeRequest(endpoint, options = {}) {
        const url = `${this.apiUrl}${endpoint}`;
        const headers = {
            'Authorization': `Bearer ${this.managementKey}`,
            'Content-Type': 'application/json',
            ...options.headers
        };

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API请求失败:', error);
            throw error;
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
        }, 3000);
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

    // 测试连接（简化版，用于内部调用）
    async testConnection() {
        try {
            await this.makeRequest('/debug');
            this.isConnected = true;
            this.updateConnectionStatus();
            this.startStatusUpdateTimer();
            await this.loadAllData();
            return true;
        } catch (error) {
            this.isConnected = false;
            this.updateConnectionStatus();
            this.stopStatusUpdateTimer();
            throw error;
        }
    }

    // 更新连接状态
    updateConnectionStatus() {
        const statusButton = document.getElementById('connection-status');
        const apiStatus = document.getElementById('api-status');
        const configStatus = document.getElementById('config-status');
        const lastUpdate = document.getElementById('last-update');

        if (this.isConnected) {
            statusButton.innerHTML = `<i class="fas fa-circle connection-indicator connected"></i> ${i18n.t('common.connected')}`;
            statusButton.className = 'btn btn-success';
            apiStatus.textContent = i18n.t('common.connected');

            // 更新配置状态
            if (this.isCacheValid()) {
                const cacheAge = Math.floor((Date.now() - this.cacheTimestamp) / 1000);
                configStatus.textContent = `${i18n.t('system_info.cache_data')} (${cacheAge}${i18n.t('system_info.seconds_ago')})`;
                configStatus.style.color = '#f59e0b'; // 橙色表示缓存
            } else if (this.configCache) {
                configStatus.textContent = i18n.t('system_info.real_time_data');
                configStatus.style.color = '#10b981'; // 绿色表示实时
            } else {
                configStatus.textContent = i18n.t('system_info.not_loaded');
                configStatus.style.color = '#6b7280'; // 灰色表示未加载
            }
        } else {
            statusButton.innerHTML = `<i class="fas fa-circle connection-indicator disconnected"></i> ${i18n.t('common.disconnected')}`;
            statusButton.className = 'btn btn-danger';
            apiStatus.textContent = i18n.t('common.disconnected');
            configStatus.textContent = i18n.t('system_info.not_loaded');
            configStatus.style.color = '#6b7280';
        }

        lastUpdate.textContent = new Date().toLocaleString('zh-CN');

        if (this.lastEditorConnectionState !== this.isConnected) {
            this.updateConfigEditorAvailability();
        }

        // 更新连接信息显示
        this.updateConnectionInfo();
    }

    // 检查连接状态
    async checkConnectionStatus() {
        await this.testConnection();
    }

    // 刷新所有数据
    async refreshAllData() {
        if (!this.isConnected) {
            this.showNotification(i18n.t('notification.connection_required'), 'error');
            return;
        }

        const button = document.getElementById('refresh-all');
        const originalText = button.innerHTML;

        button.innerHTML = `<div class="loading"></div> ${i18n.t('common.loading')}`;
        button.disabled = true;

        try {
            // 强制刷新，清除缓存
            await this.loadAllData(true);
            this.showNotification(i18n.t('notification.data_refreshed'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.refresh_failed')}: ${error.message}`, 'error');
        } finally {
            button.innerHTML = originalText;
            button.disabled = false;
        }
    }

    // 检查缓存是否有效
    isCacheValid() {
        if (!this.configCache || !this.cacheTimestamp) {
            return false;
        }
        return (Date.now() - this.cacheTimestamp) < this.cacheExpiry;
    }

    // 获取配置（优先使用缓存）
    async getConfig(forceRefresh = false) {
        if (!forceRefresh && this.isCacheValid()) {
            this.updateConnectionStatus(); // 更新状态显示
            return this.configCache;
        }

        try {
            const config = await this.makeRequest('/config');
            this.configCache = config;
            this.cacheTimestamp = Date.now();
            this.updateConnectionStatus(); // 更新状态显示
            return config;
        } catch (error) {
            console.error('获取配置失败:', error);
            throw error;
        }
    }

    // 清除缓存
    clearCache() {
        this.configCache = null;
        this.cacheTimestamp = null;
        this.configYamlCache = '';
    }

    // 启动状态更新定时器
    startStatusUpdateTimer() {
        if (this.statusUpdateTimer) {
            clearInterval(this.statusUpdateTimer);
        }
        this.statusUpdateTimer = setInterval(() => {
            if (this.isConnected) {
                this.updateConnectionStatus();
            }
        }, 1000); // 每秒更新一次
    }

    // 停止状态更新定时器
    stopStatusUpdateTimer() {
        if (this.statusUpdateTimer) {
            clearInterval(this.statusUpdateTimer);
            this.statusUpdateTimer = null;
        }
    }

    // 加载所有数据 - 使用新的 /config 端点一次性获取所有配置
    async loadAllData(forceRefresh = false) {
        try {
            console.log(i18n.t('system_info.real_time_data'));
            // 使用新的 /config 端点一次性获取所有配置
            const config = await this.getConfig(forceRefresh);

            // 获取一次usage统计数据，供渲染函数和loadUsageStats复用
            let usageData = null;
            let keyStats = null;
            try {
                const response = await this.makeRequest('/usage');
                usageData = response?.usage || null;
                if (usageData) {
                    // 从usage数据中提取keyStats
                    const sourceStats = {};
                    const apis = usageData.apis || {};

                    Object.values(apis).forEach(apiEntry => {
                        const models = apiEntry.models || {};

                        Object.values(models).forEach(modelEntry => {
                            const details = modelEntry.details || [];

                            details.forEach(detail => {
                                const source = detail.source;
                                if (!source) return;

                                if (!sourceStats[source]) {
                                    sourceStats[source] = {
                                        success: 0,
                                        failure: 0
                                    };
                                }

                                const isFailed = detail.failed === true;
                                if (isFailed) {
                                    sourceStats[source].failure += 1;
                                } else {
                                    sourceStats[source].success += 1;
                                }
                            });
                        });
                    });

                    keyStats = sourceStats;
                }
            } catch (error) {
                console.warn('获取usage统计失败:', error);
            }

            // 从配置中提取并设置各个设置项（现在传递keyStats）
            await this.updateSettingsFromConfig(config, keyStats);

            // 认证文件需要单独加载，因为不在配置中
            await this.loadAuthFiles(keyStats);

            // 使用统计需要单独加载，复用已获取的usage数据
            await this.loadUsageStats(usageData);

            // 加载配置文件编辑器内容
            await this.loadConfigFileEditor(forceRefresh);
            this.refreshConfigEditor();

            console.log('配置加载完成，使用缓存:', !forceRefresh && this.isCacheValid());
        } catch (error) {
            console.error('加载配置失败:', error);
            console.log('回退到逐个加载方式...');
            // 如果新方法失败，回退到原来的逐个加载方式
            await this.loadAllDataLegacy();
        }
    }

    // 从配置对象更新所有设置
    async updateSettingsFromConfig(config, keyStats = null) {
        // 调试设置
        if (config.debug !== undefined) {
            document.getElementById('debug-toggle').checked = config.debug;
        }

        // 代理设置
        if (config['proxy-url'] !== undefined) {
            document.getElementById('proxy-url').value = config['proxy-url'] || '';
        }

        // 请求重试设置
        if (config['request-retry'] !== undefined) {
            document.getElementById('request-retry').value = config['request-retry'];
        }

        // 配额超出行为
        if (config['quota-exceeded']) {
            if (config['quota-exceeded']['switch-project'] !== undefined) {
                document.getElementById('switch-project-toggle').checked = config['quota-exceeded']['switch-project'];
            }
            if (config['quota-exceeded']['switch-preview-model'] !== undefined) {
                document.getElementById('switch-preview-model-toggle').checked = config['quota-exceeded']['switch-preview-model'];
            }
        }

        if (config['usage-statistics-enabled'] !== undefined) {
            const usageToggle = document.getElementById('usage-statistics-enabled-toggle');
            if (usageToggle) {
                usageToggle.checked = config['usage-statistics-enabled'];
            }
        }

        // 日志记录设置
        if (config['logging-to-file'] !== undefined) {
            const loggingToggle = document.getElementById('logging-to-file-toggle');
            if (loggingToggle) {
                loggingToggle.checked = config['logging-to-file'];
            }
            // 显示或隐藏日志查看栏目
            this.toggleLogsNavItem(config['logging-to-file']);
        }
        if (config['request-log'] !== undefined) {
            const requestLogToggle = document.getElementById('request-log-toggle');
            if (requestLogToggle) {
                requestLogToggle.checked = config['request-log'];
            }
        }
        if (config['ws-auth'] !== undefined) {
            const wsAuthToggle = document.getElementById('ws-auth-toggle');
            if (wsAuthToggle) {
                wsAuthToggle.checked = config['ws-auth'];
            }
        }

        // API 密钥
        if (config['api-keys']) {
            this.renderApiKeys(config['api-keys']);
        }

        // Gemini keys
        await this.renderGeminiKeys(this.getGeminiKeysFromConfig(config), keyStats);

        // Codex 密钥
        await this.renderCodexKeys(Array.isArray(config['codex-api-key']) ? config['codex-api-key'] : [], keyStats);

        // Claude 密钥
        await this.renderClaudeKeys(Array.isArray(config['claude-api-key']) ? config['claude-api-key'] : [], keyStats);

        // OpenAI 兼容提供商
        await this.renderOpenAIProviders(Array.isArray(config['openai-compatibility']) ? config['openai-compatibility'] : [], keyStats);
    }

    // 回退方法：原来的逐个加载方式
    async loadAllDataLegacy() {
        await Promise.all([
            this.loadDebugSettings(),
            this.loadProxySettings(),
            this.loadRetrySettings(),
            this.loadQuotaSettings(),
            this.loadUsageStatisticsSettings(),
            this.loadRequestLogSetting(),
            this.loadWsAuthSetting(),
            this.loadApiKeys(),
            this.loadGeminiKeys(),
            this.loadCodexKeys(),
            this.loadClaudeKeys(),
            this.loadOpenAIProviders(),
            this.loadAuthFiles()
        ]);

        await this.loadConfigFileEditor(true);
        this.refreshConfigEditor();
    }

    // 加载调试设置
    async loadDebugSettings() {
        try {
            const config = await this.getConfig();
            if (config.debug !== undefined) {
                document.getElementById('debug-toggle').checked = config.debug;
            }
        } catch (error) {
            console.error('加载调试设置失败:', error);
        }
    }

    // 更新调试设置
    async updateDebug(enabled) {
        try {
            await this.makeRequest('/debug', {
                method: 'PUT',
                body: JSON.stringify({ value: enabled })
            });
            this.clearCache(); // 清除缓存
            this.showNotification(i18n.t('notification.debug_updated'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
            // 恢复原状态
            document.getElementById('debug-toggle').checked = !enabled;
        }
    }

    // 加载代理设置
    async loadProxySettings() {
        try {
            const config = await this.getConfig();
            if (config['proxy-url'] !== undefined) {
                document.getElementById('proxy-url').value = config['proxy-url'] || '';
            }
        } catch (error) {
            console.error('加载代理设置失败:', error);
        }
    }

    // 更新代理URL
    async updateProxyUrl() {
        const proxyUrl = document.getElementById('proxy-url').value.trim();

        try {
            await this.makeRequest('/proxy-url', {
                method: 'PUT',
                body: JSON.stringify({ value: proxyUrl })
            });
            this.clearCache(); // 清除缓存
            this.showNotification(i18n.t('notification.proxy_updated'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
        }
    }

    // 清空代理URL
    async clearProxyUrl() {
        try {
            await this.makeRequest('/proxy-url', { method: 'DELETE' });
            document.getElementById('proxy-url').value = '';
            this.clearCache(); // 清除缓存
            this.showNotification(i18n.t('notification.proxy_cleared'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
        }
    }

    // 加载重试设置
    async loadRetrySettings() {
        try {
            const config = await this.getConfig();
            if (config['request-retry'] !== undefined) {
                document.getElementById('request-retry').value = config['request-retry'];
            }
        } catch (error) {
            console.error('加载重试设置失败:', error);
        }
    }

    // 更新请求重试
    async updateRequestRetry() {
        const retryCount = parseInt(document.getElementById('request-retry').value);

        try {
            await this.makeRequest('/request-retry', {
                method: 'PUT',
                body: JSON.stringify({ value: retryCount })
            });
            this.clearCache(); // 清除缓存
            this.showNotification(i18n.t('notification.retry_updated'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
        }
    }

    // 加载配额设置
    async loadQuotaSettings() {
        try {
            const config = await this.getConfig();
            if (config['quota-exceeded']) {
                if (config['quota-exceeded']['switch-project'] !== undefined) {
                    document.getElementById('switch-project-toggle').checked = config['quota-exceeded']['switch-project'];
                }
                if (config['quota-exceeded']['switch-preview-model'] !== undefined) {
                    document.getElementById('switch-preview-model-toggle').checked = config['quota-exceeded']['switch-preview-model'];
                }
            }
        } catch (error) {
            console.error('加载配额设置失败:', error);
        }
    }

    // 加载使用统计设置
    async loadUsageStatisticsSettings() {
        try {
            const config = await this.getConfig();
            if (config['usage-statistics-enabled'] !== undefined) {
                const usageToggle = document.getElementById('usage-statistics-enabled-toggle');
                if (usageToggle) {
                    usageToggle.checked = config['usage-statistics-enabled'];
                }
            }
        } catch (error) {
            console.error('加载使用统计设置失败:', error);
        }
    }

    // 加载请求日志设置
    async loadRequestLogSetting() {
        try {
            const config = await this.getConfig();
            if (config['request-log'] !== undefined) {
                const requestLogToggle = document.getElementById('request-log-toggle');
                if (requestLogToggle) {
                    requestLogToggle.checked = config['request-log'];
                }
            }
        } catch (error) {
            console.error('加载请求日志设置失败:', error);
        }
    }

    // 加载 WebSocket 鉴权设置
    async loadWsAuthSetting() {
        try {
            const config = await this.getConfig();
            if (config['ws-auth'] !== undefined) {
                const wsAuthToggle = document.getElementById('ws-auth-toggle');
                if (wsAuthToggle) {
                    wsAuthToggle.checked = config['ws-auth'];
                }
            }
        } catch (error) {
            console.error('加载 WebSocket 鉴权设置失败:', error);
        }
    }

    // 更新使用统计设置
    async updateUsageStatisticsEnabled(enabled) {
        try {
            await this.makeRequest('/usage-statistics-enabled', {
                method: 'PUT',
                body: JSON.stringify({ value: enabled })
            });
            this.clearCache();
            this.showNotification(i18n.t('notification.usage_statistics_updated'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
            const usageToggle = document.getElementById('usage-statistics-enabled-toggle');
            if (usageToggle) {
                usageToggle.checked = !enabled;
            }
        }
    }

    // 更新请求日志设置
    async updateRequestLog(enabled) {
        try {
            await this.makeRequest('/request-log', {
                method: 'PUT',
                body: JSON.stringify({ value: enabled })
            });
            this.clearCache();
            this.showNotification(i18n.t('notification.request_log_updated'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
            const requestLogToggle = document.getElementById('request-log-toggle');
            if (requestLogToggle) {
                requestLogToggle.checked = !enabled;
            }
        }
    }

    // 更新 WebSocket 鉴权设置
    async updateWsAuth(enabled) {
        try {
            await this.makeRequest('/ws-auth', {
                method: 'PUT',
                body: JSON.stringify({ value: enabled })
            });
            this.clearCache();
            this.showNotification(i18n.t('notification.ws_auth_updated'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
            const wsAuthToggle = document.getElementById('ws-auth-toggle');
            if (wsAuthToggle) {
                wsAuthToggle.checked = !enabled;
            }
        }
    }

    // 更新日志记录到文件设置
    async updateLoggingToFile(enabled) {
        try {
            await this.makeRequest('/logging-to-file', {
                method: 'PUT',
                body: JSON.stringify({ value: enabled })
            });
            this.clearCache();
            this.showNotification(i18n.t('notification.logging_to_file_updated'), 'success');
            // 显示或隐藏日志查看栏目
            this.toggleLogsNavItem(enabled);
            // 如果启用了日志记录，自动刷新日志
            if (enabled) {
                setTimeout(() => this.refreshLogs(), 500);
            }
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
            const loggingToggle = document.getElementById('logging-to-file-toggle');
            if (loggingToggle) {
                loggingToggle.checked = !enabled;
            }
        }
    }

    // 切换日志查看栏目的显示/隐藏
    toggleLogsNavItem(show) {
        const logsNavItem = document.getElementById('logs-nav-item');
        if (logsNavItem) {
            logsNavItem.style.display = show ? '' : 'none';
        }
    }

    // 刷新日志
    async refreshLogs(incremental = false) {
        const logsContent = document.getElementById('logs-content');
        if (!logsContent) return;

        try {
            // 如果是增量加载且没有时间戳，则转为全量加载
            if (incremental && !this.latestLogTimestamp) {
                incremental = false;
            }

            // 全量加载时显示加载提示
            if (!incremental) {
                logsContent.innerHTML = '<div class="loading-placeholder" data-i18n="logs.loading">' + i18n.t('logs.loading') + '</div>';
            }

            // 构建请求 URL
            let url = '/logs';
            if (incremental && this.latestLogTimestamp) {
                url += `?after=${this.latestLogTimestamp}`;
            }

            const response = await this.makeRequest(url, {
                method: 'GET'
            });

            if (response && response.lines) {
                // 更新最新时间戳
                if (response['latest-timestamp']) {
                    this.latestLogTimestamp = response['latest-timestamp'];
                }

                if (incremental && response.lines.length > 0) {
                    // 增量加载：追加新日志
                    this.appendLogs(response.lines, response['line-count'] || 0);
                } else if (!incremental && response.lines.length > 0) {
                    // 全量加载：重新渲染，默认滚动到底部显示最新日志
                    this.renderLogs(response.lines, response['line-count'] || response.lines.length, true);
                } else if (!incremental) {
                    // 全量加载但没有日志
                    logsContent.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p data-i18n="logs.empty_title">' +
                        i18n.t('logs.empty_title') + '</p><p data-i18n="logs.empty_desc">' +
                        i18n.t('logs.empty_desc') + '</p></div>';
                    this.latestLogTimestamp = null;
                }
                // 增量加载但没有新日志，不做任何操作
            } else if (!incremental) {
                logsContent.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p data-i18n="logs.empty_title">' +
                    i18n.t('logs.empty_title') + '</p><p data-i18n="logs.empty_desc">' +
                    i18n.t('logs.empty_desc') + '</p></div>';
                this.latestLogTimestamp = null;
            }
        } catch (error) {
            console.error('加载日志失败:', error);
            if (!incremental) {
                // 检查是否是 404 错误（API 不存在）
                const is404 = error.message && (error.message.includes('404') || error.message.includes('Not Found'));

                if (is404) {
                    // API 不存在，提示升级
                    logsContent.innerHTML = '<div class="upgrade-notice"><i class="fas fa-arrow-circle-up"></i><h3 data-i18n="logs.upgrade_required_title">' +
                        i18n.t('logs.upgrade_required_title') + '</h3><p data-i18n="logs.upgrade_required_desc">' +
                        i18n.t('logs.upgrade_required_desc') + '</p></div>';
                } else {
                    // 其他错误
                    logsContent.innerHTML = '<div class="error-state"><i class="fas fa-exclamation-triangle"></i><p data-i18n="logs.load_error">' +
                        i18n.t('logs.load_error') + '</p><p>' + error.message + '</p></div>';
                }
            }
        }
    }

    // 渲染日志内容
    renderLogs(lines, lineCount, scrollToBottom = true) {
        const logsContent = document.getElementById('logs-content');
        if (!logsContent) return;

        if (!lines || lines.length === 0) {
            this.displayedLogLines = [];
            logsContent.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p data-i18n="logs.empty_title">' +
                i18n.t('logs.empty_title') + '</p><p data-i18n="logs.empty_desc">' +
                i18n.t('logs.empty_desc') + '</p></div>';
            return;
        }

        // 过滤掉 /v0/management/ 相关的日志
        const filteredLines = lines.filter(line => !line.includes('/v0/management/'));

        // 限制前端显示的最大行数
        let displayedLines = filteredLines;
        if (filteredLines.length > this.maxDisplayLogLines) {
            const linesToRemove = filteredLines.length - this.maxDisplayLogLines;
            displayedLines = filteredLines.slice(linesToRemove);
        }

        this.displayedLogLines = displayedLines.slice();

        const displayedLineCount = this.displayedLogLines.length;
        logsContent.innerHTML = `
            <div class="logs-info">
                <span><i class="fas fa-list-ol"></i> ${displayedLineCount} ${i18n.t('logs.lines')}</span>
            </div>
            <pre class="logs-text">${this.buildLogsHtml(this.displayedLogLines)}</pre>
        `;

        // 自动滚动到底部
        if (scrollToBottom) {
            const logsTextElement = logsContent.querySelector('.logs-text');
            if (logsTextElement) {
                logsTextElement.scrollTop = logsTextElement.scrollHeight;
            }
        }
    }

    // 追加新日志（增量加载）
    appendLogs(newLines, totalLineCount) {
        const logsContent = document.getElementById('logs-content');
        if (!logsContent) return;

        if (!newLines || newLines.length === 0) {
            return;
        }

        const logsTextElement = logsContent.querySelector('.logs-text');
        const logsInfoElement = logsContent.querySelector('.logs-info');

        // 过滤掉 /v0/management/ 相关的日志
        const filteredNewLines = newLines.filter(line => !line.includes('/v0/management/'));
        if (filteredNewLines.length === 0) {
            return; // 如果过滤后没有新日志，直接返回
        }

        if (!logsTextElement) {
            this.renderLogs(filteredNewLines, totalLineCount || filteredNewLines.length, true);
            return;
        }

        // 检查用户是否正在查看底部（判断是否需要自动滚动）
        const isAtBottom = logsTextElement.scrollHeight - logsTextElement.scrollTop - logsTextElement.clientHeight < 50;

        this.displayedLogLines = this.displayedLogLines.concat(filteredNewLines);
        if (this.displayedLogLines.length > this.maxDisplayLogLines) {
            this.displayedLogLines = this.displayedLogLines.slice(this.displayedLogLines.length - this.maxDisplayLogLines);
        }

        logsTextElement.innerHTML = this.buildLogsHtml(this.displayedLogLines);

        // 更新行数统计（只显示实际显示的行数，最多 10000 行）
        if (logsInfoElement) {
            const displayedLines = this.displayedLogLines.length;
            logsInfoElement.innerHTML = `<span><i class="fas fa-list-ol"></i> ${displayedLines} ${i18n.t('logs.lines')}</span>`;
        }

        // 如果用户在底部，自动滚动到新内容
        if (isAtBottom) {
            logsTextElement.scrollTop = logsTextElement.scrollHeight;
        }
    }

    // 根据日志内容构造高亮 HTML
    buildLogsHtml(lines) {
        if (!lines || lines.length === 0) {
            return '';
        }
        return lines.map(line => {
            // 先过滤掉 [GIN] 2025/11/03 - 18:32:59 部分
            // 匹配模式：[GIN] 后面跟着日期 - 时间
            let processedLine = line.replace(/\[GIN\]\s+\d{4}\/\d{2}\/\d{2}\s+-\s+\d{2}:\d{2}:\d{2}\s+/g, '');

            // 创建标记数组来跟踪需要高亮的位置
            const highlights = [];

            // 1. 检测 HTTP 状态码
            const statusInfo = this.detectHttpStatus(line);
            if (statusInfo) {
                const statusPattern = new RegExp(`\\b${statusInfo.code}\\b`);
                const match = statusPattern.exec(processedLine);
                if (match) {
                    highlights.push({
                        start: match.index,
                        end: match.index + match[0].length,
                        className: `log-status-tag log-status-${statusInfo.bucket}`,
                        priority: 10
                    });
                }
            }

            // 2. 时间戳（只匹配标准格式，排除日期和时间被分隔符分开的情况）
            // 匹配格式：
            // - 2024-01-01 12:00:00 或 2024/01/01 12:00:00（中间只有一个空格）
            // - 2024-01-01T12:00:00
            // - [12:00:00]
            // 排除：2024/01/01 - 12:00:00（中间有 - 分隔符）
            const timestampPattern = /\d{4}[-/]\d{2}[-/]\d{2}[T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?|\[\d{2}:\d{2}:\d{2}\]/g;
            let match;
            while ((match = timestampPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-timestamp',
                    priority: 5
                });
            }

            // 2b. 只匹配在方括号内的完整日期时间（如 [2025-11-03 18:23:14]）
            const bracketTimestampPattern = /\[\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\]/g;
            while ((match = bracketTimestampPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-timestamp',
                    priority: 5
                });
            }

            // 3. 日志级别（只匹配在方括号内的，避免匹配路径中的关键字）
            const levelPattern = /\[(ERROR|ERRO|ERR|FATAL|CRITICAL|CRIT|WARN|WARNING|INFO|DEBUG|TRACE|PANIC)\]/gi;
            while ((match = levelPattern.exec(processedLine)) !== null) {
                const level = match[1].toUpperCase();
                let className = 'log-level';
                if (['ERROR', 'ERRO', 'ERR', 'FATAL', 'CRITICAL', 'CRIT', 'PANIC'].includes(level)) {
                    className += ' log-level-error';
                } else if (['WARN', 'WARNING'].includes(level)) {
                    className += ' log-level-warn';
                } else if (level === 'INFO') {
                    className += ' log-level-info';
                } else if (['DEBUG', 'TRACE'].includes(level)) {
                    className += ' log-level-debug';
                }
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: className,
                    priority: 8
                });
            }

            // 4. HTTP 方法
            const methodPattern = /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)\b/g;
            while ((match = methodPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-http-method',
                    priority: 6
                });
            }

            // 5. URL（仅匹配 HTTP(S) 完整URL，不匹配路径）
            const urlPattern = /(https?:\/\/[^\s<>"]+)/g;
            while ((match = urlPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-path',
                    priority: 4
                });
            }

            // 6. IP 地址
            const ipPattern = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;
            while ((match = ipPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-ip',
                    priority: 7
                });
            }

            // 7. 关键字
            const successPattern = /\b(success|successful|succeeded|completed|ok|done|passed)\b/gi;
            while ((match = successPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-keyword-success',
                    priority: 3
                });
            }

            const errorPattern = /\b(failed|failure|error|exception|panic|fatal|critical|aborted|denied|refused|timeout|invalid)\b/gi;
            while ((match = errorPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-keyword-error',
                    priority: 3
                });
            }

            const warnPattern = /\b(warning|warn|deprecated|slow|retry|retrying)\b/gi;
            while ((match = warnPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-keyword-warn',
                    priority: 3
                });
            }

            // 8. 数字和单位
            const numberPattern = /\b(\d+(?:\.\d+)?)(ms|μs|ns|s|KB|MB|GB|TB|B|%)\b/g;
            while ((match = numberPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-number-unit',
                    priority: 2
                });
            }

            // 移除重叠的高亮（保留优先级高的）
            highlights.sort((a, b) => {
                if (a.start !== b.start) return a.start - b.start;
                return b.priority - a.priority;
            });

            const filteredHighlights = [];
            for (const h of highlights) {
                const overlaps = filteredHighlights.some(existing =>
                    (h.start >= existing.start && h.start < existing.end) ||
                    (h.end > existing.start && h.end <= existing.end) ||
                    (h.start <= existing.start && h.end >= existing.end)
                );
                if (!overlaps) {
                    filteredHighlights.push(h);
                }
            }

            // 构建最终的 HTML
            filteredHighlights.sort((a, b) => a.start - b.start);
            let result = '';
            let lastIndex = 0;

            for (const h of filteredHighlights) {
                // 添加高亮之前的文本
                if (h.start > lastIndex) {
                    result += this.escapeHtml(processedLine.substring(lastIndex, h.start));
                }
                // 添加高亮的文本
                result += `<span class="${h.className}">${this.escapeHtml(processedLine.substring(h.start, h.end))}</span>`;
                lastIndex = h.end;
            }

            // 添加剩余的文本
            if (lastIndex < processedLine.length) {
                result += this.escapeHtml(processedLine.substring(lastIndex));
            }

            return `<span class="log-line">${result}</span>`;
        }).join('');
    }

    // 检测 HTTP 状态码
    detectHttpStatus(line) {
        if (!line) return null;

        // 更精确的 HTTP 状态码匹配模式
        // 匹配：
        // 1. "| 状态码 |"（如：| 200 | 或 |200|）
        // 2. "状态码 -" 或 "状态码-"（如：200 - 45ms 或 200-45ms）
        // 3. "HTTP方法 路径 状态码"（如：GET /api 200）
        // 4. "状态码 OK/Error/等状态文本"（如：200 OK）
        // 5. "status: 状态码" 或 "code: 状态码"
        // 排除：
        // - 文件路径中的数字（如 .go:396）
        // - 端口号（如 :8080）
        // - 普通数字序列

        const patterns = [
            // 匹配 "| 状态码 |" 或 "|状态码|"（日志中常见格式）
            /\|\s*([1-5]\d{2})\s*\|/,
            // 匹配 "状态码 -" 或 "状态码-"
            /\b([1-5]\d{2})\s*-/,
            // 匹配 HTTP 方法后的状态码（GET/POST/等 路径 状态码）
            /\b(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)\s+\S+\s+([1-5]\d{2})\b/,
            // 匹配 "status:" 或 "code:" 后的状态码
            /\b(?:status|code|http)[:\s]+([1-5]\d{2})\b/i,
            // 匹配状态码后跟状态文本（200 OK, 404 Not Found 等）
            /\b([1-5]\d{2})\s+(?:OK|Created|Accepted|No Content|Moved|Found|Bad Request|Unauthorized|Forbidden|Not Found|Method Not Allowed|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b/i
        ];

        for (const pattern of patterns) {
            const match = line.match(pattern);
            if (match) {
                const code = parseInt(match[1], 10);
                if (Number.isNaN(code)) {
                    continue;
                }

                if (code >= 500) {
                    return { code, bucket: '5xx', match: match[1] };
                }
                if (code >= 400) {
                    return { code, bucket: '4xx', match: match[1] };
                }
                if (code >= 300) {
                    return { code, bucket: '3xx', match: match[1] };
                }
                if (code >= 200) {
                    return { code, bucket: '2xx', match: match[1] };
                }
                if (code >= 100) {
                    return { code, bucket: '1xx', match: match[1] };
                }
            }
        }

        return null;
    }

    // 下载日志
    async downloadLogs() {
        try {
            const response = await this.makeRequest('/logs', {
                method: 'GET'
            });

            if (response && response.lines && response.lines.length > 0) {
                // 将数组转换为文本
                const logsText = response.lines.join('\n');
                const blob = new Blob([logsText], { type: 'text/plain' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `cli-proxy-api-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                this.showNotification(i18n.t('logs.download_success'), 'success');
            } else {
                this.showNotification(i18n.t('logs.empty_title'), 'info');
            }
        } catch (error) {
            console.error('下载日志失败:', error);
            this.showNotification(`${i18n.t('notification.download_failed')}: ${error.message}`, 'error');
        }
    }

    // 清空日志
    async clearLogs() {
        if (!confirm(i18n.t('logs.clear_confirm'))) {
            return;
        }

        try {
            const response = await this.makeRequest('/logs', {
                method: 'DELETE'
            });

            // 根据返回的 removed 数量显示通知
            if (response && response.status === 'ok') {
                const removedCount = response.removed || 0;
                const message = `${i18n.t('logs.clear_success')} (${i18n.t('logs.removed')}: ${removedCount} ${i18n.t('logs.lines')})`;
                this.showNotification(message, 'success');
            } else {
                this.showNotification(i18n.t('logs.clear_success'), 'success');
            }

            // 重置时间戳
            this.latestLogTimestamp = null;
            // 全量刷新
            await this.refreshLogs(false);
        } catch (error) {
            console.error('清空日志失败:', error);
            this.showNotification(`${i18n.t('notification.delete_failed')}: ${error.message}`, 'error');
        }
    }

    // 切换日志自动刷新
    toggleLogsAutoRefresh(enabled) {
        if (enabled) {
            // 启动自动刷新
            if (this.logsRefreshTimer) {
                clearInterval(this.logsRefreshTimer);
            }
            this.logsRefreshTimer = setInterval(() => {
                const logsSection = document.getElementById('logs');
                // 只在日志页面可见时刷新
                if (logsSection && logsSection.classList.contains('active')) {
                    // 使用增量加载
                    this.refreshLogs(true);
                }
            }, 5000); // 每5秒刷新一次
            this.showNotification(i18n.t('logs.auto_refresh_enabled'), 'success');
        } else {
            // 停止自动刷新
            if (this.logsRefreshTimer) {
                clearInterval(this.logsRefreshTimer);
                this.logsRefreshTimer = null;
            }
            this.showNotification(i18n.t('logs.auto_refresh_disabled'), 'info');
        }
    }

    // HTML转义工具函数
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 更新项目切换设置
    async updateSwitchProject(enabled) {
        try {
            await this.makeRequest('/quota-exceeded/switch-project', {
                method: 'PUT',
                body: JSON.stringify({ value: enabled })
            });
            this.clearCache(); // 清除缓存
            this.showNotification(i18n.t('notification.quota_switch_project_updated'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
            document.getElementById('switch-project-toggle').checked = !enabled;
        }
    }

    // 更新预览模型切换设置
    async updateSwitchPreviewModel(enabled) {
        try {
            await this.makeRequest('/quota-exceeded/switch-preview-model', {
                method: 'PUT',
                body: JSON.stringify({ value: enabled })
            });
            this.clearCache(); // 清除缓存
            this.showNotification(i18n.t('notification.quota_switch_preview_updated'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
            document.getElementById('switch-preview-model-toggle').checked = !enabled;
        }
    }


    // 加载API密钥
    async loadApiKeys() {
        try {
            const config = await this.getConfig();
            if (config['api-keys']) {
                this.renderApiKeys(config['api-keys']);
            }
        } catch (error) {
            console.error('加载API密钥失败:', error);
        }
    }

    // 渲染API密钥列表
    renderApiKeys(keys) {
        const container = document.getElementById('api-keys-list');

        if (keys.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-key"></i>
                    <h3>${i18n.t('api_keys.empty_title')}</h3>
                    <p>${i18n.t('api_keys.empty_desc')}</p>
                </div>
            `;
            return;
        }

        container.innerHTML = keys.map((key, index) => {
            const normalizedKey = typeof key === 'string' ? key : String(key ?? '');
            const maskedDisplay = this.escapeHtml(this.maskApiKey(normalizedKey));
            const keyArgument = JSON.stringify(normalizedKey).replace(/"/g, '&quot;');
            return `
            <div class="key-item">
                <div class="item-content">
                    <div class="item-title">${i18n.t('api_keys.item_title')} #${index + 1}</div>
                    <div class="item-value">${maskedDisplay}</div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary" onclick="manager.editApiKey(${index}, ${keyArgument})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" onclick="manager.deleteApiKey(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
        }).join('');
    }

    // 遮蔽API密钥显示
    maskApiKey(key) {
        if (key === null || key === undefined) {
            return '';
        }
        const normalizedKey = typeof key === 'string' ? key : String(key);
        if (normalizedKey.length > 8) {
            return normalizedKey.substring(0, 4) + '...' + normalizedKey.substring(normalizedKey.length - 4);
        } else if (normalizedKey.length > 4) {
            return normalizedKey.substring(0, 2) + '...' + normalizedKey.substring(normalizedKey.length - 2);
        } else if (normalizedKey.length > 2) {
            return normalizedKey.substring(0, 1) + '...' + normalizedKey.substring(normalizedKey.length - 1);
        }
        return normalizedKey;
    }

    // HTML 转义，防止 XSS
    escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // 兼容服务端返回的数组结构
    normalizeArrayResponse(data, key) {
        if (Array.isArray(data)) {
            return data;
        }
        if (data && Array.isArray(data[key])) {
            return data[key];
        }
        if (data && Array.isArray(data.items)) {
            return data.items;
        }
        return [];
    }

    // 添加一行自定义请求头输入
    addHeaderField(wrapperId, header = {}) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;

        const row = document.createElement('div');
        row.className = 'header-input-row';
        const keyValue = typeof header.key === 'string' ? header.key : '';
        const valueValue = typeof header.value === 'string' ? header.value : '';
        row.innerHTML = `
            <div class="input-group header-input-group">
                <input type="text" class="header-key-input" placeholder="${i18n.t('common.custom_headers_key_placeholder')}" value="${this.escapeHtml(keyValue)}">
                <span class="header-separator">:</span>
                <input type="text" class="header-value-input" placeholder="${i18n.t('common.custom_headers_value_placeholder')}" value="${this.escapeHtml(valueValue)}">
                <button type="button" class="btn btn-small btn-danger header-remove-btn"><i class="fas fa-trash"></i></button>
            </div>
        `;

        const removeBtn = row.querySelector('.header-remove-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                wrapper.removeChild(row);
                if (wrapper.childElementCount === 0) {
                    this.addHeaderField(wrapperId);
                }
            });
        }

        wrapper.appendChild(row);
    }

    // 填充自定义请求头输入
    populateHeaderFields(wrapperId, headers = null) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;
        wrapper.innerHTML = '';

        const entries = (headers && typeof headers === 'object')
            ? Object.entries(headers).filter(([key, value]) => key && value !== undefined && value !== null)
            : [];

        if (!entries.length) {
            this.addHeaderField(wrapperId);
            return;
        }

        entries.forEach(([key, value]) => this.addHeaderField(wrapperId, { key, value: String(value ?? '') }));
    }

    // 收集自定义请求头输入
    collectHeaderInputs(wrapperId) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return null;

        const rows = Array.from(wrapper.querySelectorAll('.header-input-row'));
        const headers = {};

        rows.forEach(row => {
            const keyInput = row.querySelector('.header-key-input');
            const valueInput = row.querySelector('.header-value-input');
            const key = keyInput ? keyInput.value.trim() : '';
            const value = valueInput ? valueInput.value.trim() : '';
            if (key && value) {
                headers[key] = value;
            }
        });

        return Object.keys(headers).length ? headers : null;
    }

    addApiKeyEntryField(wrapperId, entry = {}) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;

        const row = document.createElement('div');
        row.className = 'api-key-input-row';
        const keyValue = typeof entry?.['api-key'] === 'string' ? entry['api-key'] : '';
        const proxyValue = typeof entry?.['proxy-url'] === 'string' ? entry['proxy-url'] : '';
        row.innerHTML = `
            <div class="input-group api-key-input-group">
                <input type="text" class="api-key-value-input" placeholder="${i18n.t('ai_providers.openai_key_placeholder')}" value="${this.escapeHtml(keyValue)}">
                <input type="text" class="api-key-proxy-input" placeholder="${i18n.t('ai_providers.openai_proxy_placeholder')}" value="${this.escapeHtml(proxyValue)}">
                <button type="button" class="btn btn-small btn-danger api-key-remove-btn"><i class="fas fa-trash"></i></button>
            </div>
        `;

        const removeBtn = row.querySelector('.api-key-remove-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                wrapper.removeChild(row);
                if (wrapper.childElementCount === 0) {
                    this.addApiKeyEntryField(wrapperId);
                }
            });
        }

        wrapper.appendChild(row);
    }

    populateApiKeyEntryFields(wrapperId, entries = []) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;
        wrapper.innerHTML = '';

        if (!Array.isArray(entries) || entries.length === 0) {
            this.addApiKeyEntryField(wrapperId);
            return;
        }

        entries.forEach(entry => this.addApiKeyEntryField(wrapperId, entry));
    }

    collectApiKeyEntryInputs(wrapperId) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return [];

        const rows = Array.from(wrapper.querySelectorAll('.api-key-input-row'));
        const entries = [];

        rows.forEach(row => {
            const keyInput = row.querySelector('.api-key-value-input');
            const proxyInput = row.querySelector('.api-key-proxy-input');
            const key = keyInput ? keyInput.value.trim() : '';
            const proxy = proxyInput ? proxyInput.value.trim() : '';
            if (key) {
                entries.push({ 'api-key': key, 'proxy-url': proxy });
            }
        });

        return entries;
    }

    // 规范化并写入请求头
    applyHeadersToConfig(target, headers) {
        if (!target) {
            return;
        }
        if (headers && typeof headers === 'object' && Object.keys(headers).length) {
            target.headers = { ...headers };
        } else {
            delete target.headers;
        }
    }

    // 渲染请求头徽章
    renderHeaderBadges(headers) {
        if (!headers || typeof headers !== 'object') {
            return '';
        }
        const entries = Object.entries(headers).filter(([key, value]) => key && value !== undefined && value !== null && value !== '');
        if (!entries.length) {
            return '';
        }

        const badges = entries.map(([key, value]) => `
            <span class="header-badge"><strong>${this.escapeHtml(key)}:</strong> ${this.escapeHtml(String(value))}</span>
        `).join('');

        return `
            <div class="item-subtitle header-badges-wrapper">
                <span class="header-badges-label">${i18n.t('common.custom_headers_label')}:</span>
                <div class="header-badge-list">
                    ${badges}
                </div>
            </div>
        `;
    }

    // 构造Codex配置，保持未展示的字段
    buildCodexConfig(apiKey, baseUrl, proxyUrl, original = {}, headers = null) {
        const result = {
            ...original,
            'api-key': apiKey,
            'base-url': baseUrl || '',
            'proxy-url': proxyUrl || ''
        };
        this.applyHeadersToConfig(result, headers);
        return result;
    }

    // 显示添加API密钥模态框
    showAddApiKeyModal() {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');

        modalBody.innerHTML = `
            <h3>${i18n.t('api_keys.add_modal_title')}</h3>
            <div class="form-group">
                <label for="new-api-key">${i18n.t('api_keys.add_modal_key_label')}</label>
                <input type="text" id="new-api-key" placeholder="${i18n.t('api_keys.add_modal_key_placeholder')}">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.cancel')}</button>
                <button class="btn btn-primary" onclick="manager.addApiKey()">${i18n.t('common.add')}</button>
            </div>
        `;

        modal.style.display = 'block';
    }

    // 添加API密钥
    async addApiKey() {
        const newKey = document.getElementById('new-api-key').value.trim();

        if (!newKey) {
            this.showNotification(`${i18n.t('notification.please_enter')} ${i18n.t('notification.api_key')}`, 'error');
            return;
        }

        try {
            const data = await this.makeRequest('/api-keys');
            const currentKeys = data['api-keys'] || [];
            currentKeys.push(newKey);

            await this.makeRequest('/api-keys', {
                method: 'PUT',
                body: JSON.stringify(currentKeys)
            });

            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadApiKeys();
            this.showNotification(i18n.t('notification.api_key_added'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.add_failed')}: ${error.message}`, 'error');
        }
    }

    // 编辑API密钥
    editApiKey(index, currentKey) {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');

        modalBody.innerHTML = `
            <h3>${i18n.t('api_keys.edit_modal_title')}</h3>
            <div class="form-group">
                <label for="edit-api-key">${i18n.t('api_keys.edit_modal_key_label')}</label>
                <input type="text" id="edit-api-key" value="${currentKey}">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.cancel')}</button>
                <button class="btn btn-primary" onclick="manager.updateApiKey(${index})">${i18n.t('common.update')}</button>
            </div>
        `;

        modal.style.display = 'block';
    }

    // 更新API密钥
    async updateApiKey(index) {
        const newKey = document.getElementById('edit-api-key').value.trim();

        if (!newKey) {
            this.showNotification(`${i18n.t('notification.please_enter')} ${i18n.t('notification.api_key')}`, 'error');
            return;
        }

        try {
            await this.makeRequest('/api-keys', {
                method: 'PATCH',
                body: JSON.stringify({ index, value: newKey })
            });

            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadApiKeys();
            this.showNotification(i18n.t('notification.api_key_updated'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
        }
    }

    // 删除API密钥
    async deleteApiKey(index) {
        if (!confirm(i18n.t('api_keys.delete_confirm'))) return;

        try {
            await this.makeRequest(`/api-keys?index=${index}`, { method: 'DELETE' });
            this.clearCache(); // 清除缓存
            this.loadApiKeys();
            this.showNotification(i18n.t('notification.api_key_deleted'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.delete_failed')}: ${error.message}`, 'error');
        }
    }

    // Load Gemini keys
    async loadGeminiKeys() {
        try {
            const config = await this.getConfig();
            const keys = this.getGeminiKeysFromConfig(config);
            await this.renderGeminiKeys(keys);
        } catch (error) {
            console.error('加载Gemini密钥失败:', error);
        }
    }

    // Extract Gemini keys from config with backward compatibility
    getGeminiKeysFromConfig(config) {
        if (!config) {
            return [];
        }

        const geminiKeys = Array.isArray(config['gemini-api-key']) ? config['gemini-api-key'] : [];
        if (geminiKeys.length > 0) {
            return geminiKeys;
        }

        const legacyKeys = Array.isArray(config['generative-language-api-key']) ? config['generative-language-api-key'] : [];
        return legacyKeys
            .map(item => {
                if (item && typeof item === 'object') {
                    return { ...item };
                }
                if (typeof item === 'string') {
                    const trimmed = item.trim();
                    if (trimmed) {
                        return { 'api-key': trimmed };
                    }
                }
                return null;
            })
            .filter(Boolean);
    }

    // Render Gemini key list
    async renderGeminiKeys(keys, keyStats = null) {
        const container = document.getElementById('gemini-keys-list');
        if (!container) {
            return;
        }
        const normalizedList = (Array.isArray(keys) ? keys : []).map(item => {
            let normalized = null;
            if (item && typeof item === 'object') {
                normalized = { ...item };
            } else if (typeof item === 'string') {
                const trimmed = item.trim();
                if (trimmed) {
                    normalized = { 'api-key': trimmed };
                }
            }

            if (normalized && !normalized['base-url'] && normalized['base_url']) {
                normalized['base-url'] = normalized['base_url'];
            }

            return normalized;
        }).filter(config => config && config['api-key']);
        this.cachedGeminiKeys = normalizedList;

        if (normalizedList.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fab fa-google"></i>
                    <h3>${i18n.t('ai_providers.gemini_empty_title')}</h3>
                    <p>${i18n.t('ai_providers.gemini_empty_desc')}</p>
                </div>
            `;
            return;
        }

        // 使用传入的keyStats，如果没有则获取一次
        if (!keyStats) {
            keyStats = await this.getKeyStats();
        }
        const stats = keyStats;

        container.innerHTML = normalizedList.map((config, index) => {
            const rawKey = config['api-key'] || '';
            const masked = this.maskApiKey(rawKey || '');
            const maskedDisplay = this.escapeHtml(masked);
            const keyStats = (rawKey && (stats[rawKey] || stats[masked])) || { success: 0, failure: 0 };
            const configJson = JSON.stringify(config).replace(/"/g, '&quot;');
            const apiKeyJson = JSON.stringify(rawKey || '').replace(/"/g, '&quot;');
            const baseUrl = config['base-url'] || config['base_url'] || '';
            return `
            <div class="key-item">
                <div class="item-content">
                    <div class="item-title">${i18n.t('ai_providers.gemini_item_title')} #${index + 1}</div>
                    <div class="item-value">${maskedDisplay}</div>
                    ${baseUrl ? `<div class="item-subtitle">${i18n.t('common.base_url')}: ${this.escapeHtml(baseUrl)}</div>` : ''}
                    ${this.renderHeaderBadges(config.headers)}
                    <div class="item-stats">
                        <span class="stat-badge stat-success">
                            <i class="fas fa-check-circle"></i> ${i18n.t('stats.success')}: ${keyStats.success}
                        </span>
                        <span class="stat-badge stat-failure">
                            <i class="fas fa-times-circle"></i> ${i18n.t('stats.failure')}: ${keyStats.failure}
                        </span>
                    </div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary" onclick="manager.editGeminiKey(${index}, ${configJson})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" onclick="manager.deleteGeminiKey(${apiKeyJson})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `}).join('');
    }

    // 显示添加Gemini密钥模态框
    showAddGeminiKeyModal() {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');

        modalBody.innerHTML = `
            <h3>${i18n.t('ai_providers.gemini_add_modal_title')}</h3>
            <div class="form-group">
                <label>${i18n.t('ai_providers.gemini_add_modal_key_label')}</label>
                <p class="form-hint">${i18n.t('ai_providers.gemini_add_modal_key_hint')}</p>
                <div id="new-gemini-keys-wrapper" class="api-key-input-list"></div>
                <button type="button" class="btn btn-secondary" onclick="manager.addGeminiKeyField('new-gemini-keys-wrapper')">${i18n.t('ai_providers.gemini_keys_add_btn')}</button>
            </div>
            <div class="form-group">
                <label>${i18n.t('common.custom_headers_label')}</label>
                <p class="form-hint">${i18n.t('common.custom_headers_hint')}</p>
                <div id="new-gemini-headers-wrapper" class="header-input-list"></div>
                <button type="button" class="btn btn-secondary" onclick="manager.addHeaderField('new-gemini-headers-wrapper')">${i18n.t('common.custom_headers_add')}</button>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.cancel')}</button>
                <button class="btn btn-primary" onclick="manager.addGeminiKey()">${i18n.t('common.add')}</button>
            </div>
        `;

        modal.style.display = 'block';
        this.populateGeminiKeyFields('new-gemini-keys-wrapper');
        this.populateHeaderFields('new-gemini-headers-wrapper');
    }

    // 添加Gemini密钥
    async addGeminiKey() {
        const entries = this.collectGeminiKeyFieldInputs('new-gemini-keys-wrapper');
        const headers = this.collectHeaderInputs('new-gemini-headers-wrapper');

        if (!entries.length) {
            this.showNotification(i18n.t('notification.gemini_multi_input_required'), 'error');
            return;
        }

        try {
            const data = await this.makeRequest('/gemini-api-key');
            let currentKeys = Array.isArray(data['gemini-api-key']) ? data['gemini-api-key'] : [];
            const existingKeys = new Set(currentKeys.map(item => item && item['api-key']).filter(Boolean));
            const batchSeen = new Set();

            let successCount = 0;
            let skippedCount = 0;
            let failedCount = 0;

            for (const entry of entries) {
                const apiKey = entry['api-key'];
                if (!apiKey) {
                    continue;
                }

                if (batchSeen.has(apiKey)) {
                    skippedCount++;
                    continue;
                }
                batchSeen.add(apiKey);

                if (existingKeys.has(apiKey)) {
                    skippedCount++;
                    continue;
                }

                const newConfig = { 'api-key': apiKey };
                const baseUrl = entry['base-url'];
                if (baseUrl) {
                    newConfig['base-url'] = baseUrl;
                } else {
                    delete newConfig['base-url'];
                }
                this.applyHeadersToConfig(newConfig, headers);

                const nextKeys = [...currentKeys, newConfig];

                try {
                    await this.makeRequest('/gemini-api-key', {
                        method: 'PUT',
                        body: JSON.stringify(nextKeys)
                    });
                    currentKeys = nextKeys;
                    existingKeys.add(apiKey);
                    successCount++;
                } catch (error) {
                    failedCount++;
                    console.error('Gemini key add failed:', error);
                }
            }

            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadGeminiKeys();

            if (successCount === 1 && skippedCount === 0 && failedCount === 0) {
                this.showNotification(i18n.t('notification.gemini_key_added'), 'success');
                return;
            }

            const summaryTemplate = i18n.t('notification.gemini_multi_summary');
            const summary = summaryTemplate
                .replace('{success}', successCount)
                .replace('{skipped}', skippedCount)
                .replace('{failed}', failedCount);
            const status = failedCount > 0 ? 'warning' : (successCount > 0 ? 'success' : 'info');
            this.showNotification(summary, status);
        } catch (error) {
            this.showNotification(`${i18n.t('notification.gemini_multi_failed')}: ${error.message}`, 'error');
        }
    }

    addGeminiKeyField(wrapperId, entry = {}, options = {}) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;

        const row = document.createElement('div');
        row.className = 'api-key-input-row';
        const apiKeyValue = typeof entry?.['api-key'] === 'string' ? entry['api-key'] : '';
        const baseUrlValue = typeof entry?.['base-url'] === 'string'
            ? entry['base-url']
            : (typeof entry?.['base_url'] === 'string' ? entry['base_url'] : '');
        const allowRemoval = options.allowRemoval !== false;
        const removeButtonHtml = allowRemoval
            ? `<button type="button" class="btn btn-small btn-danger gemini-key-remove-btn"><i class="fas fa-trash"></i></button>`
            : '';
        row.innerHTML = `
            <div class="input-group api-key-input-group">
                <input type="text" class="api-key-value-input" placeholder="${i18n.t('ai_providers.gemini_add_modal_key_placeholder')}" value="${this.escapeHtml(apiKeyValue)}">
                <input type="text" class="api-key-proxy-input" placeholder="${i18n.t('ai_providers.gemini_base_url_placeholder')}" value="${this.escapeHtml(baseUrlValue)}">
                ${removeButtonHtml}
            </div>
        `;

        if (allowRemoval) {
            const removeBtn = row.querySelector('.gemini-key-remove-btn');
            if (removeBtn) {
                removeBtn.addEventListener('click', () => {
                    wrapper.removeChild(row);
                    if (wrapper.childElementCount === 0) {
                        this.addGeminiKeyField(wrapperId, {}, options);
                    }
                });
            }
        }

        wrapper.appendChild(row);
    }

    populateGeminiKeyFields(wrapperId, entries = [], options = {}) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;
        wrapper.innerHTML = '';

        if (!Array.isArray(entries) || entries.length === 0) {
            this.addGeminiKeyField(wrapperId, {}, options);
            return;
        }

        entries.forEach(entry => this.addGeminiKeyField(wrapperId, entry, options));
    }

    collectGeminiKeyFieldInputs(wrapperId) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return [];

        const rows = Array.from(wrapper.querySelectorAll('.api-key-input-row'));
        const entries = [];

        rows.forEach(row => {
            const keyInput = row.querySelector('.api-key-value-input');
            const urlInput = row.querySelector('.api-key-proxy-input');
            const apiKey = keyInput ? keyInput.value.trim() : '';
            const baseUrl = urlInput ? urlInput.value.trim() : '';
            if (apiKey) {
                entries.push({ 'api-key': apiKey, 'base-url': baseUrl });
            }
        });

        return entries;
    }

    // 编辑Gemini密钥
    editGeminiKey(index, config) {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        this.currentGeminiEditConfig = config || {};

        modalBody.innerHTML = `
            <h3>${i18n.t('ai_providers.gemini_edit_modal_title')}</h3>
            <div class="form-group">
                <label>${i18n.t('ai_providers.gemini_edit_modal_key_label')}</label>
                <div id="edit-gemini-keys-wrapper" class="api-key-input-list"></div>
            </div>
            <div class="form-group">
                <label>${i18n.t('common.custom_headers_label')}</label>
                <p class="form-hint">${i18n.t('common.custom_headers_hint')}</p>
                <div id="edit-gemini-headers-wrapper" class="header-input-list"></div>
                <button type="button" class="btn btn-secondary" onclick="manager.addHeaderField('edit-gemini-headers-wrapper')">${i18n.t('common.custom_headers_add')}</button>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.cancel')}</button>
                <button class="btn btn-primary" onclick="manager.updateGeminiKey(${index})">${i18n.t('common.update')}</button>
            </div>
        `;

        modal.style.display = 'block';
        this.populateGeminiKeyFields('edit-gemini-keys-wrapper', [config], { allowRemoval: false });
        this.populateHeaderFields('edit-gemini-headers-wrapper', config.headers || null);
    }

    // 更新Gemini密钥
    async updateGeminiKey(index) {
        const entries = this.collectGeminiKeyFieldInputs('edit-gemini-keys-wrapper');
        if (!entries.length) {
            this.showNotification(i18n.t('notification.please_enter') + ' ' + i18n.t('notification.gemini_api_key'), 'error');
            return;
        }
        const entry = entries[0];
        const newKey = entry['api-key'];
        const baseUrl = entry['base-url'] || '';
        const headers = this.collectHeaderInputs('edit-gemini-headers-wrapper');

        if (!newKey) {
            this.showNotification(i18n.t('notification.please_enter') + ' ' + i18n.t('notification.gemini_api_key'), 'error');
            return;
        }

        try {
            const existingConfig = (this.cachedGeminiKeys && this.cachedGeminiKeys[index]) || this.currentGeminiEditConfig || {};
            const newConfig = { ...existingConfig, 'api-key': newKey };
            if (baseUrl) {
                newConfig['base-url'] = baseUrl;
            } else {
                delete newConfig['base-url'];
            }
            this.applyHeadersToConfig(newConfig, headers);

            await this.makeRequest('/gemini-api-key', {
                method: 'PATCH',
                body: JSON.stringify({ index, value: newConfig })
            });

            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadGeminiKeys();
            this.currentGeminiEditConfig = null;
            this.showNotification(i18n.t('notification.gemini_key_updated'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
        }
    }

    // 删除Gemini密钥
    async deleteGeminiKey(apiKey) {
        if (!confirm(i18n.t('ai_providers.gemini_delete_confirm'))) return;

        try {
            await this.makeRequest(`/gemini-api-key?api-key=${encodeURIComponent(apiKey)}`, { method: 'DELETE' });
            this.clearCache(); // 清除缓存
            this.loadGeminiKeys();
            this.showNotification(i18n.t('notification.gemini_key_deleted'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.delete_failed')}: ${error.message}`, 'error');
        }
    }

    // 加载Codex密钥
    async loadCodexKeys() {
        try {
            const config = await this.getConfig();
            const keys = Array.isArray(config['codex-api-key']) ? config['codex-api-key'] : [];
            await this.renderCodexKeys(keys);
        } catch (error) {
            console.error('加载Codex密钥失败:', error);
        }
    }

    // 渲染Codex密钥列表
    async renderCodexKeys(keys, keyStats = null) {
        const container = document.getElementById('codex-keys-list');
        if (!container) {
            return;
        }
        const list = Array.isArray(keys) ? keys : [];

        if (list.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-code"></i>
                    <h3>${i18n.t('ai_providers.codex_empty_title')}</h3>
                    <p>${i18n.t('ai_providers.codex_empty_desc')}</p>
                </div>
            `;
            return;
        }

        // 使用传入的keyStats，如果没有则获取一次
        if (!keyStats) {
            keyStats = await this.getKeyStats();
        }
        const stats = keyStats;

        container.innerHTML = list.map((config, index) => {
            const rawKey = config['api-key'] || '';
            const masked = this.maskApiKey(rawKey || '');
            const maskedDisplay = this.escapeHtml(masked);
            const keyStats = (rawKey && (stats[rawKey] || stats[masked])) || { success: 0, failure: 0 };
            const deleteArg = JSON.stringify(rawKey).replace(/"/g, '&quot;');
            return `
            <div class="provider-item">
                <div class="item-content">
                    <div class="item-title">${i18n.t('ai_providers.codex_item_title')} #${index + 1}</div>
                    <div class="item-subtitle">${i18n.t('common.api_key')}: ${maskedDisplay}</div>
                    ${config['base-url'] ? `<div class="item-subtitle">${i18n.t('common.base_url')}: ${this.escapeHtml(config['base-url'])}</div>` : ''}
                    ${config['proxy-url'] ? `<div class="item-subtitle">${i18n.t('common.proxy_url')}: ${this.escapeHtml(config['proxy-url'])}</div>` : ''}
                    ${this.renderHeaderBadges(config.headers)}
                    <div class="item-stats">
                        <span class="stat-badge stat-success">
                            <i class="fas fa-check-circle"></i> ${i18n.t('stats.success')}: ${keyStats.success}
                        </span>
                        <span class="stat-badge stat-failure">
                            <i class="fas fa-times-circle"></i> ${i18n.t('stats.failure')}: ${keyStats.failure}
                        </span>
                    </div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary" onclick="manager.editCodexKey(${index}, ${JSON.stringify(config).replace(/"/g, '&quot;')})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" onclick="manager.deleteCodexKey(${deleteArg})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `}).join('');
    }

    // 显示添加Codex密钥模态框
    showAddCodexKeyModal() {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');

        modalBody.innerHTML = `
            <h3>${i18n.t('ai_providers.codex_add_modal_title')}</h3>
            <div class="form-group">
                <label for="new-codex-key">${i18n.t('ai_providers.codex_add_modal_key_label')}</label>
                <input type="text" id="new-codex-key" placeholder="${i18n.t('ai_providers.codex_add_modal_key_placeholder')}">
            </div>
            <div class="form-group">
                <label for="new-codex-url">${i18n.t('ai_providers.codex_add_modal_url_label')}</label>
                <input type="text" id="new-codex-url" placeholder="${i18n.t('ai_providers.codex_add_modal_url_placeholder')}" required>
            </div>
            <div class="form-group">
                <label for="new-codex-proxy">${i18n.t('ai_providers.codex_add_modal_proxy_label')}</label>
                <input type="text" id="new-codex-proxy" placeholder="${i18n.t('ai_providers.codex_add_modal_proxy_placeholder')}">
            </div>
            <div class="form-group">
                <label>${i18n.t('common.custom_headers_label')}</label>
                <p class="form-hint">${i18n.t('common.custom_headers_hint')}</p>
                <div id="new-codex-headers-wrapper" class="header-input-list"></div>
                <button type="button" class="btn btn-secondary" onclick="manager.addHeaderField('new-codex-headers-wrapper')">${i18n.t('common.custom_headers_add')}</button>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.cancel')}</button>
                <button class="btn btn-primary" onclick="manager.addCodexKey()">${i18n.t('common.add')}</button>
            </div>
        `;

        modal.style.display = 'block';
        this.populateHeaderFields('new-codex-headers-wrapper');
    }

    // 添加Codex密钥
    async addCodexKey() {
        const apiKey = document.getElementById('new-codex-key').value.trim();
        const baseUrl = document.getElementById('new-codex-url').value.trim();
        const proxyUrl = document.getElementById('new-codex-proxy').value.trim();
        const headers = this.collectHeaderInputs('new-codex-headers-wrapper');

        if (!apiKey) {
            this.showNotification(i18n.t('notification.field_required'), 'error');
            return;
        }
        if (!baseUrl) {
            this.showNotification(i18n.t('notification.codex_base_url_required'), 'error');
            return;
        }

        try {
            const data = await this.makeRequest('/codex-api-key');
            const currentKeys = this.normalizeArrayResponse(data, 'codex-api-key').map(item => ({ ...item }));

            const newConfig = this.buildCodexConfig(apiKey, baseUrl, proxyUrl, {}, headers);

            currentKeys.push(newConfig);

            await this.makeRequest('/codex-api-key', {
                method: 'PUT',
                body: JSON.stringify(currentKeys)
            });

            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadCodexKeys();
            this.showNotification(i18n.t('notification.codex_config_added'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.add_failed')}: ${error.message}`, 'error');
        }
    }

    // 编辑Codex密钥
    editCodexKey(index, config) {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');

        modalBody.innerHTML = `
            <h3>${i18n.t('ai_providers.codex_edit_modal_title')}</h3>
            <div class="form-group">
                <label for="edit-codex-key">${i18n.t('ai_providers.codex_edit_modal_key_label')}</label>
                <input type="text" id="edit-codex-key" value="${config['api-key']}">
            </div>
            <div class="form-group">
                <label for="edit-codex-url">${i18n.t('ai_providers.codex_edit_modal_url_label')}</label>
                <input type="text" id="edit-codex-url" value="${config['base-url'] || ''}" required>
            </div>
            <div class="form-group">
                <label for="edit-codex-proxy">${i18n.t('ai_providers.codex_edit_modal_proxy_label')}</label>
                <input type="text" id="edit-codex-proxy" value="${config['proxy-url'] || ''}">
            </div>
            <div class="form-group">
                <label>${i18n.t('common.custom_headers_label')}</label>
                <p class="form-hint">${i18n.t('common.custom_headers_hint')}</p>
                <div id="edit-codex-headers-wrapper" class="header-input-list"></div>
                <button type="button" class="btn btn-secondary" onclick="manager.addHeaderField('edit-codex-headers-wrapper')">${i18n.t('common.custom_headers_add')}</button>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.cancel')}</button>
                <button class="btn btn-primary" onclick="manager.updateCodexKey(${index})">${i18n.t('common.update')}</button>
            </div>
        `;

        modal.style.display = 'block';
        this.populateHeaderFields('edit-codex-headers-wrapper', config.headers || null);
    }

    // 更新Codex密钥
    async updateCodexKey(index) {
        const apiKey = document.getElementById('edit-codex-key').value.trim();
        const baseUrl = document.getElementById('edit-codex-url').value.trim();
        const proxyUrl = document.getElementById('edit-codex-proxy').value.trim();
        const headers = this.collectHeaderInputs('edit-codex-headers-wrapper');

        if (!apiKey) {
            this.showNotification(i18n.t('notification.field_required'), 'error');
            return;
        }
        if (!baseUrl) {
            this.showNotification(i18n.t('notification.codex_base_url_required'), 'error');
            return;
        }

        try {
            const listResponse = await this.makeRequest('/codex-api-key');
            const currentList = this.normalizeArrayResponse(listResponse, 'codex-api-key');

            if (!Array.isArray(currentList) || index < 0 || index >= currentList.length) {
                throw new Error('Invalid codex configuration index');
            }

            const original = currentList[index] ? { ...currentList[index] } : {};
            const newConfig = this.buildCodexConfig(apiKey, baseUrl, proxyUrl, original, headers);

            await this.makeRequest('/codex-api-key', {
                method: 'PATCH',
                body: JSON.stringify({ index, value: newConfig })
            });

            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadCodexKeys();
            this.showNotification(i18n.t('notification.codex_config_updated'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
        }
    }

    // 删除Codex密钥
    async deleteCodexKey(apiKey) {
        if (!confirm(i18n.t('ai_providers.codex_delete_confirm'))) return;

        try {
            await this.makeRequest(`/codex-api-key?api-key=${encodeURIComponent(apiKey)}`, { method: 'DELETE' });
            this.clearCache(); // 清除缓存
            this.loadCodexKeys();
            this.showNotification(i18n.t('notification.codex_config_deleted'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.delete_failed')}: ${error.message}`, 'error');
        }
    }

    // 加载Claude密钥
    async loadClaudeKeys() {
        try {
            const config = await this.getConfig();
            const keys = Array.isArray(config['claude-api-key']) ? config['claude-api-key'] : [];
            await this.renderClaudeKeys(keys);
        } catch (error) {
            console.error('加载Claude密钥失败:', error);
        }
    }

    // 渲染Claude密钥列表
    async renderClaudeKeys(keys, keyStats = null) {
        const container = document.getElementById('claude-keys-list');
        if (!container) {
            return;
        }
        const list = Array.isArray(keys) ? keys : [];

        if (list.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-brain"></i>
                    <h3>${i18n.t('ai_providers.claude_empty_title')}</h3>
                    <p>${i18n.t('ai_providers.claude_empty_desc')}</p>
                </div>
            `;
            return;
        }

        // 使用传入的keyStats，如果没有则获取一次
        if (!keyStats) {
            keyStats = await this.getKeyStats();
        }
        const stats = keyStats;

        container.innerHTML = list.map((config, index) => {
            const rawKey = config['api-key'] || '';
            const masked = this.maskApiKey(rawKey || '');
            const maskedDisplay = this.escapeHtml(masked);
            const keyStats = (rawKey && (stats[rawKey] || stats[masked])) || { success: 0, failure: 0 };
            const deleteArg = JSON.stringify(rawKey).replace(/"/g, '&quot;');
            const models = Array.isArray(config.models) ? config.models : [];
            const modelsCountHtml = models.length
                ? `<div class="item-subtitle">${i18n.t('ai_providers.claude_models_count')}: ${models.length}</div>`
                : '';
            const modelsBadgesHtml = this.renderModelBadges(models);
            return `
            <div class="provider-item">
                <div class="item-content">
                    <div class="item-title">${i18n.t('ai_providers.claude_item_title')} #${index + 1}</div>
                    <div class="item-subtitle">${i18n.t('common.api_key')}: ${maskedDisplay}</div>
                    ${config['base-url'] ? `<div class="item-subtitle">${i18n.t('common.base_url')}: ${this.escapeHtml(config['base-url'])}</div>` : ''}
                    ${config['proxy-url'] ? `<div class="item-subtitle">${i18n.t('common.proxy_url')}: ${this.escapeHtml(config['proxy-url'])}</div>` : ''}
                    ${this.renderHeaderBadges(config.headers)}
                    ${modelsCountHtml}
                    ${modelsBadgesHtml}
                    <div class="item-stats">
                        <span class="stat-badge stat-success">
                            <i class="fas fa-check-circle"></i> ${i18n.t('stats.success')}: ${keyStats.success}
                        </span>
                        <span class="stat-badge stat-failure">
                            <i class="fas fa-times-circle"></i> ${i18n.t('stats.failure')}: ${keyStats.failure}
                        </span>
                    </div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary" onclick="manager.editClaudeKey(${index}, ${JSON.stringify(config).replace(/"/g, '&quot;')})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" onclick="manager.deleteClaudeKey(${deleteArg})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `}).join('');
    }

    // 显示添加Claude密钥模态框
    showAddClaudeKeyModal() {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');

        modalBody.innerHTML = `
            <h3>${i18n.t('ai_providers.claude_add_modal_title')}</h3>
            <div class="form-group">
                <label for="new-claude-key">${i18n.t('ai_providers.claude_add_modal_key_label')}</label>
                <input type="text" id="new-claude-key" placeholder="${i18n.t('ai_providers.claude_add_modal_key_placeholder')}">
            </div>
            <div class="form-group">
                <label for="new-claude-url">${i18n.t('ai_providers.claude_add_modal_url_label')}</label>
                <input type="text" id="new-claude-url" placeholder="${i18n.t('ai_providers.claude_add_modal_url_placeholder')}">
            </div>
            <div class="form-group">
                <label for="new-claude-proxy">${i18n.t('ai_providers.claude_add_modal_proxy_label')}</label>
                <input type="text" id="new-claude-proxy" placeholder="${i18n.t('ai_providers.claude_add_modal_proxy_placeholder')}">
            </div>
            <div class="form-group">
                <label>${i18n.t('common.custom_headers_label')}</label>
                <p class="form-hint">${i18n.t('common.custom_headers_hint')}</p>
                <div id="new-claude-headers-wrapper" class="header-input-list"></div>
                <button type="button" class="btn btn-secondary" onclick="manager.addHeaderField('new-claude-headers-wrapper')">${i18n.t('common.custom_headers_add')}</button>
            </div>
            <div class="form-group">
                <label>${i18n.t('ai_providers.claude_models_label')}</label>
                <p class="form-hint">${i18n.t('ai_providers.claude_models_hint')}</p>
                <div id="new-claude-models-wrapper" class="model-input-list"></div>
                <button type="button" class="btn btn-secondary" onclick="manager.addModelField('new-claude-models-wrapper')">${i18n.t('ai_providers.claude_models_add_btn')}</button>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.cancel')}</button>
                <button class="btn btn-primary" onclick="manager.addClaudeKey()">${i18n.t('common.add')}</button>
            </div>
        `;

        modal.style.display = 'block';
        this.populateHeaderFields('new-claude-headers-wrapper');
        this.populateModelFields('new-claude-models-wrapper');
    }

    // 添加Claude密钥
    async addClaudeKey() {
        const apiKey = document.getElementById('new-claude-key').value.trim();
        const baseUrl = document.getElementById('new-claude-url').value.trim();
        const proxyUrl = document.getElementById('new-claude-proxy').value.trim();
        const headers = this.collectHeaderInputs('new-claude-headers-wrapper');
        const models = this.collectModelInputs('new-claude-models-wrapper');

        if (!apiKey) {
            this.showNotification(i18n.t('notification.field_required'), 'error');
            return;
        }

        try {
            const data = await this.makeRequest('/claude-api-key');
            const currentKeys = data['claude-api-key'] || [];

            const newConfig = { 'api-key': apiKey };
            if (baseUrl) {
                newConfig['base-url'] = baseUrl;
            }
            if (proxyUrl) {
                newConfig['proxy-url'] = proxyUrl;
            }
            this.applyHeadersToConfig(newConfig, headers);
            if (models.length) {
                newConfig.models = models;
            }

            currentKeys.push(newConfig);

            await this.makeRequest('/claude-api-key', {
                method: 'PUT',
                body: JSON.stringify(currentKeys)
            });

            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadClaudeKeys();
            this.showNotification(i18n.t('notification.claude_config_added'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.add_failed')}: ${error.message}`, 'error');
        }
    }

    // 编辑Claude密钥
    editClaudeKey(index, config) {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');

        modalBody.innerHTML = `
            <h3>${i18n.t('ai_providers.claude_edit_modal_title')}</h3>
            <div class="form-group">
                <label for="edit-claude-key">${i18n.t('ai_providers.claude_edit_modal_key_label')}</label>
                <input type="text" id="edit-claude-key" value="${config['api-key']}">
            </div>
            <div class="form-group">
                <label for="edit-claude-url">${i18n.t('ai_providers.claude_edit_modal_url_label')}</label>
                <input type="text" id="edit-claude-url" value="${config['base-url'] || ''}">
            </div>
            <div class="form-group">
                <label for="edit-claude-proxy">${i18n.t('ai_providers.claude_edit_modal_proxy_label')}</label>
                <input type="text" id="edit-claude-proxy" value="${config['proxy-url'] || ''}">
            </div>
            <div class="form-group">
                <label>${i18n.t('common.custom_headers_label')}</label>
                <p class="form-hint">${i18n.t('common.custom_headers_hint')}</p>
                <div id="edit-claude-headers-wrapper" class="header-input-list"></div>
                <button type="button" class="btn btn-secondary" onclick="manager.addHeaderField('edit-claude-headers-wrapper')">${i18n.t('common.custom_headers_add')}</button>
            </div>
            <div class="form-group">
                <label>${i18n.t('ai_providers.claude_models_label')}</label>
                <p class="form-hint">${i18n.t('ai_providers.claude_models_hint')}</p>
                <div id="edit-claude-models-wrapper" class="model-input-list"></div>
                <button type="button" class="btn btn-secondary" onclick="manager.addModelField('edit-claude-models-wrapper')">${i18n.t('ai_providers.claude_models_add_btn')}</button>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.cancel')}</button>
                <button class="btn btn-primary" onclick="manager.updateClaudeKey(${index})">${i18n.t('common.update')}</button>
            </div>
        `;

        modal.style.display = 'block';
        this.populateHeaderFields('edit-claude-headers-wrapper', config.headers || null);
        this.populateModelFields('edit-claude-models-wrapper', Array.isArray(config.models) ? config.models : []);
    }

    // 更新Claude密钥
    async updateClaudeKey(index) {
        const apiKey = document.getElementById('edit-claude-key').value.trim();
        const baseUrl = document.getElementById('edit-claude-url').value.trim();
        const proxyUrl = document.getElementById('edit-claude-proxy').value.trim();
        const headers = this.collectHeaderInputs('edit-claude-headers-wrapper');
        const models = this.collectModelInputs('edit-claude-models-wrapper');

        if (!apiKey) {
            this.showNotification(i18n.t('notification.field_required'), 'error');
            return;
        }

        try {
            const newConfig = { 'api-key': apiKey };
            if (baseUrl) {
                newConfig['base-url'] = baseUrl;
            }
            if (proxyUrl) {
                newConfig['proxy-url'] = proxyUrl;
            }
            this.applyHeadersToConfig(newConfig, headers);
            if (models.length) {
                newConfig.models = models;
            }

            await this.makeRequest('/claude-api-key', {
                method: 'PATCH',
                body: JSON.stringify({ index, value: newConfig })
            });

            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadClaudeKeys();
            this.showNotification(i18n.t('notification.claude_config_updated'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
        }
    }

    // 删除Claude密钥
    async deleteClaudeKey(apiKey) {
        if (!confirm(i18n.t('ai_providers.claude_delete_confirm'))) return;

        try {
            await this.makeRequest(`/claude-api-key?api-key=${encodeURIComponent(apiKey)}`, { method: 'DELETE' });
            this.clearCache(); // 清除缓存
            this.loadClaudeKeys();
            this.showNotification(i18n.t('notification.claude_config_deleted'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.delete_failed')}: ${error.message}`, 'error');
        }
    }

    // 加载OpenAI提供商
    async loadOpenAIProviders() {
        try {
            const config = await this.getConfig();
            const providers = Array.isArray(config['openai-compatibility']) ? config['openai-compatibility'] : [];
            await this.renderOpenAIProviders(providers);
        } catch (error) {
            console.error('加载OpenAI提供商失败:', error);
        }
    }

    // 渲染OpenAI提供商列表
    async renderOpenAIProviders(providers, keyStats = null) {
        const container = document.getElementById('openai-providers-list');
        if (!container) {
            return;
        }
        const list = Array.isArray(providers) ? providers : [];

        if (list.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-plug"></i>
                    <h3>${i18n.t('ai_providers.openai_empty_title')}</h3>
                    <p>${i18n.t('ai_providers.openai_empty_desc')}</p>
                </div>
            `;
            // 重置样式
            container.style.maxHeight = '';
            container.style.overflowY = '';
            return;
        }

        // 根据提供商数量设置滚动条
        if (list.length > 5) {
            container.style.maxHeight = '400px';
            container.style.overflowY = 'auto';
        } else {
            container.style.maxHeight = '';
            container.style.overflowY = '';
        }

        // 使用传入的keyStats，如果没有则获取一次
        if (!keyStats) {
            keyStats = await this.getKeyStats();
        }
        const stats = keyStats;

        container.innerHTML = list.map((provider, index) => {
            const item = typeof provider === 'object' && provider !== null ? provider : {};

            // 处理两种API密钥格式：新的 api-key-entries 和旧的 api-keys
            let apiKeyEntries = [];
            if (Array.isArray(item['api-key-entries'])) {
                // 新格式：{api-key: "...", proxy-url: "..."}
                apiKeyEntries = item['api-key-entries'];
            } else if (Array.isArray(item['api-keys'])) {
                // 旧格式：简单的字符串数组
                apiKeyEntries = item['api-keys'].map(key => ({ 'api-key': key }));
            }

            const models = Array.isArray(item.models) ? item.models : [];
            const name = item.name || '';
            const baseUrl = item['base-url'] || '';

            let totalSuccess = 0;
            let totalFailure = 0;

            apiKeyEntries.forEach(entry => {
                const key = entry && entry['api-key'] ? entry['api-key'] : '';
                if (!key) return;
                const masked = this.maskApiKey(key);
                const keyStats = stats[key] || stats[masked] || { success: 0, failure: 0 };
                totalSuccess += keyStats.success;
                totalFailure += keyStats.failure;
            });

            const deleteArg = JSON.stringify(name).replace(/"/g, '&quot;');
            return `
            <div class="provider-item">
                <div class="item-content">
                    <div class="item-title">${this.escapeHtml(name)}</div>
                    <div class="item-subtitle">${i18n.t('common.base_url')}: ${this.escapeHtml(baseUrl)}</div>
                    ${this.renderHeaderBadges(item.headers)}
                    <div class="item-subtitle">${i18n.t('ai_providers.openai_keys_count')}: ${apiKeyEntries.length}</div>
                    <div class="item-subtitle">${i18n.t('ai_providers.openai_models_count')}: ${models.length}</div>
                    ${this.renderModelBadges(models)}
                    <div class="item-stats">
                        <span class="stat-badge stat-success">
                            <i class="fas fa-check-circle"></i> ${i18n.t('stats.success')}: ${totalSuccess}
                        </span>
                        <span class="stat-badge stat-failure">
                            <i class="fas fa-times-circle"></i> ${i18n.t('stats.failure')}: ${totalFailure}
                        </span>
                    </div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary" onclick="manager.editOpenAIProvider(${index}, ${JSON.stringify(item).replace(/"/g, '&quot;')})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" onclick="manager.deleteOpenAIProvider(${deleteArg})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;}).join('');
    }

    // 显示添加OpenAI提供商模态框
    showAddOpenAIProviderModal() {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');

        modalBody.innerHTML = `
            <h3>${i18n.t('ai_providers.openai_add_modal_title')}</h3>
            <div class="form-group">
                <label for="new-provider-name">${i18n.t('ai_providers.openai_add_modal_name_label')}</label>
                <input type="text" id="new-provider-name" placeholder="${i18n.t('ai_providers.openai_add_modal_name_placeholder')}">
            </div>
            <div class="form-group">
                <label for="new-provider-url">${i18n.t('ai_providers.openai_add_modal_url_label')}</label>
                <input type="text" id="new-provider-url" placeholder="${i18n.t('ai_providers.openai_add_modal_url_placeholder')}">
            </div>
            <div class="form-group">
                <label>${i18n.t('ai_providers.openai_add_modal_keys_label')}</label>
                <p class="form-hint">${i18n.t('ai_providers.openai_keys_hint')}</p>
                <div id="new-openai-keys-wrapper" class="api-key-input-list"></div>
                <button type="button" class="btn btn-secondary" onclick="manager.addApiKeyEntryField('new-openai-keys-wrapper')">${i18n.t('ai_providers.openai_keys_add_btn')}</button>
            </div>
            <div class="form-group">
                <label>${i18n.t('common.custom_headers_label')}</label>
                <p class="form-hint">${i18n.t('common.custom_headers_hint')}</p>
                <div id="new-openai-headers-wrapper" class="header-input-list"></div>
                <button type="button" class="btn btn-secondary" onclick="manager.addHeaderField('new-openai-headers-wrapper')">${i18n.t('common.custom_headers_add')}</button>
            </div>
            <div class="form-group">
                <label>${i18n.t('ai_providers.openai_add_modal_models_label')}</label>
                <p class="form-hint">${i18n.t('ai_providers.openai_models_hint')}</p>
                <div id="new-provider-models-wrapper" class="model-input-list"></div>
                <button type="button" class="btn btn-secondary" onclick="manager.addModelField('new-provider-models-wrapper')">${i18n.t('ai_providers.openai_models_add_btn')}</button>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.cancel')}</button>
                <button class="btn btn-primary" onclick="manager.addOpenAIProvider()">${i18n.t('common.add')}</button>
            </div>
        `;

        modal.style.display = 'block';
        this.populateModelFields('new-provider-models-wrapper', []);
        this.populateHeaderFields('new-openai-headers-wrapper');
        this.populateApiKeyEntryFields('new-openai-keys-wrapper');
    }

    // 添加OpenAI提供商
    async addOpenAIProvider() {
        const name = document.getElementById('new-provider-name').value.trim();
        const baseUrl = document.getElementById('new-provider-url').value.trim();
        const apiKeyEntries = this.collectApiKeyEntryInputs('new-openai-keys-wrapper');
        const models = this.collectModelInputs('new-provider-models-wrapper');
        const headers = this.collectHeaderInputs('new-openai-headers-wrapper');

        if (!this.validateOpenAIProviderInput(name, baseUrl, models)) {
            return;
        }

        try {
            const data = await this.makeRequest('/openai-compatibility');
            const currentProviders = data['openai-compatibility'] || [];

            const newProvider = {
                name,
                'base-url': baseUrl,
                'api-key-entries': apiKeyEntries,
                models
            };
            this.applyHeadersToConfig(newProvider, headers);

            currentProviders.push(newProvider);

            await this.makeRequest('/openai-compatibility', {
                method: 'PUT',
                body: JSON.stringify(currentProviders)
            });

            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadOpenAIProviders();
            this.showNotification(i18n.t('notification.openai_provider_added'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.add_failed')}: ${error.message}`, 'error');
        }
    }

    // 编辑OpenAI提供商
    editOpenAIProvider(index, provider) {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');

        // 处理两种API密钥格式：新的 api-key-entries 和旧的 api-keys
        let apiKeyEntries = [];
        if (Array.isArray(provider?.['api-key-entries'])) {
            // 新格式：{api-key: "...", proxy-url: "..."}
            apiKeyEntries = provider['api-key-entries'];
        } else if (Array.isArray(provider?.['api-keys'])) {
            // 旧格式：简单的字符串数组
            apiKeyEntries = provider['api-keys'].map(key => ({ 'api-key': key, 'proxy-url': '' }));
        }

        const models = Array.isArray(provider?.models) ? provider.models : [];

        modalBody.innerHTML = `
            <h3>${i18n.t('ai_providers.openai_edit_modal_title')}</h3>
            <div class="form-group">
                <label for="edit-provider-name">${i18n.t('ai_providers.openai_edit_modal_name_label')}</label>
                <input type="text" id="edit-provider-name" value="${provider?.name ? this.escapeHtml(provider.name) : ''}">
            </div>
            <div class="form-group">
                <label for="edit-provider-url">${i18n.t('ai_providers.openai_edit_modal_url_label')}</label>
                <input type="text" id="edit-provider-url" value="${provider?.['base-url'] ? this.escapeHtml(provider['base-url']) : ''}">
            </div>
            <div class="form-group">
                <label>${i18n.t('ai_providers.openai_edit_modal_keys_label')}</label>
                <p class="form-hint">${i18n.t('ai_providers.openai_keys_hint')}</p>
                <div id="edit-openai-keys-wrapper" class="api-key-input-list"></div>
                <button type="button" class="btn btn-secondary" onclick="manager.addApiKeyEntryField('edit-openai-keys-wrapper')">${i18n.t('ai_providers.openai_keys_add_btn')}</button>
            </div>
            <div class="form-group">
                <label>${i18n.t('common.custom_headers_label')}</label>
                <p class="form-hint">${i18n.t('common.custom_headers_hint')}</p>
                <div id="edit-openai-headers-wrapper" class="header-input-list"></div>
                <button type="button" class="btn btn-secondary" onclick="manager.addHeaderField('edit-openai-headers-wrapper')">${i18n.t('common.custom_headers_add')}</button>
            </div>
            <div class="form-group">
                <label>${i18n.t('ai_providers.openai_edit_modal_models_label')}</label>
                <p class="form-hint">${i18n.t('ai_providers.openai_models_hint')}</p>
                <div id="edit-provider-models-wrapper" class="model-input-list"></div>
                <button type="button" class="btn btn-secondary" onclick="manager.addModelField('edit-provider-models-wrapper')">${i18n.t('ai_providers.openai_models_add_btn')}</button>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.cancel')}</button>
                <button class="btn btn-primary" onclick="manager.updateOpenAIProvider(${index})">${i18n.t('common.update')}</button>
            </div>
        `;

        modal.style.display = 'block';
        this.populateModelFields('edit-provider-models-wrapper', models);
        this.populateHeaderFields('edit-openai-headers-wrapper', provider?.headers || null);
        this.populateApiKeyEntryFields('edit-openai-keys-wrapper', apiKeyEntries);
    }

    // 更新OpenAI提供商
    async updateOpenAIProvider(index) {
        const name = document.getElementById('edit-provider-name').value.trim();
        const baseUrl = document.getElementById('edit-provider-url').value.trim();
        const apiKeyEntries = this.collectApiKeyEntryInputs('edit-openai-keys-wrapper');
        const models = this.collectModelInputs('edit-provider-models-wrapper');
        const headers = this.collectHeaderInputs('edit-openai-headers-wrapper');

        if (!this.validateOpenAIProviderInput(name, baseUrl, models)) {
            return;
        }

        try {
            const updatedProvider = {
                name,
                'base-url': baseUrl,
                'api-key-entries': apiKeyEntries,
                models
            };
            this.applyHeadersToConfig(updatedProvider, headers);

            await this.makeRequest('/openai-compatibility', {
                method: 'PATCH',
                body: JSON.stringify({ index, value: updatedProvider })
            });

            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadOpenAIProviders();
            this.showNotification(i18n.t('notification.openai_provider_updated'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
        }
    }

    // 删除OpenAI提供商
    async deleteOpenAIProvider(name) {
        if (!confirm(i18n.t('ai_providers.openai_delete_confirm'))) return;

        try {
            await this.makeRequest(`/openai-compatibility?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
            this.clearCache(); // 清除缓存
            this.loadOpenAIProviders();
            this.showNotification(i18n.t('notification.openai_provider_deleted'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.delete_failed')}: ${error.message}`, 'error');
        }
    }

    // 加载认证文件
    async loadAuthFiles(keyStats = null) {
        try {
            const data = await this.makeRequest('/auth-files');
            // 如果没有传入keyStats，则获取一次
            if (!keyStats) {
                keyStats = await this.getKeyStats();
            }
            await this.renderAuthFiles(data.files || [], keyStats);
        } catch (error) {
            console.error('加载认证文件失败:', error);
        }
    }

    // 渲染认证文件列表
    async renderAuthFiles(files, keyStats = null) {
        const container = document.getElementById('auth-files-list');
        if (!container) {
            return;
        }

        const allFiles = Array.isArray(files) ? files : [];
        const visibleFiles = allFiles.filter(file => {
            if (!file) return false;
            return this.shouldDisplayDisabledGeminiCli(file) || file.disabled !== true;
        });
        const stats = keyStats || await this.getKeyStats();

        this.cachedAuthFiles = visibleFiles.map(file => ({ ...file }));
        this.authFileStatsCache = stats || {};
        this.syncAuthFileControls();

        if (this.cachedAuthFiles.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-file-alt"></i>
                    <h3>${i18n.t('auth_files.empty_title')}</h3>
                    <p>${i18n.t('auth_files.empty_desc')}</p>
                </div>
            `;
            this.updateFilterButtons(new Set(['all']));
            this.bindAuthFileFilterEvents();
            this.applyAuthFileFilterState(false);
            this.authFilesPagination.currentPage = 1;
            this.authFilesPagination.totalPages = 1;
            this.updatePaginationControls(0);
            return;
        }

        const existingTypes = new Set(['all']);
        this.cachedAuthFiles.forEach(file => {
            if (file.type) {
                existingTypes.add(file.type);
            }
        });

        this.updateFilterButtons(existingTypes);
        this.bindAuthFileFilterEvents();
        this.applyAuthFileFilterState(false);
        this.renderAuthFilesPage(this.authFilesPagination.currentPage);
        this.bindAuthFileActionEvents();
    }

    isRuntimeOnlyAuthFile(file) {
        if (!file) return false;
        const runtimeValue = file.runtime_only;
        return runtimeValue === true || runtimeValue === 'true';
    }

    shouldDisplayDisabledGeminiCli(file) {
        if (!file) return false;
        const provider = typeof file.provider === 'string' ? file.provider.toLowerCase() : '';
        const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
        const isGeminiCli = provider === 'gemini-cli' || type === 'gemini-cli';
        return isGeminiCli && !this.isRuntimeOnlyAuthFile(file);
    }

    resolveAuthFileStats(file, stats = {}) {
        const rawFileName = typeof file?.name === 'string' ? file.name : '';
        const defaultStats = { success: 0, failure: 0 };
        if (!rawFileName) {
            return defaultStats;
        }

        const fromName = stats[rawFileName];
        if (fromName && (fromName.success > 0 || fromName.failure > 0)) {
            return fromName;
        }

        let fileStats = fromName || defaultStats;
        if (fileStats.success === 0 && fileStats.failure === 0) {
            const nameWithoutExt = rawFileName.replace(/\.[^/.]+$/, "");

            if (nameWithoutExt && nameWithoutExt !== rawFileName) {
                const candidateNames = new Set([nameWithoutExt]);
                const normalizedName = nameWithoutExt.toLowerCase();
                const typePrefix = typeof file?.type === 'string' ? file.type.trim().toLowerCase() : '';
                const providerPrefix = typeof file?.provider === 'string' ? file.provider.trim().toLowerCase() : '';
                const prefixList = [];

                if (typePrefix) {
                    prefixList.push(`${typePrefix}-`);
                }
                if (providerPrefix && providerPrefix !== typePrefix) {
                    prefixList.push(`${providerPrefix}-`);
                }

                prefixList.forEach(prefix => {
                    if (prefix && normalizedName.startsWith(prefix)) {
                        const trimmed = nameWithoutExt.substring(prefix.length);
                        if (trimmed) {
                            candidateNames.add(trimmed);
                        }
                    }
                });

                for (const candidate of candidateNames) {
                    const statsByName = stats[candidate];
                    if (statsByName && (statsByName.success > 0 || statsByName.failure > 0)) {
                        return statsByName;
                    }

                    const maskedCandidate = this.maskApiKey(candidate);
                    if (maskedCandidate && maskedCandidate !== candidate) {
                        const statsByMaskedName = stats[maskedCandidate];
                        if (statsByMaskedName && (statsByMaskedName.success > 0 || statsByMaskedName.failure > 0)) {
                            return statsByMaskedName;
                        }
                    }
                }
            }

            const possibleSources = [];

            const match = nameWithoutExt.match(/^([^@]+@[^-]+)-(.+)$/);
            if (match) {
                const email = match[1];
                const projectName = match[2];
                const fullDescription = `${email} (${projectName})`;
                possibleSources.push(this.maskApiKey(fullDescription));
            }

            const typeMatch = nameWithoutExt.match(/^[^-]+-(.+)$/);
            if (typeMatch) {
                possibleSources.push(this.maskApiKey(typeMatch[1]));
            }

            if (nameWithoutExt.startsWith('aistudio-')) {
                possibleSources.push(this.maskApiKey(nameWithoutExt));
            }

            for (const source of possibleSources) {
                if (stats[source] && (stats[source].success > 0 || stats[source].failure > 0)) {
                    return stats[source];
                }
            }
        }

        return fileStats;
    }

    buildAuthFileItemHtml(file) {
        const rawFileName = typeof file?.name === 'string' ? file.name : '';
        const safeFileName = this.escapeHtml(rawFileName);
        const stats = this.authFileStatsCache || {};
        const fileStats = this.resolveAuthFileStats(file, stats);
        const fileType = file.type || 'unknown';
        let typeDisplayKey;
        switch (fileType) {
            case 'qwen':
                typeDisplayKey = 'auth_files.type_qwen';
                break;
            case 'gemini':
                typeDisplayKey = 'auth_files.type_gemini';
                break;
            case 'gemini-cli':
                typeDisplayKey = 'auth_files.type_gemini-cli';
                break;
            case 'aistudio':
                typeDisplayKey = 'auth_files.type_aistudio';
                break;
            case 'claude':
                typeDisplayKey = 'auth_files.type_claude';
                break;
            case 'codex':
                typeDisplayKey = 'auth_files.type_codex';
                break;
            case 'iflow':
                typeDisplayKey = 'auth_files.type_iflow';
                break;
            case 'vertex':
                typeDisplayKey = 'auth_files.type_vertex';
                break;
            case 'empty':
                typeDisplayKey = 'auth_files.type_empty';
                break;
            default:
                typeDisplayKey = 'auth_files.type_unknown';
                break;
        }
        const typeBadge = `<span class="file-type-badge ${fileType}">${i18n.t(typeDisplayKey)}</span>`;
        const isRuntimeOnly = this.isRuntimeOnlyAuthFile(file);
        const shouldShowMainFlag = this.shouldDisplayDisabledGeminiCli(file);
        const mainFlagButton = shouldShowMainFlag ? `
                            <button class="btn-small btn-warning main-flag-btn" title="主" disabled>主</button>` : '';
        const actionsHtml = isRuntimeOnly ? `
                        <div class="item-actions">
                            <span class="virtual-auth-badge">虚拟认证文件</span>
                        </div>` : `
                        <div class="item-actions" data-filename="${safeFileName}">
                            ${mainFlagButton}
                            <button class="btn-small btn-info" data-action="showDetails" title="详细信息">
                                <i class="fas fa-info-circle"></i>
                            </button>
                            <button class="btn-small btn-primary" data-action="download" title="下载">
                                <i class="fas fa-download"></i>
                            </button>
                            <button class="btn-small btn-danger" data-action="delete" title="删除">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>`;

        return `
            <div class="file-item" data-file-type="${fileType}" data-file-name="${safeFileName}" ${isRuntimeOnly ? 'data-runtime-only="true"' : ''}>
                <div class="item-content">
                    <div class="item-title">${typeBadge}${safeFileName}</div>
                    <div class="item-meta">
                        <span class="item-subtitle">${i18n.t('auth_files.file_modified')}: ${new Date(file.modtime).toLocaleString(i18n.currentLanguage === 'zh-CN' ? 'zh-CN' : 'en-US')}</span>
                        <span class="item-subtitle">${i18n.t('auth_files.file_size')}: ${this.formatFileSize(file.size)}</span>
                    </div>
                    <div class="item-footer">
                        <div class="item-stats">
                            <span class="stat-badge stat-success">
                                <i class="fas fa-check-circle"></i> ${i18n.t('stats.success')}: ${fileStats.success}
                            </span>
                            <span class="stat-badge stat-failure">
                                <i class="fas fa-times-circle"></i> ${i18n.t('stats.failure')}: ${fileStats.failure}
                            </span>
                        </div>
                        ${actionsHtml}
                    </div>
                </div>
            </div>
        `;
    }

    getFilteredAuthFiles(filterType = this.currentAuthFileFilter) {
        const files = Array.isArray(this.cachedAuthFiles) ? this.cachedAuthFiles : [];
        const filterValue = (filterType || 'all').toLowerCase();
        const keyword = (this.authFileSearchQuery || '').trim().toLowerCase();

        return files.filter(file => {
            if (!file) return false;
            const type = (file.type || 'unknown').toLowerCase();
            const name = (file.name || '').toLowerCase();
            const provider = (file.provider || '').toLowerCase();

            const matchesType = filterValue === 'all' ? true : type === filterValue;
            if (!matchesType) return false;

            if (!keyword) return true;
            return name.includes(keyword) || type.includes(keyword) || provider.includes(keyword);
        });
    }

    updateAuthFileSearchQuery(value = '') {
        const normalized = (value || '').trim();
        if (this.authFileSearchQuery === normalized) {
            return;
        }
        this.authFileSearchQuery = normalized;
        this.authFilesPagination.currentPage = 1;
        this.renderAuthFilesPage(1);
    }

    updateAuthFilesPageSize(value) {
        const normalized = this.normalizeAuthFilesPageSize(value);
        if (this.authFilesPagination?.pageSize === normalized) {
            this.syncAuthFileControls();
            return;
        }
        this.authFilesPagination.pageSize = normalized;
        this.authFilesPagination.currentPage = 1;
        try {
            localStorage.setItem(this.authFilesPageSizeKey, `${normalized}`);
        } catch (error) {
            console.warn('Failed to persist auth files page size:', error);
        }
        this.syncAuthFileControls();
        this.renderAuthFilesPage(1);
    }

    syncAuthFileControls() {
        const searchInput = document.getElementById('auth-files-search-input');
        if (searchInput && searchInput.value !== this.authFileSearchQuery) {
            searchInput.value = this.authFileSearchQuery;
        }

        const pageSizeInput = document.getElementById('auth-files-page-size-input');
        const targetSize = this.authFilesPagination?.pageSize || 9;
        if (pageSizeInput && parseInt(pageSizeInput.value, 10) !== targetSize) {
            pageSizeInput.value = targetSize;
        }
    }

    bindAuthFilesSearchControl() {
        const searchInput = document.getElementById('auth-files-search-input');
        if (!searchInput) return;

        if (searchInput._authFileSearchListener) {
            searchInput.removeEventListener('input', searchInput._authFileSearchListener);
        }

        const debounced = this.debounce((value) => {
            this.updateAuthFileSearchQuery(value);
        }, 250);

        const listener = (event) => {
            const value = event?.target?.value ?? '';
            debounced(value);
        };

        searchInput._authFileSearchListener = listener;
        searchInput.addEventListener('input', listener);
    }

    bindAuthFilesPageSizeControl() {
        const pageSizeInput = document.getElementById('auth-files-page-size-input');
        if (!pageSizeInput) return;

        if (pageSizeInput._authFilePageSizeListener) {
            pageSizeInput.removeEventListener('change', pageSizeInput._authFilePageSizeListener);
        }

        const listener = (event) => {
            const value = parseInt(event?.target?.value, 10);
            if (!Number.isFinite(value)) {
                return;
            }
            this.updateAuthFilesPageSize(value);
        };

        pageSizeInput._authFilePageSizeListener = listener;
        pageSizeInput.addEventListener('change', listener);

        if (pageSizeInput._authFilePageSizeBlur) {
            pageSizeInput.removeEventListener('blur', pageSizeInput._authFilePageSizeBlur);
        }

        const blurListener = () => {
            if (!pageSizeInput.value) {
                this.syncAuthFileControls();
            }
        };

        pageSizeInput._authFilePageSizeBlur = blurListener;
        pageSizeInput.addEventListener('blur', blurListener);
    }

    renderAuthFilesPage(page = null) {
        const container = document.getElementById('auth-files-list');
        if (!container) return;

        const pageSize = this.authFilesPagination?.pageSize || 9;
        const filteredFiles = this.getFilteredAuthFiles();
        const totalItems = filteredFiles.length;
        const hasCachedFiles = Array.isArray(this.cachedAuthFiles) && this.cachedAuthFiles.length > 0;
        const filterApplied = (this.currentAuthFileFilter && this.currentAuthFileFilter !== 'all');
        const searchApplied = Boolean((this.authFileSearchQuery || '').trim());

        if (totalItems === 0) {
            const titleKey = hasCachedFiles && (filterApplied || searchApplied)
                ? 'auth_files.search_empty_title'
                : 'auth_files.empty_title';
            const descKey = hasCachedFiles && (filterApplied || searchApplied)
                ? 'auth_files.search_empty_desc'
                : 'auth_files.empty_desc';
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-file-alt"></i>
                    <h3>${i18n.t(titleKey)}</h3>
                    <p>${i18n.t(descKey)}</p>
                </div>
            `;
            this.authFilesPagination.currentPage = 1;
            this.authFilesPagination.totalPages = 1;
            this.updatePaginationControls(0);
            return;
        }

        const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
        let targetPage = typeof page === 'number' ? page : (this.authFilesPagination.currentPage || 1);
        targetPage = Math.max(1, Math.min(targetPage, totalPages));

        this.authFilesPagination.currentPage = targetPage;
        this.authFilesPagination.totalPages = totalPages;

        const startIndex = (targetPage - 1) * pageSize;
        const pageFiles = filteredFiles.slice(startIndex, startIndex + pageSize);
        container.innerHTML = pageFiles.map(file => this.buildAuthFileItemHtml(file)).join('');

        this.updatePaginationControls(totalItems);
    }

    updatePaginationControls(totalItems = 0) {
        const paginationContainer = document.getElementById('auth-files-pagination');
        const infoEl = document.getElementById('auth-files-pagination-info');
        if (!paginationContainer || !infoEl) return;

        const prevBtn = paginationContainer.querySelector('button[data-action="prev"]');
        const nextBtn = paginationContainer.querySelector('button[data-action="next"]');
        const pageSize = this.authFilesPagination?.pageSize || 9;
        const totalPages = this.authFilesPagination?.totalPages || 1;
        const currentPage = Math.min(this.authFilesPagination?.currentPage || 1, totalPages);
        const shouldShow = totalItems > pageSize;

        paginationContainer.style.display = shouldShow ? 'flex' : 'none';

        const infoParams = totalItems === 0
            ? { current: 0, total: 0, count: 0 }
            : { current: currentPage, total: totalPages, count: totalItems };
        infoEl.textContent = i18n.t('auth_files.pagination_info', infoParams);

        if (prevBtn) {
            prevBtn.disabled = currentPage <= 1;
        }
        if (nextBtn) {
            nextBtn.disabled = currentPage >= totalPages;
        }
    }

    bindAuthFilesPaginationEvents() {
        const container = document.getElementById('auth-files-pagination');
        if (!container) return;

        const oldListener = container._paginationListener;
        if (oldListener) {
            container.removeEventListener('click', oldListener);
        }

        const listener = (event) => {
            const button = event.target.closest('button[data-action]');
            if (!button || !container.contains(button)) return;
            event.preventDefault();
            const action = button.dataset.action;
            const currentPage = this.authFilesPagination?.currentPage || 1;
            if (action === 'prev') {
                this.renderAuthFilesPage(currentPage - 1);
            } else if (action === 'next') {
                this.renderAuthFilesPage(currentPage + 1);
            }
        };

        container._paginationListener = listener;
        container.addEventListener('click', listener);
    }

// 更新筛选按钮显示
    updateFilterButtons(existingTypes) {
        const filterContainer = document.querySelector('.auth-file-filter');
        if (!filterContainer) return;

        // 预定义的按钮顺序和显示文本
        const predefinedTypes = [
            { type: 'all', labelKey: 'auth_files.filter_all' },
            { type: 'qwen', labelKey: 'auth_files.filter_qwen' },
            { type: 'gemini', labelKey: 'auth_files.filter_gemini' },
            { type: 'gemini-cli', labelKey: 'auth_files.filter_gemini-cli' },
            { type: 'aistudio', labelKey: 'auth_files.filter_aistudio' },
            { type: 'claude', labelKey: 'auth_files.filter_claude' },
            { type: 'codex', labelKey: 'auth_files.filter_codex' },
            { type: 'iflow', labelKey: 'auth_files.filter_iflow' },
            { type: 'vertex', labelKey: 'auth_files.filter_vertex' },
            { type: 'empty', labelKey: 'auth_files.filter_empty' }
        ];

        // 获取现有按钮
        const existingButtons = filterContainer.querySelectorAll('.filter-btn');
        const existingButtonTypes = new Set();
        existingButtons.forEach(btn => {
            existingButtonTypes.add(btn.dataset.type);
        });

        // 显示/隐藏预定义按钮
        existingButtons.forEach(btn => {
            const btnType = btn.dataset.type;
            if (existingTypes.has(btnType)) {
                btn.style.display = 'inline-block';
                const match = predefinedTypes.find(item => item.type === btnType);
                if (match) {
                    btn.textContent = i18n.t(match.labelKey);
                    btn.setAttribute('data-i18n-text', match.labelKey);
                }
            } else {
                btn.style.display = 'none';
            }
        });

        // 为未知类型添加新按钮
        const predefinedTypeSet = new Set(predefinedTypes.map(t => t.type));
        existingTypes.forEach(type => {
            if (type !== 'all' && !predefinedTypeSet.has(type) && !existingButtonTypes.has(type)) {
                // 创建新按钮
                const btn = document.createElement('button');
                btn.className = 'filter-btn';
                btn.dataset.type = type;

                const match = predefinedTypes.find(item => item.type === type);
                if (match) {
                    btn.setAttribute('data-i18n-text', match.labelKey);
                    btn.textContent = i18n.t(match.labelKey);
                } else {
                    const dynamicKey = `auth_files.filter_${type}`;
                    btn.setAttribute('data-i18n-text', dynamicKey);
                    btn.textContent = this.generateDynamicTypeLabel(type);
                }

                // 插入到 Empty 按钮之前（如果存在）
                const emptyBtn = filterContainer.querySelector('[data-type="empty"]');
                if (emptyBtn) {
                    filterContainer.insertBefore(btn, emptyBtn);
                } else {
                    filterContainer.appendChild(btn);
                }
            }
        });
    }

    // 处理筛选按钮点击
    handleFilterClick(clickedBtn, options = {}) {
        if (!clickedBtn) return;
        const { skipRender = false } = options;
        const filterBtns = document.querySelectorAll('.auth-file-filter .filter-btn');

        filterBtns.forEach(b => b.classList.remove('active'));
        clickedBtn.classList.add('active');

        const filterType = clickedBtn.dataset.type;
        this.currentAuthFileFilter = filterType || 'all';

        if (!skipRender) {
            this.authFilesPagination.currentPage = 1;
            this.renderAuthFilesPage(1);
        }

        this.refreshFilterButtonTexts();
    }

    // 生成动态类型标签
    generateDynamicTypeLabel(type) {
        if (!type) return '';
        const key = `auth_files.type_${type}`;
        const translated = i18n.t(key);
        if (translated && translated !== key) {
            return translated;
        }
        if (type.toLowerCase() === 'iflow') return 'iFlow';
        return type.charAt(0).toUpperCase() + type.slice(1);
    }

    // 绑定认证文件筛选事件
    bindAuthFileFilterEvents() {
        const filterContainer = document.querySelector('.auth-file-filter');
        if (!filterContainer) return;

        // 清理旧的监听器，避免重复绑定
        if (filterContainer._filterListener) {
            filterContainer.removeEventListener('click', filterContainer._filterListener);
        }

        const listener = (event) => {
            const button = event.target.closest('.filter-btn');
            if (!button || !filterContainer.contains(button)) return;
            event.preventDefault();
            this.handleFilterClick(button);
        };

        filterContainer._filterListener = listener;
        filterContainer.addEventListener('click', listener);

        // 首次渲染时刷新按钮文本
        this.refreshFilterButtonTexts();
    }

    // Apply current filter selection to the list
    applyAuthFileFilterState(shouldRender = false) {
        const filterContainer = document.querySelector('.auth-file-filter');
        if (!filterContainer) return;

        const currentType = this.currentAuthFileFilter || 'all';
        const buttons = filterContainer.querySelectorAll('.filter-btn');
        if (buttons.length === 0) return;

        let targetButton = null;
        buttons.forEach(btn => {
            if (btn.dataset.type === currentType) {
                targetButton = btn;
            }
        });

        if (!targetButton) {
            targetButton = filterContainer.querySelector('.filter-btn[data-type="all"]') || buttons[0];
            if (targetButton) {
                this.currentAuthFileFilter = targetButton.dataset.type || 'all';
            }
        }

        if (targetButton) {
            this.handleFilterClick(targetButton, { skipRender: !shouldRender });
        }
    }

    // Remove deleted auth files from cache and DOM instantly
    removeAuthFileElements(filenames = []) {
        if (!Array.isArray(filenames) || filenames.length === 0) {
            return;
        }

        const removalSet = new Set(filenames);
        this.cachedAuthFiles = (this.cachedAuthFiles || []).filter(file => file && !removalSet.has(file.name));

        if (!this.cachedAuthFiles.length) {
            this.authFilesPagination.currentPage = 1;
        }
        this.renderAuthFilesPage(this.authFilesPagination.currentPage);
    }

    // 刷新筛选按钮文本（根据 data-i18n-text）
    refreshFilterButtonTexts() {
        document.querySelectorAll('.auth-file-filter .filter-btn[data-i18n-text]').forEach(btn => {
            const key = btn.getAttribute('data-i18n-text');
            if (key) {
                btn.textContent = i18n.t(key);
            }
        });
    }

    // 绑定认证文件操作按钮事件（使用事件委托）
    bindAuthFileActionEvents() {
        const container = document.getElementById('auth-files-list');
        if (!container) return;

        // 移除旧的事件监听器（如果存在）
        const oldListener = container._authFileActionListener;
        if (oldListener) {
            container.removeEventListener('click', oldListener);
        }

        // 创建新的事件监听器
        const listener = (e) => {
            // 查找最近的按钮元素
            const button = e.target.closest('button[data-action]');
            if (!button) return;

            // 获取操作类型和文件名
            const action = button.dataset.action;
            const actionsContainer = button.closest('.item-actions');
            if (!actionsContainer) return;

            const filename = actionsContainer.dataset.filename;
            if (!filename) return;

            // 根据操作类型调用相应的方法
            switch (action) {
                case 'showDetails':
                    this.showAuthFileDetails(filename);
                    break;
                case 'download':
                    this.downloadAuthFile(filename);
                    break;
                case 'delete':
                    this.deleteAuthFile(filename);
                    break;
            }
        };

        // 保存监听器引用以便后续移除
        container._authFileActionListener = listener;
        
        // 添加事件监听器
        container.addEventListener('click', listener);
    }

    // 格式化文件大小
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // ===== Vertex AI Credential Import =====
    openVertexFilePicker() {
        const fileInput = document.getElementById('vertex-file-input');
        if (fileInput) {
            fileInput.click();
        }
    }

    handleVertexFileSelection(event) {
        const fileInput = event?.target;
        const file = fileInput?.files?.[0] || null;

        if (fileInput) {
            fileInput.value = '';
        }

        if (file && !file.name.toLowerCase().endsWith('.json')) {
            this.showNotification(i18n.t('vertex_import.file_required'), 'error');
            this.vertexImportState.file = null;
            this.updateVertexFileDisplay();
            this.updateVertexImportButtonState();
            return;
        }

        this.vertexImportState.file = file;
        this.updateVertexFileDisplay(file ? file.name : '');
        this.updateVertexImportButtonState();
    }

    updateVertexFileDisplay(filename = '') {
        const displayInput = document.getElementById('vertex-file-display');
        if (!displayInput) return;
        displayInput.value = filename || '';
    }

    updateVertexImportButtonState() {
        const importBtn = document.getElementById('vertex-import-btn');
        if (!importBtn) return;
        const disabled = !this.vertexImportState.file || this.vertexImportState.loading;
        importBtn.disabled = disabled;
    }

    async importVertexCredential() {
        if (!this.vertexImportState.file) {
            this.showNotification(i18n.t('vertex_import.file_required'), 'error');
            return;
        }

        const locationInput = document.getElementById('vertex-location');
        const location = locationInput ? locationInput.value.trim() : '';
        const formData = new FormData();
        formData.append('file', this.vertexImportState.file, this.vertexImportState.file.name);
        if (location) {
            formData.append('location', location);
        }

        try {
            this.vertexImportState.loading = true;
            this.updateVertexImportButtonState();

            const response = await fetch(`${this.apiUrl}/vertex/import`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.managementKey}`
                },
                body: formData
            });

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData?.message || errorData?.error || errorMessage;
                } catch (parseError) {
                    const text = await response.text();
                    if (text) {
                        errorMessage = text;
                    }
                }
                throw new Error(errorMessage);
            }

            const result = await response.json();
            this.showNotification(i18n.t('vertex_import.success'), 'success');
            this.renderVertexImportResult(result);
            this.vertexImportState.file = null;
            this.updateVertexFileDisplay();
            this.clearCache();
            await this.loadAuthFiles();
        } catch (error) {
            this.showNotification(`${i18n.t('notification.upload_failed')}: ${error.message}`, 'error');
        } finally {
            this.vertexImportState.loading = false;
            this.updateVertexImportButtonState();
            const fileInput = document.getElementById('vertex-file-input');
            if (fileInput) {
                fileInput.value = '';
            }
        }
    }

    renderVertexImportResult(result = null) {
        const container = document.getElementById('vertex-import-result');
        const projectEl = document.getElementById('vertex-result-project');
        const emailEl = document.getElementById('vertex-result-email');
        const locationEl = document.getElementById('vertex-result-location');
        const fileEl = document.getElementById('vertex-result-file');

        if (!container || !projectEl || !emailEl || !locationEl || !fileEl) {
            return;
        }

        if (!result) {
            this.vertexImportState.result = null;
            container.style.display = 'none';
            projectEl.textContent = '-';
            emailEl.textContent = '-';
            locationEl.textContent = '-';
            fileEl.textContent = '-';
            return;
        }

        this.vertexImportState.result = result;
        projectEl.textContent = result.project_id || '-';
        emailEl.textContent = result.email || '-';
        locationEl.textContent = result.location || 'us-central1';
        fileEl.textContent = result['auth-file'] || result.auth_file || '-';
        container.style.display = 'block';
    }

    // 上传认证文件
    uploadAuthFile() {
        document.getElementById('auth-file-input').click();
    }

    // 处理文件上传
    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!file.name.endsWith('.json')) {
            this.showNotification(i18n.t('auth_files.upload_error_json'), 'error');
            return;
        }

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(`${this.apiUrl}/auth-files`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.managementKey}`
                },
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            this.clearCache(); // 清除缓存
            this.loadAuthFiles();
            this.showNotification(i18n.t('auth_files.upload_success'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.upload_failed')}: ${error.message}`, 'error');
        }

        // 清空文件输入
        event.target.value = '';
    }

    // 显示认证文件详细信息
    async showAuthFileDetails(filename) {
        try {
            const response = await fetch(`${this.apiUrl}/auth-files/download?name=${encodeURIComponent(filename)}`, {
                headers: {
                    'Authorization': `Bearer ${this.managementKey}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const jsonData = await response.json();
            
            // 格式化JSON数据
            const formattedJson = JSON.stringify(jsonData, null, 2);
            
            // 显示模态框
            this.showJsonModal(filename, formattedJson);
        } catch (error) {
            this.showNotification(`读取文件详情失败: ${error.message}`, 'error');
        }
    }

    // 显示JSON模态框
    showJsonModal(filename, jsonContent) {
        // 创建模态框HTML
        const safeFilename = this.escapeHtml(filename || '');
        const modalHtml = `
            <div id="json-modal" class="json-modal">
                <div class="json-modal-content">
                    <div class="json-modal-header">
                        <h3><i class="fas fa-file-code"></i> ${safeFilename}</h3>
                        <button class="json-modal-close" data-action="close">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="json-modal-body">
                        <pre class="json-content">${this.escapeHtml(jsonContent)}</pre>
                    </div>
                    <div class="json-modal-footer">
                        <button class="btn btn-secondary" data-action="copy">
                            <i class="fas fa-copy"></i> ${i18n.t('common.copy')}
                        </button>
                        <button class="btn btn-secondary" data-action="close">
                            ${i18n.t('common.close')}
                        </button>
                    </div>
                </div>
            </div>
        `;

        // 移除旧的模态框（如果存在）
        const oldModal = document.getElementById('json-modal');
        if (oldModal) {
            oldModal.remove();
        }

        // 添加新模态框
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // 获取模态框元素
        const modal = document.getElementById('json-modal');
        
        // 添加点击背景关闭功能
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeJsonModal();
            }
        });

        // 绑定模态框按钮事件（使用事件委托）
        this.bindJsonModalEvents(modal);
    }

    // 绑定JSON模态框按钮事件（使用事件委托）
    bindJsonModalEvents(modal) {
        modal.addEventListener('click', (e) => {
            // 查找最近的按钮元素
            const button = e.target.closest('button[data-action]');
            if (!button) return;

            // 获取操作类型
            const action = button.dataset.action;

            // 根据操作类型调用相应的方法
            switch (action) {
                case 'copy':
                    this.copyJsonContent();
                    break;
                case 'close':
                    this.closeJsonModal();
                    break;
            }
        });
    }

    // 关闭JSON模态框
    closeJsonModal() {
        const modal = document.getElementById('json-modal');
        if (modal) {
            modal.remove();
        }
    }

    // 复制JSON内容
    copyJsonContent() {
        const jsonContent = document.querySelector('.json-content');
        if (jsonContent) {
            const text = jsonContent.textContent;
            navigator.clipboard.writeText(text).then(() => {
                this.showNotification('内容已复制到剪贴板', 'success');
            }).catch(() => {
                this.showNotification('复制失败', 'error');
            });
        }
    }

    // 下载认证文件
    async downloadAuthFile(filename) {
        try {
            const response = await fetch(`${this.apiUrl}/auth-files/download?name=${encodeURIComponent(filename)}`, {
                headers: {
                    'Authorization': `Bearer ${this.managementKey}`
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            window.URL.revokeObjectURL(url);

            this.showNotification(i18n.t('auth_files.download_success'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.download_failed')}: ${error.message}`, 'error');
        }
    }

    // 删除认证文件
    async deleteAuthFile(filename) {
        if (!confirm(`${i18n.t('auth_files.delete_confirm')} "${filename}" 吗？`)) return;

        try {
            await this.makeRequest(`/auth-files?name=${encodeURIComponent(filename)}`, { method: 'DELETE' });
            this.removeAuthFileElements([filename]);
            this.clearCache(); // 清除缓存
            await this.loadAuthFiles();
            this.showNotification(i18n.t('auth_files.delete_success'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.delete_failed')}: ${error.message}`, 'error');
        }
    }

    // Delete auth files (respect current filter)
    async deleteAllAuthFiles() {
        const filterType = (this.currentAuthFileFilter || 'all').toLowerCase();
        const isFiltered = filterType !== 'all';
        const typeLabel = this.generateDynamicTypeLabel(filterType);
        const confirmMessage = isFiltered
            ? i18n.t('auth_files.delete_filtered_confirm').replace('{type}', typeLabel)
            : i18n.t('auth_files.delete_all_confirm');

        if (!confirm(confirmMessage)) return;

        try {
            if (!isFiltered) {
                const response = await this.makeRequest('/auth-files?all=true', { method: 'DELETE' });
                const currentNames = (this.cachedAuthFiles || []).map(file => file.name).filter(Boolean);
                if (currentNames.length > 0) {
                    this.removeAuthFileElements(currentNames);
                }
                this.clearCache(); // 清除缓存
                this.currentAuthFileFilter = 'all';
                await this.loadAuthFiles();
                this.showNotification(`${i18n.t('auth_files.delete_all_success')} ${response.deleted} ${i18n.t('auth_files.files_count')}`, 'success');
                return;
            }

            const deletableFiles = (this.cachedAuthFiles || []).filter(file => {
                if (!file || file.runtime_only) return false;
                const fileType = (file.type || 'unknown').toLowerCase();
                return fileType === filterType;
            });

            if (deletableFiles.length === 0) {
                this.showNotification(i18n.t('auth_files.delete_filtered_none').replace('{type}', typeLabel), 'info');
                return;
            }

            let success = 0;
            let failed = 0;
            const deletedNames = [];

            for (const file of deletableFiles) {
                try {
                    await this.makeRequest(`/auth-files?name=${encodeURIComponent(file.name)}`, { method: 'DELETE' });
                    success++;
                    deletedNames.push(file.name);
                } catch (error) {
                    console.error('删除认证文件失败:', file?.name, error);
                    failed++;
                }
            }

            if (deletedNames.length > 0) {
                this.removeAuthFileElements(deletedNames);
            }

            this.clearCache(); // 清除缓存
            this.currentAuthFileFilter = 'all';
            await this.loadAuthFiles();

            if (failed === 0) {
                const successMsg = i18n.t('auth_files.delete_filtered_success')
                    .replace('{count}', success)
                    .replace('{type}', typeLabel);
                this.showNotification(successMsg, 'success');
            } else {
                const warningMsg = i18n.t('auth_files.delete_filtered_partial')
                    .replace('{success}', success)
                    .replace('{failed}', failed)
                    .replace('{type}', typeLabel);
                this.showNotification(warningMsg, 'warning');
            }
        } catch (error) {
            this.showNotification(`${i18n.t('notification.delete_failed')}: ${error.message}`, 'error');
        }
    }





    // ===== Codex OAuth 相关方法 =====

    // 开始 Codex OAuth 流程
    async startCodexOAuth() {
        try {
            const response = await this.makeRequest('/codex-auth-url?is_webui=1');
            const authUrl = response.url;
            const state = this.extractStateFromUrl(authUrl);

            // 显示授权链接
            const urlInput = document.getElementById('codex-oauth-url');
            const content = document.getElementById('codex-oauth-content');
            const status = document.getElementById('codex-oauth-status');

            if (urlInput) {
                urlInput.value = authUrl;
            }
            if (content) {
                content.style.display = 'block';
            }
            if (status) {
                status.textContent = i18n.t('auth_login.codex_oauth_status_waiting');
                status.style.color = 'var(--warning-text)';
            }

            // 开始轮询认证状态
            this.startCodexOAuthPolling(state);

        } catch (error) {
            this.showNotification(`${i18n.t('auth_login.codex_oauth_start_error')} ${error.message}`, 'error');
        }
    }

    // 从 URL 中提取 state 参数
    extractStateFromUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.searchParams.get('state');
        } catch (error) {
            console.error('Failed to extract state from URL:', error);
            return null;
        }
    }

    // 打开 Codex 授权链接
    openCodexLink() {
        const urlInput = document.getElementById('codex-oauth-url');
        if (urlInput && urlInput.value) {
            window.open(urlInput.value, '_blank');
        }
    }

    // 复制 Codex 授权链接
    async copyCodexLink() {
        const urlInput = document.getElementById('codex-oauth-url');
        if (urlInput && urlInput.value) {
            try {
                await navigator.clipboard.writeText(urlInput.value);
                this.showNotification(i18n.t('notification.link_copied'), 'success');
            } catch (error) {
                // 降级方案：使用传统的复制方法
                urlInput.select();
                document.execCommand('copy');
                this.showNotification(i18n.t('notification.link_copied'), 'success');
            }
        }
    }

    // 开始轮询 OAuth 状态
    startCodexOAuthPolling(state) {
        if (!state) {
            this.showNotification(i18n.t('auth_login.missing_state'), 'error');
            return;
        }

        const pollInterval = setInterval(async () => {
            try {
                const response = await this.makeRequest(`/get-auth-status?state=${encodeURIComponent(state)}`);
                const status = response.status;
                const statusElement = document.getElementById('codex-oauth-status');

                if (status === 'ok') {
                    // 认证成功
                    clearInterval(pollInterval);
                    // 隐藏授权链接相关内容，恢复到初始状态
                    this.resetCodexOAuthUI();
                    // 显示成功通知
                    this.showNotification(i18n.t('auth_login.codex_oauth_status_success'), 'success');
                    // 刷新认证文件列表
                    this.loadAuthFiles();
                } else if (status === 'error') {
                    // 认证失败
                    clearInterval(pollInterval);
                    const errorMessage = response.error || 'Unknown error';
                    // 显示错误信息
                    if (statusElement) {
                        statusElement.textContent = `${i18n.t('auth_login.codex_oauth_status_error')} ${errorMessage}`;
                        statusElement.style.color = 'var(--error-text)';
                    }
                    this.showNotification(`${i18n.t('auth_login.codex_oauth_status_error')} ${errorMessage}`, 'error');
                    // 3秒后重置UI，让用户能够重新开始
                    setTimeout(() => {
                        this.resetCodexOAuthUI();
                    }, 3000);
                } else if (status === 'wait') {
                    // 继续等待
                    if (statusElement) {
                        statusElement.textContent = i18n.t('auth_login.codex_oauth_status_waiting');
                        statusElement.style.color = 'var(--warning-text)';
                    }
                }
            } catch (error) {
                clearInterval(pollInterval);
                const statusElement = document.getElementById('codex-oauth-status');
                if (statusElement) {
                    statusElement.textContent = `${i18n.t('auth_login.codex_oauth_polling_error')} ${error.message}`;
                    statusElement.style.color = 'var(--error-text)';
                }
                this.showNotification(`${i18n.t('auth_login.codex_oauth_polling_error')} ${error.message}`, 'error');
                // 3秒后重置UI，让用户能够重新开始
                setTimeout(() => {
                    this.resetCodexOAuthUI();
                }, 3000);
            }
        }, 2000); // 每2秒轮询一次

        // 设置超时，5分钟后停止轮询
        setTimeout(() => {
            clearInterval(pollInterval);
        }, 5 * 60 * 1000);
    }

    // 重置 Codex OAuth UI 到初始状态
    resetCodexOAuthUI() {
        const urlInput = document.getElementById('codex-oauth-url');
        const content = document.getElementById('codex-oauth-content');
        const status = document.getElementById('codex-oauth-status');

        // 清空并隐藏授权链接输入框
        if (urlInput) {
            urlInput.value = '';
        }

        // 隐藏整个授权链接内容区域
        if (content) {
            content.style.display = 'none';
        }

        // 清空状态显示
        if (status) {
            status.textContent = '';
            status.style.color = '';
            status.className = '';
        }
    }

    // ===== Anthropic OAuth 相关方法 =====

    // 开始 Anthropic OAuth 流程
    async startAnthropicOAuth() {
        try {
            const response = await this.makeRequest('/anthropic-auth-url?is_webui=1');
            const authUrl = response.url;
            const state = this.extractStateFromUrl(authUrl);

            // 显示授权链接
            const urlInput = document.getElementById('anthropic-oauth-url');
            const content = document.getElementById('anthropic-oauth-content');
            const status = document.getElementById('anthropic-oauth-status');

            if (urlInput) {
                urlInput.value = authUrl;
            }
            if (content) {
                content.style.display = 'block';
            }
            if (status) {
                status.textContent = i18n.t('auth_login.anthropic_oauth_status_waiting');
                status.style.color = 'var(--warning-text)';
            }

            // 开始轮询认证状态
            this.startAnthropicOAuthPolling(state);

        } catch (error) {
            this.showNotification(`${i18n.t('auth_login.anthropic_oauth_start_error')} ${error.message}`, 'error');
        }
    }

    // 打开 Anthropic 授权链接
    openAnthropicLink() {
        const urlInput = document.getElementById('anthropic-oauth-url');
        if (urlInput && urlInput.value) {
            window.open(urlInput.value, '_blank');
        }
    }

    // 复制 Anthropic 授权链接
    async copyAnthropicLink() {
        const urlInput = document.getElementById('anthropic-oauth-url');
        if (urlInput && urlInput.value) {
            try {
                await navigator.clipboard.writeText(urlInput.value);
                this.showNotification(i18n.t('notification.link_copied'), 'success');
            } catch (error) {
                // 降级方案：使用传统的复制方法
                urlInput.select();
                document.execCommand('copy');
                this.showNotification(i18n.t('notification.link_copied'), 'success');
            }
        }
    }

    // 开始轮询 Anthropic OAuth 状态
    startAnthropicOAuthPolling(state) {
        if (!state) {
            this.showNotification(i18n.t('auth_login.missing_state'), 'error');
            return;
        }

        const pollInterval = setInterval(async () => {
            try {
                const response = await this.makeRequest(`/get-auth-status?state=${encodeURIComponent(state)}`);
                const status = response.status;
                const statusElement = document.getElementById('anthropic-oauth-status');

                if (status === 'ok') {
                    // 认证成功
                    clearInterval(pollInterval);
                    // 隐藏授权链接相关内容，恢复到初始状态
                    this.resetAnthropicOAuthUI();
                    // 显示成功通知
                    this.showNotification(i18n.t('auth_login.anthropic_oauth_status_success'), 'success');
                    // 刷新认证文件列表
                    this.loadAuthFiles();
                } else if (status === 'error') {
                    // 认证失败
                    clearInterval(pollInterval);
                    const errorMessage = response.error || 'Unknown error';
                    // 显示错误信息
                    if (statusElement) {
                        statusElement.textContent = `${i18n.t('auth_login.anthropic_oauth_status_error')} ${errorMessage}`;
                        statusElement.style.color = 'var(--error-text)';
                    }
                    this.showNotification(`${i18n.t('auth_login.anthropic_oauth_status_error')} ${errorMessage}`, 'error');
                    // 3秒后重置UI，让用户能够重新开始
                    setTimeout(() => {
                        this.resetAnthropicOAuthUI();
                    }, 3000);
                } else if (status === 'wait') {
                    // 继续等待
                    if (statusElement) {
                        statusElement.textContent = i18n.t('auth_login.anthropic_oauth_status_waiting');
                        statusElement.style.color = 'var(--warning-text)';
                    }
                }
            } catch (error) {
                clearInterval(pollInterval);
                const statusElement = document.getElementById('anthropic-oauth-status');
                if (statusElement) {
                    statusElement.textContent = `${i18n.t('auth_login.anthropic_oauth_polling_error')} ${error.message}`;
                    statusElement.style.color = 'var(--error-text)';
                }
                this.showNotification(`${i18n.t('auth_login.anthropic_oauth_polling_error')} ${error.message}`, 'error');
                // 3秒后重置UI，让用户能够重新开始
                setTimeout(() => {
                    this.resetAnthropicOAuthUI();
                }, 3000);
            }
        }, 2000); // 每2秒轮询一次

        // 设置超时，5分钟后停止轮询
        setTimeout(() => {
            clearInterval(pollInterval);
        }, 5 * 60 * 1000);
    }

    // 重置 Anthropic OAuth UI 到初始状态
    resetAnthropicOAuthUI() {
        const urlInput = document.getElementById('anthropic-oauth-url');
        const content = document.getElementById('anthropic-oauth-content');
        const status = document.getElementById('anthropic-oauth-status');

        // 清空并隐藏授权链接输入框
        if (urlInput) {
            urlInput.value = '';
        }

        // 隐藏整个授权链接内容区域
        if (content) {
            content.style.display = 'none';
        }

        // 清空状态显示
        if (status) {
            status.textContent = '';
            status.style.color = '';
            status.className = '';
        }
    }

    // ===== Gemini CLI OAuth 相关方法 =====

    // 开始 Gemini CLI OAuth 流程
    async startGeminiCliOAuth() {
        try {
            // 获取项目 ID（可选）
            const projectId = document.getElementById('gemini-cli-project-id').value.trim();

            // 构建请求 URL
            let requestUrl = '/gemini-cli-auth-url?is_webui=1';
            if (projectId) {
                requestUrl += `&project_id=${encodeURIComponent(projectId)}`;
            }

            const response = await this.makeRequest(requestUrl);
            const authUrl = response.url;
            const state = this.extractStateFromUrl(authUrl);

            // 显示授权链接
            const urlInput = document.getElementById('gemini-cli-oauth-url');
            const content = document.getElementById('gemini-cli-oauth-content');
            const status = document.getElementById('gemini-cli-oauth-status');

            if (urlInput) {
                urlInput.value = authUrl;
            }
            if (content) {
                content.style.display = 'block';
            }
            if (status) {
                status.textContent = i18n.t('auth_login.gemini_cli_oauth_status_waiting');
                status.style.color = 'var(--warning-text)';
            }

            // 开始轮询认证状态
            this.startGeminiCliOAuthPolling(state);

        } catch (error) {
            this.showNotification(`${i18n.t('auth_login.gemini_cli_oauth_start_error')} ${error.message}`, 'error');
        }
    }

    // 打开 Gemini CLI 授权链接
    openGeminiCliLink() {
        const urlInput = document.getElementById('gemini-cli-oauth-url');
        if (urlInput && urlInput.value) {
            window.open(urlInput.value, '_blank');
        }
    }

    // 复制 Gemini CLI 授权链接
    async copyGeminiCliLink() {
        const urlInput = document.getElementById('gemini-cli-oauth-url');
        if (urlInput && urlInput.value) {
            try {
                await navigator.clipboard.writeText(urlInput.value);
                this.showNotification(i18n.t('notification.link_copied'), 'success');
            } catch (error) {
                // 降级方案：使用传统的复制方法
                urlInput.select();
                document.execCommand('copy');
                this.showNotification(i18n.t('notification.link_copied'), 'success');
            }
        }
    }

    // 开始轮询 Gemini CLI OAuth 状态
    startGeminiCliOAuthPolling(state) {
        if (!state) {
            this.showNotification(i18n.t('auth_login.missing_state'), 'error');
            return;
        }

        const pollInterval = setInterval(async () => {
            try {
                const response = await this.makeRequest(`/get-auth-status?state=${encodeURIComponent(state)}`);
                const status = response.status;
                const statusElement = document.getElementById('gemini-cli-oauth-status');

                if (status === 'ok') {
                    // 认证成功
                    clearInterval(pollInterval);
                    // 隐藏授权链接相关内容，恢复到初始状态
                    this.resetGeminiCliOAuthUI();
                    // 显示成功通知
                    this.showNotification(i18n.t('auth_login.gemini_cli_oauth_status_success'), 'success');
                    // 刷新认证文件列表
                    this.loadAuthFiles();
                } else if (status === 'error') {
                    // 认证失败
                    clearInterval(pollInterval);
                    const errorMessage = response.error || 'Unknown error';
                    // 显示错误信息
                    if (statusElement) {
                        statusElement.textContent = `${i18n.t('auth_login.gemini_cli_oauth_status_error')} ${errorMessage}`;
                        statusElement.style.color = 'var(--error-text)';
                    }
                    this.showNotification(`${i18n.t('auth_login.gemini_cli_oauth_status_error')} ${errorMessage}`, 'error');
                    // 3秒后重置UI，让用户能够重新开始
                    setTimeout(() => {
                        this.resetGeminiCliOAuthUI();
                    }, 3000);
                } else if (status === 'wait') {
                    // 继续等待
                    if (statusElement) {
                        statusElement.textContent = i18n.t('auth_login.gemini_cli_oauth_status_waiting');
                        statusElement.style.color = 'var(--warning-text)';
                    }
                }
            } catch (error) {
                clearInterval(pollInterval);
                const statusElement = document.getElementById('gemini-cli-oauth-status');
                if (statusElement) {
                    statusElement.textContent = `${i18n.t('auth_login.gemini_cli_oauth_polling_error')} ${error.message}`;
                    statusElement.style.color = 'var(--error-text)';
                }
                this.showNotification(`${i18n.t('auth_login.gemini_cli_oauth_polling_error')} ${error.message}`, 'error');
                // 3秒后重置UI，让用户能够重新开始
                setTimeout(() => {
                    this.resetGeminiCliOAuthUI();
                }, 3000);
            }
        }, 2000); // 每2秒轮询一次

        // 设置超时，5分钟后停止轮询
        setTimeout(() => {
            clearInterval(pollInterval);
        }, 5 * 60 * 1000);
    }

    // 重置 Gemini CLI OAuth UI 到初始状态
    resetGeminiCliOAuthUI() {
        const urlInput = document.getElementById('gemini-cli-oauth-url');
        const content = document.getElementById('gemini-cli-oauth-content');
        const status = document.getElementById('gemini-cli-oauth-status');

        // 清空并隐藏授权链接输入框
        if (urlInput) {
            urlInput.value = '';
        }

        // 隐藏整个授权链接内容区域
        if (content) {
            content.style.display = 'none';
        }

        // 清空状态显示
        if (status) {
            status.textContent = '';
            status.style.color = '';
            status.className = '';
        }
    }

    // ===== Qwen OAuth 相关方法 =====

    // 开始 Qwen OAuth 流程
    async startQwenOAuth() {
        try {
            const response = await this.makeRequest('/qwen-auth-url?is_webui=1');
            const authUrl = response.url;
            const state = this.extractStateFromUrl(authUrl);

            // 显示授权链接
            const urlInput = document.getElementById('qwen-oauth-url');
            const content = document.getElementById('qwen-oauth-content');
            const status = document.getElementById('qwen-oauth-status');

            if (urlInput) {
                urlInput.value = authUrl;
            }
            if (content) {
                content.style.display = 'block';
            }
            if (status) {
                status.textContent = i18n.t('auth_login.qwen_oauth_status_waiting');
                status.style.color = 'var(--warning-text)';
            }

            // 开始轮询认证状态
            this.startQwenOAuthPolling(response.state);

        } catch (error) {
            this.showNotification(`${i18n.t('auth_login.qwen_oauth_start_error')} ${error.message}`, 'error');
        }
    }

    // 打开 Qwen 授权链接
    openQwenLink() {
        const urlInput = document.getElementById('qwen-oauth-url');
        if (urlInput && urlInput.value) {
            window.open(urlInput.value, '_blank');
        }
    }

    // 复制 Qwen 授权链接
    async copyQwenLink() {
        const urlInput = document.getElementById('qwen-oauth-url');
        if (urlInput && urlInput.value) {
            try {
                await navigator.clipboard.writeText(urlInput.value);
                this.showNotification(i18n.t('notification.link_copied'), 'success');
            } catch (error) {
                // 降级方案：使用传统的复制方法
                urlInput.select();
                document.execCommand('copy');
                this.showNotification(i18n.t('notification.link_copied'), 'success');
            }
        }
    }

    // 开始轮询 Qwen OAuth 状态
    startQwenOAuthPolling(state) {
        if (!state) {
            this.showNotification(i18n.t('auth_login.missing_state'), 'error');
            return;
        }

        const pollInterval = setInterval(async () => {
            try {
                const response = await this.makeRequest(`/get-auth-status?state=${encodeURIComponent(state)}`);
                const status = response.status;
                const statusElement = document.getElementById('qwen-oauth-status');

                if (status === 'ok') {
                    // 认证成功
                    clearInterval(pollInterval);
                    // 隐藏授权链接相关内容，恢复到初始状态
                    this.resetQwenOAuthUI();
                    // 显示成功通知
                    this.showNotification(i18n.t('auth_login.qwen_oauth_status_success'), 'success');
                    // 刷新认证文件列表
                    this.loadAuthFiles();
                } else if (status === 'error') {
                    // 认证失败
                    clearInterval(pollInterval);
                    const errorMessage = response.error || 'Unknown error';
                    // 显示错误信息
                    if (statusElement) {
                        statusElement.textContent = `${i18n.t('auth_login.qwen_oauth_status_error')} ${errorMessage}`;
                        statusElement.style.color = 'var(--error-text)';
                    }
                    this.showNotification(`${i18n.t('auth_login.qwen_oauth_status_error')} ${errorMessage}`, 'error');
                    // 3秒后重置UI，让用户能够重新开始
                    setTimeout(() => {
                        this.resetQwenOAuthUI();
                    }, 3000);
                } else if (status === 'wait') {
                    // 继续等待
                    if (statusElement) {
                        statusElement.textContent = i18n.t('auth_login.qwen_oauth_status_waiting');
                        statusElement.style.color = 'var(--warning-text)';
                    }
                }
            } catch (error) {
                clearInterval(pollInterval);
                const statusElement = document.getElementById('qwen-oauth-status');
                if (statusElement) {
                    statusElement.textContent = `${i18n.t('auth_login.qwen_oauth_polling_error')} ${error.message}`;
                    statusElement.style.color = 'var(--error-text)';
                }
                this.showNotification(`${i18n.t('auth_login.qwen_oauth_polling_error')} ${error.message}`, 'error');
                // 3秒后重置UI，让用户能够重新开始
                setTimeout(() => {
                    this.resetQwenOAuthUI();
                }, 3000);
            }
        }, 2000); // 每2秒轮询一次

        // 设置超时，5分钟后停止轮询
        setTimeout(() => {
            clearInterval(pollInterval);
        }, 5 * 60 * 1000);
    }

    // 重置 Qwen OAuth UI 到初始状态
    resetQwenOAuthUI() {
        const urlInput = document.getElementById('qwen-oauth-url');
        const content = document.getElementById('qwen-oauth-content');
        const status = document.getElementById('qwen-oauth-status');

        // 清空并隐藏授权链接输入框
        if (urlInput) {
            urlInput.value = '';
        }

        // 隐藏整个授权链接内容区域
        if (content) {
            content.style.display = 'none';
        }

        // 清空状态显示
        if (status) {
            status.textContent = '';
            status.style.color = '';
            status.className = '';
        }
    }

    // ===== iFlow OAuth 相关方法 =====

    // 开始 iFlow OAuth 流程
    async startIflowOAuth() {
        try {
            const response = await this.makeRequest('/iflow-auth-url?is_webui=1');
            const authUrl = response.url;
            const state = this.extractStateFromUrl(authUrl);

            // 显示授权链接
            const urlInput = document.getElementById('iflow-oauth-url');
            const content = document.getElementById('iflow-oauth-content');
            const status = document.getElementById('iflow-oauth-status');

            if (urlInput) {
                urlInput.value = authUrl;
            }
            if (content) {
                content.style.display = 'block';
            }
            if (status) {
                status.textContent = i18n.t('auth_login.iflow_oauth_status_waiting');
                status.style.color = 'var(--warning-text)';
            }

            // 开始轮询认证状态
            this.startIflowOAuthPolling(state);

        } catch (error) {
            this.showNotification(`${i18n.t('auth_login.iflow_oauth_start_error')} ${error.message}`, 'error');
        }
    }

    // 打开 iFlow 授权链接
    openIflowLink() {
        const urlInput = document.getElementById('iflow-oauth-url');
        if (urlInput && urlInput.value) {
            window.open(urlInput.value, '_blank');
        }
    }

    // 复制 iFlow 授权链接
    async copyIflowLink() {
        const urlInput = document.getElementById('iflow-oauth-url');
        if (urlInput && urlInput.value) {
            try {
                await navigator.clipboard.writeText(urlInput.value);
                this.showNotification(i18n.t('notification.link_copied'), 'success');
            } catch (error) {
                // 降级方案：使用传统的复制方法
                urlInput.select();
                document.execCommand('copy');
                this.showNotification(i18n.t('notification.link_copied'), 'success');
            }
        }
    }

    // 开始轮询 iFlow OAuth 状态
    startIflowOAuthPolling(state) {
        if (!state) {
            this.showNotification(i18n.t('auth_login.missing_state'), 'error');
            return;
        }

        const pollInterval = setInterval(async () => {
            try {
                const response = await this.makeRequest(`/get-auth-status?state=${encodeURIComponent(state)}`);
                const status = response.status;
                const statusElement = document.getElementById('iflow-oauth-status');

                if (status === 'ok') {
                    // 认证成功
                    clearInterval(pollInterval);
                    // 隐藏授权链接相关内容，恢复到初始状态
                    this.resetIflowOAuthUI();
                    // 显示成功通知
                    this.showNotification(i18n.t('auth_login.iflow_oauth_status_success'), 'success');
                    // 刷新认证文件列表
                    this.loadAuthFiles();
                } else if (status === 'error') {
                    // 认证失败
                    clearInterval(pollInterval);
                    const errorMessage = response.error || 'Unknown error';
                    // 显示错误信息
                    if (statusElement) {
                        statusElement.textContent = `${i18n.t('auth_login.iflow_oauth_status_error')} ${errorMessage}`;
                        statusElement.style.color = 'var(--error-text)';
                    }
                    this.showNotification(`${i18n.t('auth_login.iflow_oauth_status_error')} ${errorMessage}`, 'error');
                    // 3秒后重置UI，让用户能够重新开始
                    setTimeout(() => {
                        this.resetIflowOAuthUI();
                    }, 3000);
                } else if (status === 'wait') {
                    // 继续等待
                    if (statusElement) {
                        statusElement.textContent = i18n.t('auth_login.iflow_oauth_status_waiting');
                        statusElement.style.color = 'var(--warning-text)';
                    }
                }
            } catch (error) {
                clearInterval(pollInterval);
                const statusElement = document.getElementById('iflow-oauth-status');
                if (statusElement) {
                    statusElement.textContent = `${i18n.t('auth_login.iflow_oauth_polling_error')} ${error.message}`;
                    statusElement.style.color = 'var(--error-text)';
                }
                this.showNotification(`${i18n.t('auth_login.iflow_oauth_polling_error')} ${error.message}`, 'error');
                // 3秒后重置UI，让用户能够重新开始
                setTimeout(() => {
                    this.resetIflowOAuthUI();
                }, 3000);
            }
        }, 2000); // 每2秒轮询一次

        // 设置超时，5分钟后停止轮询
        setTimeout(() => {
            clearInterval(pollInterval);
        }, 5 * 60 * 1000);
    }

    // 重置 iFlow OAuth UI 到初始状态
    resetIflowOAuthUI() {
        const urlInput = document.getElementById('iflow-oauth-url');
        const content = document.getElementById('iflow-oauth-content');
        const status = document.getElementById('iflow-oauth-status');

        // 清空并隐藏授权链接输入框
        if (urlInput) {
            urlInput.value = '';
        }

        // 隐藏整个授权链接内容区域
        if (content) {
            content.style.display = 'none';
        }

        // 清空状态显示
        if (status) {
            status.textContent = '';
            status.style.color = '';
            status.className = '';
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

    // 获取API密钥的统计信息
    async getKeyStats() {
        try {
            const response = await this.makeRequest('/usage');
            const usage = response?.usage || null;
            
            if (!usage) {
                return {};
            }

            const sourceStats = {};
            const apis = usage.apis || {};

            Object.values(apis).forEach(apiEntry => {
                const models = apiEntry.models || {};

                Object.values(models).forEach(modelEntry => {
                    const details = modelEntry.details || [];

                    details.forEach(detail => {
                        const source = detail.source;
                        if (!source) return;
                        
                        if (!sourceStats[source]) {
                            sourceStats[source] = {
                                success: 0,
                                failure: 0
                            };
                        }

                        const isFailed = detail.failed === true;
                        if (isFailed) {
                            sourceStats[source].failure += 1;
                        } else {
                            sourceStats[source].success += 1;
                        }
                    });
                });
            });

            return sourceStats;
        } catch (error) {
            console.error('获取统计信息失败:', error);
            return {};
        }
    }

    // 加载使用统计
    async loadUsageStats(usageData = null) {
        try {
            let usage = usageData;
            // 如果没有传入usage数据，则调用API获取
            if (!usage) {
                const response = await this.makeRequest('/usage');
                usage = response?.usage || null;
            }
            this.currentUsageData = usage;

            if (!usage) {
                throw new Error('usage payload missing');
            }

            // 更新概览卡片
            this.updateUsageOverview(usage);
            this.updateChartLineSelectors(usage);

            // 读取当前图表周期
            const requestsHourActive = document.getElementById('requests-hour-btn')?.classList.contains('active');
            const tokensHourActive = document.getElementById('tokens-hour-btn')?.classList.contains('active');
            const requestsPeriod = requestsHourActive ? 'hour' : 'day';
            const tokensPeriod = tokensHourActive ? 'hour' : 'day';

            // 初始化图表（使用当前周期）
            this.initializeRequestsChart(requestsPeriod);
            this.initializeTokensChart(tokensPeriod);

            // 更新API详细统计表格
            this.updateApiStatsTable(usage);

        } catch (error) {
            console.error('加载使用统计失败:', error);
            this.currentUsageData = null;
            this.updateChartLineSelectors(null);

            // 清空概览数据
            ['total-requests', 'success-requests', 'failed-requests', 'total-tokens'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = '-';
            });

            // 清空图表
            if (this.requestsChart) {
                this.requestsChart.destroy();
                this.requestsChart = null;
            }
            if (this.tokensChart) {
                this.tokensChart.destroy();
                this.tokensChart = null;
            }

            const tableElement = document.getElementById('api-stats-table');
            if (tableElement) {
                tableElement.innerHTML = `<div class="no-data-message">${i18n.t('usage_stats.loading_error')}: ${error.message}</div>`;
            }
        }
    }

    // 更新使用统计概览
    updateUsageOverview(data) {
        const safeData = data || {};
        document.getElementById('total-requests').textContent = safeData.total_requests ?? 0;
        document.getElementById('success-requests').textContent = safeData.success_count ?? 0;
        document.getElementById('failed-requests').textContent = safeData.failure_count ?? 0;
        document.getElementById('total-tokens').textContent = safeData.total_tokens ?? 0;
    }

    getModelNamesFromUsage(usage) {
        if (!usage) {
            return [];
        }
        const apis = usage.apis || {};
        const names = new Set();
        Object.values(apis).forEach(apiEntry => {
            const models = apiEntry.models || {};
            Object.keys(models).forEach(modelName => {
                if (modelName) {
                    names.add(modelName);
                }
            });
        });
        return Array.from(names).sort((a, b) => a.localeCompare(b));
    }

    updateChartLineSelectors(usage) {
        const modelNames = this.getModelNamesFromUsage(usage);
        const selectors = this.chartLineSelectIds
            .map(id => document.getElementById(id))
            .filter(Boolean);

        if (!selectors.length) {
            this.chartLineSelections = ['none', 'none', 'none'];
            return;
        }

        const optionsFragment = () => {
            const fragment = document.createDocumentFragment();
            const hiddenOption = document.createElement('option');
            hiddenOption.value = 'none';
            hiddenOption.textContent = i18n.t('usage_stats.chart_line_hidden');
            fragment.appendChild(hiddenOption);
            modelNames.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                fragment.appendChild(option);
            });
            return fragment;
        };

        const hasModels = modelNames.length > 0;
        selectors.forEach(select => {
            select.innerHTML = '';
            select.appendChild(optionsFragment());
            select.disabled = !hasModels;
        });

        if (!hasModels) {
            this.chartLineSelections = ['none', 'none', 'none'];
            selectors.forEach(select => {
                select.value = 'none';
            });
            return;
        }

        const nextSelections = Array.isArray(this.chartLineSelections)
            ? [...this.chartLineSelections]
            : ['none', 'none', 'none'];

        const validNames = new Set(modelNames);
        let hasActiveSelection = false;
        for (let i = 0; i < nextSelections.length; i++) {
            const selection = nextSelections[i];
            if (selection && selection !== 'none' && !validNames.has(selection)) {
                nextSelections[i] = 'none';
            }
            if (nextSelections[i] !== 'none') {
                hasActiveSelection = true;
            }
        }

        if (!hasActiveSelection) {
            modelNames.slice(0, nextSelections.length).forEach((name, index) => {
                nextSelections[index] = name;
            });
        }

        this.chartLineSelections = nextSelections;
        selectors.forEach((select, index) => {
            const value = this.chartLineSelections[index] || 'none';
            select.value = value;
        });
    }

    handleChartLineSelectionChange(index, value) {
        if (!Array.isArray(this.chartLineSelections)) {
            this.chartLineSelections = ['none', 'none', 'none'];
        }
        if (index < 0 || index >= this.chartLineSelections.length) {
            return;
        }
        const normalized = value || 'none';
        if (this.chartLineSelections[index] === normalized) {
            return;
        }
        this.chartLineSelections[index] = normalized;
        this.refreshChartsForSelections();
    }

    refreshChartsForSelections() {
        if (!this.currentUsageData) {
            return;
        }
        const requestsHourActive = document.getElementById('requests-hour-btn')?.classList.contains('active');
        const tokensHourActive = document.getElementById('tokens-hour-btn')?.classList.contains('active');
        const requestsPeriod = requestsHourActive ? 'hour' : 'day';
        const tokensPeriod = tokensHourActive ? 'hour' : 'day';

        if (this.requestsChart) {
            this.requestsChart.data = this.getRequestsChartData(requestsPeriod);
            this.requestsChart.update();
        } else {
            this.initializeRequestsChart(requestsPeriod);
        }

        if (this.tokensChart) {
            this.tokensChart.data = this.getTokensChartData(tokensPeriod);
            this.tokensChart.update();
        } else {
            this.initializeTokensChart(tokensPeriod);
        }
    }

    getActiveChartLineSelections() {
        if (!Array.isArray(this.chartLineSelections)) {
            this.chartLineSelections = ['none', 'none', 'none'];
        }
        return this.chartLineSelections
            .map((value, index) => ({ model: value, index }))
            .filter(item => item.model && item.model !== 'none');
    }

    // 收集所有请求明细，供图表等复用
    collectUsageDetailsFromUsage(usage) {
        if (!usage) {
            return [];
        }
        const apis = usage.apis || {};
        const details = [];
        Object.values(apis).forEach(apiEntry => {
            const models = apiEntry.models || {};
            Object.entries(models).forEach(([modelName, modelEntry]) => {
                const modelDetails = Array.isArray(modelEntry.details) ? modelEntry.details : [];
                modelDetails.forEach(detail => {
                    if (detail && detail.timestamp) {
                        details.push({
                            ...detail,
                            __modelName: modelName
                        });
                    }
                });
            });
        });
        return details;
    }

    collectUsageDetails() {
        return this.collectUsageDetailsFromUsage(this.currentUsageData);
    }

    createHourlyBucketMeta() {
        const hourMs = 60 * 60 * 1000;
        const now = new Date();
        const currentHour = new Date(now);
        currentHour.setMinutes(0, 0, 0);

        const earliestBucket = new Date(currentHour);
        earliestBucket.setHours(earliestBucket.getHours() - 23);
        const earliestTime = earliestBucket.getTime();
        const labels = [];
        for (let i = 0; i < 24; i++) {
            const bucketStart = earliestTime + i * hourMs;
            labels.push(this.formatHourLabel(new Date(bucketStart)));
        }

        return {
            labels,
            earliestTime,
            bucketSize: hourMs,
            lastBucketTime: earliestTime + (labels.length - 1) * hourMs
        };
    }

    buildHourlySeriesByModel(metric = 'requests') {
        const meta = this.createHourlyBucketMeta();
        const details = this.collectUsageDetails();
        const dataByModel = new Map();
        let hasData = false;

        if (!details.length) {
            return { labels: meta.labels, dataByModel, hasData };
        }

        details.forEach(detail => {
            const timestamp = Date.parse(detail.timestamp);
            if (Number.isNaN(timestamp)) {
                return;
            }

            const normalized = new Date(timestamp);
            normalized.setMinutes(0, 0, 0);
            const bucketStart = normalized.getTime();
            if (bucketStart < meta.earliestTime || bucketStart > meta.lastBucketTime) {
                return;
            }

            const bucketIndex = Math.floor((bucketStart - meta.earliestTime) / meta.bucketSize);
            if (bucketIndex < 0 || bucketIndex >= meta.labels.length) {
                return;
            }

            const modelName = detail.__modelName || 'Unknown';
            if (!dataByModel.has(modelName)) {
                dataByModel.set(modelName, new Array(meta.labels.length).fill(0));
            }

            const bucketValues = dataByModel.get(modelName);
            if (metric === 'tokens') {
                bucketValues[bucketIndex] += this.extractTotalTokens(detail);
            } else {
                bucketValues[bucketIndex] += 1;
            }
            hasData = true;
        });

        return { labels: meta.labels, dataByModel, hasData };
    }

    buildDailySeriesByModel(metric = 'requests') {
        const details = this.collectUsageDetails();
        const valuesByModel = new Map();
        const labelsSet = new Set();
        let hasData = false;

        if (!details.length) {
            return { labels: [], dataByModel: new Map(), hasData };
        }

        details.forEach(detail => {
            const timestamp = Date.parse(detail.timestamp);
            if (Number.isNaN(timestamp)) {
                return;
            }
            const dayLabel = this.formatDayLabel(new Date(timestamp));
            if (!dayLabel) {
                return;
            }

            const modelName = detail.__modelName || 'Unknown';
            if (!valuesByModel.has(modelName)) {
                valuesByModel.set(modelName, new Map());
            }
            const modelDayMap = valuesByModel.get(modelName);
            const increment = metric === 'tokens' ? this.extractTotalTokens(detail) : 1;
            modelDayMap.set(dayLabel, (modelDayMap.get(dayLabel) || 0) + increment);
            labelsSet.add(dayLabel);
            hasData = true;
        });

        const labels = Array.from(labelsSet).sort();
        const dataByModel = new Map();
        valuesByModel.forEach((dayMap, modelName) => {
            const series = labels.map(label => dayMap.get(label) || 0);
            dataByModel.set(modelName, series);
        });

        return { labels, dataByModel, hasData };
    }

    buildChartDataForMetric(period = 'day', metric = 'requests') {
        const baseSeries = period === 'hour'
            ? this.buildHourlySeriesByModel(metric)
            : this.buildDailySeriesByModel(metric);

        const labels = baseSeries?.labels || [];
        const dataByModel = baseSeries?.dataByModel || new Map();
        const activeSelections = this.getActiveChartLineSelections();
        const datasets = activeSelections.map(selection => {
            const values = dataByModel.get(selection.model) || new Array(labels.length).fill(0);
            const style = this.chartLineStyles[selection.index] || this.chartLineStyles[0];
            return {
                label: selection.model,
                data: values,
                borderColor: style.borderColor,
                backgroundColor: style.backgroundColor,
                fill: false,
                tension: 0.35,
                pointBackgroundColor: style.borderColor,
                pointBorderColor: '#ffffff',
                pointBorderWidth: 2,
                pointRadius: values.some(v => v > 0) ? 4 : 3
            };
        });

        return { labels, datasets };
    }

    // 统一格式化小时标签
    formatHourLabel(date) {
        if (!(date instanceof Date)) {
            return '';
        }
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        const hour = date.getHours().toString().padStart(2, '0');
        return `${month}-${day} ${hour}:00`;
    }

    formatDayLabel(date) {
        if (!(date instanceof Date)) {
            return '';
        }
        const year = date.getFullYear();
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const day = date.getDate().toString().padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    extractTotalTokens(detail) {
        const tokens = detail?.tokens || {};
        if (typeof tokens.total_tokens === 'number') {
            return tokens.total_tokens;
        }
        const tokenKeys = ['input_tokens', 'output_tokens', 'reasoning_tokens', 'cached_tokens'];
        return tokenKeys.reduce((sum, key) => {
            const value = tokens[key];
            return sum + (typeof value === 'number' ? value : 0);
        }, 0);
    }

    // 初始化图表
    initializeCharts() {
        const requestsHourActive = document.getElementById('requests-hour-btn')?.classList.contains('active');
        const tokensHourActive = document.getElementById('tokens-hour-btn')?.classList.contains('active');
        this.initializeRequestsChart(requestsHourActive ? 'hour' : 'day');
        this.initializeTokensChart(tokensHourActive ? 'hour' : 'day');
    }

    // 初始化请求趋势图表
    initializeRequestsChart(period = 'day') {
        const ctx = document.getElementById('requests-chart');
        if (!ctx) return;

        // 销毁现有图表
        if (this.requestsChart) {
            this.requestsChart.destroy();
        }

        const data = this.getRequestsChartData(period);

        this.requestsChart = new Chart(ctx, {
            type: 'line',
            data: data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        align: 'start',
                        labels: {
                            usePointStyle: true
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: i18n.t(period === 'hour' ? 'usage_stats.by_hour' : 'usage_stats.by_day')
                        }
                    },
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: i18n.t('usage_stats.requests_count')
                        }
                    }
                },
                elements: {
                    line: {
                        tension: 0.35,
                        borderWidth: 2
                    },
                    point: {
                        borderWidth: 2,
                        radius: 4
                    }
                }
            }
        });
    }

    // 初始化Token使用趋势图表
    initializeTokensChart(period = 'day') {
        const ctx = document.getElementById('tokens-chart');
        if (!ctx) return;

        // 销毁现有图表
        if (this.tokensChart) {
            this.tokensChart.destroy();
        }

        const data = this.getTokensChartData(period);

        this.tokensChart = new Chart(ctx, {
            type: 'line',
            data: data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        align: 'start',
                        labels: {
                            usePointStyle: true
                        }
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: i18n.t(period === 'hour' ? 'usage_stats.by_hour' : 'usage_stats.by_day')
                        }
                    },
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: i18n.t('usage_stats.tokens_count')
                        }
                    }
                },
                elements: {
                    line: {
                        tension: 0.35,
                        borderWidth: 2
                    },
                    point: {
                        borderWidth: 2,
                        radius: 4
                    }
                }
            }
        });
    }

    // 获取请求图表数据
    getRequestsChartData(period) {
        if (!this.currentUsageData) {
            return { labels: [], datasets: [] };
        }
        return this.buildChartDataForMetric(period, 'requests');
    }

    // 获取Token图表数据
    getTokensChartData(period) {
        if (!this.currentUsageData) {
            return { labels: [], datasets: [] };
        }
        return this.buildChartDataForMetric(period, 'tokens');
    }

    // 切换请求图表时间周期
    switchRequestsPeriod(period) {
        // 更新按钮状态
        document.getElementById('requests-hour-btn').classList.toggle('active', period === 'hour');
        document.getElementById('requests-day-btn').classList.toggle('active', period === 'day');

        // 更新图表数据
        if (this.requestsChart) {
            const newData = this.getRequestsChartData(period);
            this.requestsChart.data = newData;
            this.requestsChart.options.scales.x.title.text = i18n.t(period === 'hour' ? 'usage_stats.by_hour' : 'usage_stats.by_day');
            this.requestsChart.update();
        }
    }

    // 切换Token图表时间周期
    switchTokensPeriod(period) {
        // 更新按钮状态
        document.getElementById('tokens-hour-btn').classList.toggle('active', period === 'hour');
        document.getElementById('tokens-day-btn').classList.toggle('active', period === 'day');

        // 更新图表数据
        if (this.tokensChart) {
            const newData = this.getTokensChartData(period);
            this.tokensChart.data = newData;
            this.tokensChart.options.scales.x.title.text = i18n.t(period === 'hour' ? 'usage_stats.by_hour' : 'usage_stats.by_day');
            this.tokensChart.update();
        }
    }

    // 更新API详细统计表格
    updateApiStatsTable(data) {
        const container = document.getElementById('api-stats-table');
        if (!container) return;

        const apis = data.apis || {};

        if (Object.keys(apis).length === 0) {
            container.innerHTML = `<div class="no-data-message">${i18n.t('usage_stats.no_data')}</div>`;
            return;
        }

        let tableHtml = `
            <table class="stats-table">
                <thead>
                    <tr>
                        <th>${i18n.t('usage_stats.api_endpoint')}</th>
                        <th>${i18n.t('usage_stats.requests_count')}</th>
                        <th>${i18n.t('usage_stats.tokens_count')}</th>
                        <th>${i18n.t('usage_stats.success_rate')}</th>
                        <th>${i18n.t('usage_stats.models')}</th>
                    </tr>
                </thead>
                <tbody>
        `;

        Object.entries(apis).forEach(([endpoint, apiData]) => {
            const totalRequests = apiData.total_requests || 0;
            const successCount = apiData.success_count ?? null;
            const successRate = successCount !== null && totalRequests > 0
                ? Math.round((successCount / totalRequests) * 100)
                : null;

            // 构建模型详情
            let modelsHtml = '';
            if (apiData.models && Object.keys(apiData.models).length > 0) {
                modelsHtml = '<div class="model-details">';
                Object.entries(apiData.models).forEach(([modelName, modelData]) => {
                    const modelRequests = modelData.total_requests ?? 0;
                    const modelTokens = modelData.total_tokens ?? 0;
                    modelsHtml += `
                        <div class="model-item">
                            <span class="model-name">${modelName}</span>
                            <span>${modelRequests} 请求 / ${modelTokens} tokens</span>
                        </div>
                    `;
                });
                modelsHtml += '</div>';
            }

            tableHtml += `
                <tr>
                    <td>${endpoint}</td>
                    <td>${totalRequests}</td>
                    <td>${apiData.total_tokens || 0}</td>
                    <td>${successRate !== null ? successRate + '%' : '-'}</td>
                    <td>${modelsHtml || '-'}</td>
                </tr>
            `;
        });

        tableHtml += '</tbody></table>';
        container.innerHTML = tableHtml;
    }

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

    detectApiBaseFromLocation() {
        try {
            const { protocol, hostname, port } = window.location;
            const normalizedPort = port ? `:${port}` : '';
            return this.normalizeBase(`${protocol}//${hostname}${normalizedPort}`);
        } catch (error) {
            console.warn('无法从当前地址检测 API 基础地址，使用默认设置', error);
            return this.normalizeBase(this.apiBase || 'http://localhost:8317');
        }
    }

    updateLoginConnectionInfo() {
        const connectionUrlElement = document.getElementById('login-connection-url');
        const customInput = document.getElementById('login-api-base');
        if (connectionUrlElement) {
            connectionUrlElement.textContent = this.apiBase || '-';
        }
        if (customInput && customInput !== document.activeElement) {
            customInput.value = this.apiBase || '';
        }
    }

    addModelField(wrapperId, model = {}) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;

        const row = document.createElement('div');
        row.className = 'model-input-row';
        row.innerHTML = `
            <div class="input-group">
                <input type="text" class="model-name-input" placeholder="${i18n.t('common.model_name_placeholder')}" value="${model.name ? this.escapeHtml(model.name) : ''}">
                <input type="text" class="model-alias-input" placeholder="${i18n.t('common.model_alias_placeholder')}" value="${model.alias ? this.escapeHtml(model.alias) : ''}">
                <button type="button" class="btn btn-small btn-danger model-remove-btn"><i class="fas fa-trash"></i></button>
            </div>
        `;

        const removeBtn = row.querySelector('.model-remove-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                wrapper.removeChild(row);
            });
        }

        wrapper.appendChild(row);
    }

    populateModelFields(wrapperId, models = []) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;
        wrapper.innerHTML = '';

        if (!models.length) {
            this.addModelField(wrapperId);
            return;
        }

        models.forEach(model => this.addModelField(wrapperId, model));
    }

    collectModelInputs(wrapperId) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return [];

        const rows = Array.from(wrapper.querySelectorAll('.model-input-row'));
        const models = [];

        rows.forEach(row => {
            const nameInput = row.querySelector('.model-name-input');
            const aliasInput = row.querySelector('.model-alias-input');
            const name = nameInput ? nameInput.value.trim() : '';
            const alias = aliasInput ? aliasInput.value.trim() : '';

            if (name) {
                const model = { name };
                if (alias) {
                    model.alias = alias;
                }
                models.push(model);
            }
        });

        return models;
    }

    renderModelBadges(models) {
        if (!models || models.length === 0) {
            return '';
        }

        return `
            <div class="provider-models">
                ${models.map(model => `
                    <span class="provider-model-tag">
                        <span class="model-name">${this.escapeHtml(model.name || '')}</span>
                        ${model.alias ? `<span class="model-alias">${this.escapeHtml(model.alias)}</span>` : ''}
                    </span>
                `).join('')}
            </div>
        `;
    }

    validateOpenAIProviderInput(name, baseUrl, models) {
        if (!name || !baseUrl) {
            this.showNotification(i18n.t('notification.openai_provider_required'), 'error');
            return false;
        }

        const invalidModel = models.find(model => !model.name);
        if (invalidModel) {
            this.showNotification(i18n.t('notification.openai_model_name_required'), 'error');
            return false;
        }

        return true;
    }
}

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
