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


    // 初始化配置文件编辑器
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

    // HTML转义工具函数
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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

    // ===== 使用统计相关方法 =====

    // 使用统计状态
    requestsChart = null;
    tokensChart = null;
    currentUsageData = null;
    currentModelFilter = 'all';

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
    aiProvidersModule
);

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
