// CLI Proxy API 管理界面 JavaScript
class CLIProxyManager {
    constructor() {
        // 仅保存基础地址（不含 /v0/management），请求时自动补齐
        this.apiBase = 'http://localhost:8317';
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
        
        // 主题管理
        this.currentTheme = 'light';
        
        this.init();
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
        // loadSettings 将在登录成功后调用
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
                console.log('检测到本地连接数据，尝试自动登录...');
                this.showAutoLoginLoading();
                await this.attemptAutoLogin(savedBase, savedKey);
                return; // 自动登录成功，不显示登录页面
            } catch (error) {
                console.log('自动登录失败:', error.message);
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
            
            console.log('自动登录成功');
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
        // 获取当前活动的选项卡
        const activeTab = document.querySelector('.tab-button.active').getAttribute('data-tab');
        
        let apiUrl, managementKey;
        
        if (activeTab === 'local') {
            // 本地连接：从端口号构建URL
            const port = document.getElementById('local-port').value.trim();
            managementKey = document.getElementById('local-management-key').value.trim();
            
            if (!port || !managementKey) {
                this.showLoginError(i18n.t('login.error_required'));
                return;
            }
            
            apiUrl = `http://localhost:${port}`;
        } else {
            // 远程连接：使用完整URL
            apiUrl = document.getElementById('remote-api-url').value.trim();
            managementKey = document.getElementById('remote-management-key').value.trim();
            
            if (!apiUrl || !managementKey) {
                this.showLoginError(i18n.t('login.error_required'));
                return;
            }
        }
        
        const proxyUrl = document.getElementById('login-proxy-url').value.trim();
        
        const submitBtn = document.getElementById('login-submit');
        const originalText = submitBtn.innerHTML;
        
        try {
            submitBtn.innerHTML = `<div class="loading"></div> ${i18n.t('login.submitting')}`;
            submitBtn.disabled = true;
            this.hideLoginError();
            
            // 如果设置了代理，先保存代理设置
            if (proxyUrl) {
                localStorage.setItem('proxyUrl', proxyUrl);
            }
            
            await this.login(apiUrl, managementKey);
            
        } catch (error) {
            this.showLoginError(`${i18n.t('login.error_title')}: ${error.message}`);
        } finally {
            submitBtn.innerHTML = originalText;
            submitBtn.disabled = false;
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
        const keyElement = document.getElementById('display-management-key');
        const statusElement = document.getElementById('display-connection-status');
        
        // 显示API地址
        if (apiUrlElement) {
            apiUrlElement.textContent = this.apiBase || '-';
        }
        
        // 显示密钥（遮蔽显示）
        if (keyElement) {
            if (this.managementKey) {
                const maskedKey = this.maskApiKey(this.managementKey);
                keyElement.textContent = maskedKey;
            } else {
                keyElement.textContent = '-';
            }
        }
        
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
        const savedProxy = localStorage.getItem('proxyUrl');
        
        // 检查元素是否存在（确保在登录页面）
        const localPortInput = document.getElementById('local-port');
        const remoteApiInput = document.getElementById('remote-api-url');
        const localKeyInput = document.getElementById('local-management-key');
        const remoteKeyInput = document.getElementById('remote-management-key');
        const proxyInput = document.getElementById('login-proxy-url');
        
        // 设置本地端口和远程API地址
        if (savedBase) {
            if (savedBase.includes('localhost')) {
                // 从本地URL中提取端口号
                const match = savedBase.match(/localhost:(\d+)/);
                if (match && localPortInput) {
                    localPortInput.value = match[1];
                }
            } else if (remoteApiInput) {
                remoteApiInput.value = savedBase;
            }
        }
        
        // 设置密钥
        if (localKeyInput && savedKey) {
            localKeyInput.value = savedKey;
        }
        if (remoteKeyInput && savedKey) {
            remoteKeyInput.value = savedKey;
        }
        
        // 设置代理
        if (proxyInput && savedProxy) {
            proxyInput.value = savedProxy;
        }
        
        // 设置实时保存监听器
        this.setupLoginAutoSave();
    }

    // 设置登录页面自动保存
    setupLoginAutoSave() {
        const localPortInput = document.getElementById('local-port');
        const remoteApiInput = document.getElementById('remote-api-url');
        const localKeyInput = document.getElementById('local-management-key');
        const remoteKeyInput = document.getElementById('remote-management-key');
        const proxyInput = document.getElementById('login-proxy-url');

        const saveLocalBase = (port) => {
            if (port.trim()) {
                const apiUrl = `http://localhost:${port}`;
                this.setApiBase(apiUrl);
            }
        };
        const saveLocalBaseDebounced = this.debounce(saveLocalBase, 500);

        const saveRemoteBase = (val) => {
            if (val.trim()) {
                this.setApiBase(val);
            }
        };
        const saveRemoteBaseDebounced = this.debounce(saveRemoteBase, 500);

        const saveKey = (val) => {
            if (val.trim()) {
                this.managementKey = val;
                localStorage.setItem('managementKey', this.managementKey);
            }
        };
        const saveKeyDebounced = this.debounce(saveKey, 500);

        const saveProxy = (val) => {
            if (val.trim()) {
                localStorage.setItem('proxyUrl', val);
            }
        };
        const saveProxyDebounced = this.debounce(saveProxy, 500);

        // 绑定本地端口输入框
        if (localPortInput) {
            localPortInput.addEventListener('change', (e) => saveLocalBase(e.target.value));
            localPortInput.addEventListener('input', (e) => saveLocalBaseDebounced(e.target.value));
        }

        // 绑定远程API输入框
        if (remoteApiInput) {
            remoteApiInput.addEventListener('change', (e) => saveRemoteBase(e.target.value));
            remoteApiInput.addEventListener('input', (e) => saveRemoteBaseDebounced(e.target.value));
        }

        // 绑定本地密钥输入框
        if (localKeyInput) {
            localKeyInput.addEventListener('change', (e) => saveKey(e.target.value));
            localKeyInput.addEventListener('input', (e) => saveKeyDebounced(e.target.value));
        }

        // 绑定远程密钥输入框
        if (remoteKeyInput) {
            remoteKeyInput.addEventListener('change', (e) => saveKey(e.target.value));
            remoteKeyInput.addEventListener('input', (e) => saveKeyDebounced(e.target.value));
        }

        // 绑定代理输入框
        if (proxyInput) {
            proxyInput.addEventListener('change', (e) => saveProxy(e.target.value));
            proxyInput.addEventListener('input', (e) => saveProxyDebounced(e.target.value));
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
        
        // 选项卡切换事件
        this.setupTabSwitching();
        
        // 密钥可见性切换事件
        this.setupKeyVisibilityToggle();
        
        // 主页面元素（延迟绑定，在显示主页面时绑定）
        this.bindMainPageEvents();
    }
    
    // 设置选项卡切换
    setupTabSwitching() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const connectionForms = document.querySelectorAll('.connection-form');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const targetTab = button.getAttribute('data-tab');
                
                // 更新选项卡状态
                tabButtons.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
                
                // 切换表单
                connectionForms.forEach(form => {
                    form.classList.remove('active');
                    if (form.id === `${targetTab}-form`) {
                        form.classList.add('active');
                    }
                });
            });
        });
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
        
        
        // Gemini Web Token
        const geminiWebTokenBtn = document.getElementById('gemini-web-token-btn');
        if (geminiWebTokenBtn) {
            geminiWebTokenBtn.addEventListener('click', () => this.showGeminiWebTokenModal());
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
        
        // 使用统计
        const refreshUsageStats = document.getElementById('refresh-usage-stats');
        const requestsHourBtn = document.getElementById('requests-hour-btn');
        const requestsDayBtn = document.getElementById('requests-day-btn');
        const tokensHourBtn = document.getElementById('tokens-hour-btn');
        const tokensDayBtn = document.getElementById('tokens-day-btn');
        
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
        
        // 模态框
        const closeBtn = document.querySelector('.close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeModal());
        }
        
        window.addEventListener('click', (e) => {
            const modal = document.getElementById('modal');
            if (modal && e.target === modal) {
                this.closeModal();
            }
        });
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
    }

    // 加载设置（简化版，仅加载内部状态）
    loadSettings() {
        const savedBase = localStorage.getItem('apiBase');
        const savedUrl = localStorage.getItem('apiUrl');
        const savedKey = localStorage.getItem('managementKey');
        
        // 只设置内部状态，不操作DOM元素
        if (savedBase) {
            this.setApiBase(savedBase);
        } else if (savedUrl) {
            const base = (savedUrl || '').replace(/\/?v0\/management\/?$/i, '');
            this.setApiBase(base);
        } else {
            this.setApiBase(this.apiBase);
        }
        
        if (savedKey) {
            this.managementKey = savedKey;
        }
        
    
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
            console.log('使用新的 /config 端点加载所有配置...');
            // 使用新的 /config 端点一次性获取所有配置
            const config = await this.getConfig(forceRefresh);
            
            // 从配置中提取并设置各个设置项
            this.updateSettingsFromConfig(config);
            
            // 认证文件需要单独加载，因为不在配置中
            await this.loadAuthFiles();
            
            // 使用统计需要单独加载
            await this.loadUsageStats();
            
            console.log('配置加载完成，使用缓存:', !forceRefresh && this.isCacheValid());
        } catch (error) {
            console.error('加载配置失败:', error);
            console.log('回退到逐个加载方式...');
            // 如果新方法失败，回退到原来的逐个加载方式
            await this.loadAllDataLegacy();
        }
    }

    // 从配置对象更新所有设置
    updateSettingsFromConfig(config) {
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
        
        
        // API 密钥
        if (config['api-keys']) {
            this.renderApiKeys(config['api-keys']);
        }
        
        // Gemini 密钥
        if (config['generative-language-api-key']) {
            this.renderGeminiKeys(config['generative-language-api-key']);
        }
        
        // Codex 密钥
        if (config['codex-api-key']) {
            this.renderCodexKeys(config['codex-api-key']);
        }
        
        // Claude 密钥
        if (config['claude-api-key']) {
            this.renderClaudeKeys(config['claude-api-key']);
        }
        
        // OpenAI 兼容提供商
        if (config['openai-compatibility']) {
            this.renderOpenAIProviders(config['openai-compatibility']);
        }
    }

    // 回退方法：原来的逐个加载方式
    async loadAllDataLegacy() {
        await Promise.all([
            this.loadDebugSettings(),
            this.loadProxySettings(),
            this.loadRetrySettings(),
            this.loadQuotaSettings(),
            this.loadApiKeys(),
            this.loadGeminiKeys(),
            this.loadCodexKeys(),
            this.loadClaudeKeys(),
            this.loadOpenAIProviders(),
            this.loadAuthFiles()
        ]);
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
        
        container.innerHTML = keys.map((key, index) => `
            <div class="key-item">
                <div class="item-content">
                    <div class="item-title">${i18n.t('api_keys.item_title')} #${index + 1}</div>
                    <div class="item-value">${this.maskApiKey(key)}</div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary" onclick="manager.editApiKey(${index}, '${key}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" onclick="manager.deleteApiKey(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    // 遮蔽API密钥显示
    maskApiKey(key) {
        if (key.length <= 8) return key;
        return key.substring(0, 4) + '...' + key.substring(key.length - 4);
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

    // 加载Gemini密钥
    async loadGeminiKeys() {
        try {
            const config = await this.getConfig();
            if (config['generative-language-api-key']) {
                this.renderGeminiKeys(config['generative-language-api-key']);
            }
        } catch (error) {
            console.error('加载Gemini密钥失败:', error);
        }
    }

    // 渲染Gemini密钥列表
    renderGeminiKeys(keys) {
        const container = document.getElementById('gemini-keys-list');
        
        if (keys.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fab fa-google"></i>
                    <h3>${i18n.t('ai_providers.gemini_empty_title')}</h3>
                    <p>${i18n.t('ai_providers.gemini_empty_desc')}</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = keys.map((key, index) => `
            <div class="key-item">
                <div class="item-content">
                    <div class="item-title">${i18n.t('ai_providers.gemini_item_title')} #${index + 1}</div>
                    <div class="item-value">${this.maskApiKey(key)}</div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary" onclick="manager.editGeminiKey(${index}, '${key}')">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" onclick="manager.deleteGeminiKey('${key}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    // 显示添加Gemini密钥模态框
    showAddGeminiKeyModal() {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        
        modalBody.innerHTML = `
            <h3>添加Gemini API密钥</h3>
            <div class="form-group">
                <label for="new-gemini-key">API密钥:</label>
                <input type="text" id="new-gemini-key" placeholder="请输入Gemini API密钥">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.addGeminiKey()">添加</button>
            </div>
        `;
        
        modal.style.display = 'block';
    }

    // 添加Gemini密钥
    async addGeminiKey() {
        const newKey = document.getElementById('new-gemini-key').value.trim();
        
        if (!newKey) {
            this.showNotification('请输入Gemini API密钥', 'error');
            return;
        }
        
        try {
            const data = await this.makeRequest('/generative-language-api-key');
            const currentKeys = data['generative-language-api-key'] || [];
            currentKeys.push(newKey);
            
            await this.makeRequest('/generative-language-api-key', {
                method: 'PUT',
                body: JSON.stringify(currentKeys)
            });
            
            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadGeminiKeys();
            this.showNotification('Gemini密钥添加成功', 'success');
        } catch (error) {
            this.showNotification(`添加Gemini密钥失败: ${error.message}`, 'error');
        }
    }

    // 编辑Gemini密钥
    editGeminiKey(index, currentKey) {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        
        modalBody.innerHTML = `
            <h3>编辑Gemini API密钥</h3>
            <div class="form-group">
                <label for="edit-gemini-key">API密钥:</label>
                <input type="text" id="edit-gemini-key" value="${currentKey}">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.updateGeminiKey('${currentKey}')">更新</button>
            </div>
        `;
        
        modal.style.display = 'block';
    }

    // 更新Gemini密钥
    async updateGeminiKey(oldKey) {
        const newKey = document.getElementById('edit-gemini-key').value.trim();
        
        if (!newKey) {
            this.showNotification('请输入Gemini API密钥', 'error');
            return;
        }
        
        try {
            await this.makeRequest('/generative-language-api-key', {
                method: 'PATCH',
                body: JSON.stringify({ old: oldKey, new: newKey })
            });
            
            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadGeminiKeys();
            this.showNotification('Gemini密钥更新成功', 'success');
        } catch (error) {
            this.showNotification(`更新Gemini密钥失败: ${error.message}`, 'error');
        }
    }

    // 删除Gemini密钥
    async deleteGeminiKey(key) {
        if (!confirm(i18n.t('ai_providers.gemini_delete_confirm'))) return;
        
        try {
            await this.makeRequest(`/generative-language-api-key?value=${encodeURIComponent(key)}`, { method: 'DELETE' });
            this.clearCache(); // 清除缓存
            this.loadGeminiKeys();
            this.showNotification('Gemini密钥删除成功', 'success');
        } catch (error) {
            this.showNotification(`删除Gemini密钥失败: ${error.message}`, 'error');
        }
    }

    // 加载Codex密钥
    async loadCodexKeys() {
        try {
            const config = await this.getConfig();
            if (config['codex-api-key']) {
                this.renderCodexKeys(config['codex-api-key']);
            }
        } catch (error) {
            console.error('加载Codex密钥失败:', error);
        }
    }

    // 渲染Codex密钥列表
    renderCodexKeys(keys) {
        const container = document.getElementById('codex-keys-list');
        
        if (keys.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-code"></i>
                    <h3>${i18n.t('ai_providers.codex_empty_title')}</h3>
                    <p>${i18n.t('ai_providers.codex_empty_desc')}</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = keys.map((config, index) => `
            <div class="provider-item">
                <div class="item-content">
                    <div class="item-title">${i18n.t('ai_providers.codex_item_title')} #${index + 1}</div>
                    <div class="item-subtitle">${i18n.t('common.api_key')}: ${this.maskApiKey(config['api-key'])}</div>
                    ${config['base-url'] ? `<div class="item-subtitle">${i18n.t('common.base_url')}: ${config['base-url']}</div>` : ''}
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary" onclick="manager.editCodexKey(${index}, ${JSON.stringify(config).replace(/"/g, '&quot;')})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" onclick="manager.deleteCodexKey('${config['api-key']}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    // 显示添加Codex密钥模态框
    showAddCodexKeyModal() {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        
        modalBody.innerHTML = `
            <h3>添加Codex API配置</h3>
            <div class="form-group">
                <label for="new-codex-key">API密钥:</label>
                <input type="text" id="new-codex-key" placeholder="请输入Codex API密钥">
            </div>
            <div class="form-group">
                <label for="new-codex-url">Base URL (可选):</label>
                <input type="text" id="new-codex-url" placeholder="例如: https://api.example.com">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.addCodexKey()">添加</button>
            </div>
        `;
        
        modal.style.display = 'block';
    }

    // 添加Codex密钥
    async addCodexKey() {
        const apiKey = document.getElementById('new-codex-key').value.trim();
        const baseUrl = document.getElementById('new-codex-url').value.trim();
        
        if (!apiKey) {
            this.showNotification('请输入API密钥', 'error');
            return;
        }
        
        try {
            const data = await this.makeRequest('/codex-api-key');
            const currentKeys = data['codex-api-key'] || [];
            
            const newConfig = { 'api-key': apiKey };
            if (baseUrl) {
                newConfig['base-url'] = baseUrl;
            }
            
            currentKeys.push(newConfig);
            
            await this.makeRequest('/codex-api-key', {
                method: 'PUT',
                body: JSON.stringify(currentKeys)
            });
            
            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadCodexKeys();
            this.showNotification('Codex配置添加成功', 'success');
        } catch (error) {
            this.showNotification(`添加Codex配置失败: ${error.message}`, 'error');
        }
    }

    // 编辑Codex密钥
    editCodexKey(index, config) {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        
        modalBody.innerHTML = `
            <h3>编辑Codex API配置</h3>
            <div class="form-group">
                <label for="edit-codex-key">API密钥:</label>
                <input type="text" id="edit-codex-key" value="${config['api-key']}">
            </div>
            <div class="form-group">
                <label for="edit-codex-url">Base URL (可选):</label>
                <input type="text" id="edit-codex-url" value="${config['base-url'] || ''}">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.updateCodexKey(${index})">更新</button>
            </div>
        `;
        
        modal.style.display = 'block';
    }

    // 更新Codex密钥
    async updateCodexKey(index) {
        const apiKey = document.getElementById('edit-codex-key').value.trim();
        const baseUrl = document.getElementById('edit-codex-url').value.trim();
        
        if (!apiKey) {
            this.showNotification('请输入API密钥', 'error');
            return;
        }
        
        try {
            const newConfig = { 'api-key': apiKey };
            if (baseUrl) {
                newConfig['base-url'] = baseUrl;
            }
            
            await this.makeRequest('/codex-api-key', {
                method: 'PATCH',
                body: JSON.stringify({ index, value: newConfig })
            });
            
            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadCodexKeys();
            this.showNotification('Codex配置更新成功', 'success');
        } catch (error) {
            this.showNotification(`更新Codex配置失败: ${error.message}`, 'error');
        }
    }

    // 删除Codex密钥
    async deleteCodexKey(apiKey) {
        if (!confirm(i18n.t('ai_providers.codex_delete_confirm'))) return;
        
        try {
            await this.makeRequest(`/codex-api-key?api-key=${encodeURIComponent(apiKey)}`, { method: 'DELETE' });
            this.clearCache(); // 清除缓存
            this.loadCodexKeys();
            this.showNotification('Codex配置删除成功', 'success');
        } catch (error) {
            this.showNotification(`删除Codex配置失败: ${error.message}`, 'error');
        }
    }

    // 加载Claude密钥
    async loadClaudeKeys() {
        try {
            const config = await this.getConfig();
            if (config['claude-api-key']) {
                this.renderClaudeKeys(config['claude-api-key']);
            }
        } catch (error) {
            console.error('加载Claude密钥失败:', error);
        }
    }

    // 渲染Claude密钥列表
    renderClaudeKeys(keys) {
        const container = document.getElementById('claude-keys-list');
        
        if (keys.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-brain"></i>
                    <h3>${i18n.t('ai_providers.claude_empty_title')}</h3>
                    <p>${i18n.t('ai_providers.claude_empty_desc')}</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = keys.map((config, index) => `
            <div class="provider-item">
                <div class="item-content">
                    <div class="item-title">${i18n.t('ai_providers.claude_item_title')} #${index + 1}</div>
                    <div class="item-subtitle">${i18n.t('common.api_key')}: ${this.maskApiKey(config['api-key'])}</div>
                    ${config['base-url'] ? `<div class="item-subtitle">${i18n.t('common.base_url')}: ${config['base-url']}</div>` : ''}
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary" onclick="manager.editClaudeKey(${index}, ${JSON.stringify(config).replace(/"/g, '&quot;')})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" onclick="manager.deleteClaudeKey('${config['api-key']}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    // 显示添加Claude密钥模态框
    showAddClaudeKeyModal() {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        
        modalBody.innerHTML = `
            <h3>添加Claude API配置</h3>
            <div class="form-group">
                <label for="new-claude-key">API密钥:</label>
                <input type="text" id="new-claude-key" placeholder="请输入Claude API密钥">
            </div>
            <div class="form-group">
                <label for="new-claude-url">Base URL (可选):</label>
                <input type="text" id="new-claude-url" placeholder="例如: https://api.anthropic.com">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.addClaudeKey()">添加</button>
            </div>
        `;
        
        modal.style.display = 'block';
    }

    // 添加Claude密钥
    async addClaudeKey() {
        const apiKey = document.getElementById('new-claude-key').value.trim();
        const baseUrl = document.getElementById('new-claude-url').value.trim();
        
        if (!apiKey) {
            this.showNotification('请输入API密钥', 'error');
            return;
        }
        
        try {
            const data = await this.makeRequest('/claude-api-key');
            const currentKeys = data['claude-api-key'] || [];
            
            const newConfig = { 'api-key': apiKey };
            if (baseUrl) {
                newConfig['base-url'] = baseUrl;
            }
            
            currentKeys.push(newConfig);
            
            await this.makeRequest('/claude-api-key', {
                method: 'PUT',
                body: JSON.stringify(currentKeys)
            });
            
            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadClaudeKeys();
            this.showNotification('Claude配置添加成功', 'success');
        } catch (error) {
            this.showNotification(`添加Claude配置失败: ${error.message}`, 'error');
        }
    }

    // 编辑Claude密钥
    editClaudeKey(index, config) {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        
        modalBody.innerHTML = `
            <h3>编辑Claude API配置</h3>
            <div class="form-group">
                <label for="edit-claude-key">API密钥:</label>
                <input type="text" id="edit-claude-key" value="${config['api-key']}">
            </div>
            <div class="form-group">
                <label for="edit-claude-url">Base URL (可选):</label>
                <input type="text" id="edit-claude-url" value="${config['base-url'] || ''}">
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.updateClaudeKey(${index})">更新</button>
            </div>
        `;
        
        modal.style.display = 'block';
    }

    // 更新Claude密钥
    async updateClaudeKey(index) {
        const apiKey = document.getElementById('edit-claude-key').value.trim();
        const baseUrl = document.getElementById('edit-claude-url').value.trim();
        
        if (!apiKey) {
            this.showNotification('请输入API密钥', 'error');
            return;
        }
        
        try {
            const newConfig = { 'api-key': apiKey };
            if (baseUrl) {
                newConfig['base-url'] = baseUrl;
            }
            
            await this.makeRequest('/claude-api-key', {
                method: 'PATCH',
                body: JSON.stringify({ index, value: newConfig })
            });
            
            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadClaudeKeys();
            this.showNotification('Claude配置更新成功', 'success');
        } catch (error) {
            this.showNotification(`更新Claude配置失败: ${error.message}`, 'error');
        }
    }

    // 删除Claude密钥
    async deleteClaudeKey(apiKey) {
        if (!confirm(i18n.t('ai_providers.claude_delete_confirm'))) return;
        
        try {
            await this.makeRequest(`/claude-api-key?api-key=${encodeURIComponent(apiKey)}`, { method: 'DELETE' });
            this.clearCache(); // 清除缓存
            this.loadClaudeKeys();
            this.showNotification('Claude配置删除成功', 'success');
        } catch (error) {
            this.showNotification(`删除Claude配置失败: ${error.message}`, 'error');
        }
    }

    // 加载OpenAI提供商
    async loadOpenAIProviders() {
        try {
            const config = await this.getConfig();
            if (config['openai-compatibility']) {
                this.renderOpenAIProviders(config['openai-compatibility']);
            }
        } catch (error) {
            console.error('加载OpenAI提供商失败:', error);
        }
    }

    // 渲染OpenAI提供商列表
    renderOpenAIProviders(providers) {
        const container = document.getElementById('openai-providers-list');
        
        if (providers.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-plug"></i>
                    <h3>${i18n.t('ai_providers.openai_empty_title')}</h3>
                    <p>${i18n.t('ai_providers.openai_empty_desc')}</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = providers.map((provider, index) => `
            <div class="provider-item">
                <div class="item-content">
                    <div class="item-title">${provider.name}</div>
                    <div class="item-subtitle">${i18n.t('common.base_url')}: ${provider['base-url']}</div>
                    <div class="item-subtitle">${i18n.t('ai_providers.openai_keys_count')}: ${(provider['api-keys'] || []).length}</div>
                    <div class="item-subtitle">${i18n.t('ai_providers.openai_models_count')}: ${(provider.models || []).length}</div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary" onclick="manager.editOpenAIProvider(${index}, ${JSON.stringify(provider).replace(/"/g, '&quot;')})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" onclick="manager.deleteOpenAIProvider('${provider.name}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    // 显示添加OpenAI提供商模态框
    showAddOpenAIProviderModal() {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        
        modalBody.innerHTML = `
            <h3>添加OpenAI兼容提供商</h3>
            <div class="form-group">
                <label for="new-provider-name">提供商名称:</label>
                <input type="text" id="new-provider-name" placeholder="例如: openrouter">
            </div>
            <div class="form-group">
                <label for="new-provider-url">Base URL:</label>
                <input type="text" id="new-provider-url" placeholder="例如: https://openrouter.ai/api/v1">
            </div>
            <div class="form-group">
                <label for="new-provider-keys">API密钥 (每行一个):</label>
                <textarea id="new-provider-keys" rows="3" placeholder="sk-key1&#10;sk-key2"></textarea>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.addOpenAIProvider()">添加</button>
            </div>
        `;
        
        modal.style.display = 'block';
    }

    // 添加OpenAI提供商
    async addOpenAIProvider() {
        const name = document.getElementById('new-provider-name').value.trim();
        const baseUrl = document.getElementById('new-provider-url').value.trim();
        const keysText = document.getElementById('new-provider-keys').value.trim();
        
        if (!name || !baseUrl) {
            this.showNotification('请填写提供商名称和Base URL', 'error');
            return;
        }
        
        try {
            const data = await this.makeRequest('/openai-compatibility');
            const currentProviders = data['openai-compatibility'] || [];
            
            const apiKeys = keysText ? keysText.split('\n').map(k => k.trim()).filter(k => k) : [];
            
            const newProvider = {
                name,
                'base-url': baseUrl,
                'api-keys': apiKeys,
                models: []
            };
            
            currentProviders.push(newProvider);
            
            await this.makeRequest('/openai-compatibility', {
                method: 'PUT',
                body: JSON.stringify(currentProviders)
            });
            
            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadOpenAIProviders();
            this.showNotification('OpenAI提供商添加成功', 'success');
        } catch (error) {
            this.showNotification(`添加OpenAI提供商失败: ${error.message}`, 'error');
        }
    }

    // 编辑OpenAI提供商
    editOpenAIProvider(index, provider) {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        
        const apiKeysText = (provider['api-keys'] || []).join('\n');
        
        modalBody.innerHTML = `
            <h3>编辑OpenAI兼容提供商</h3>
            <div class="form-group">
                <label for="edit-provider-name">提供商名称:</label>
                <input type="text" id="edit-provider-name" value="${provider.name}">
            </div>
            <div class="form-group">
                <label for="edit-provider-url">Base URL:</label>
                <input type="text" id="edit-provider-url" value="${provider['base-url']}">
            </div>
            <div class="form-group">
                <label for="edit-provider-keys">API密钥 (每行一个):</label>
                <textarea id="edit-provider-keys" rows="3">${apiKeysText}</textarea>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.updateOpenAIProvider(${index})">更新</button>
            </div>
        `;
        
        modal.style.display = 'block';
    }

    // 更新OpenAI提供商
    async updateOpenAIProvider(index) {
        const name = document.getElementById('edit-provider-name').value.trim();
        const baseUrl = document.getElementById('edit-provider-url').value.trim();
        const keysText = document.getElementById('edit-provider-keys').value.trim();
        
        if (!name || !baseUrl) {
            this.showNotification('请填写提供商名称和Base URL', 'error');
            return;
        }
        
        try {
            const apiKeys = keysText ? keysText.split('\n').map(k => k.trim()).filter(k => k) : [];
            
            const updatedProvider = {
                name,
                'base-url': baseUrl,
                'api-keys': apiKeys,
                models: []
            };
            
            await this.makeRequest('/openai-compatibility', {
                method: 'PATCH',
                body: JSON.stringify({ index, value: updatedProvider })
            });
            
            this.clearCache(); // 清除缓存
            this.closeModal();
            this.loadOpenAIProviders();
            this.showNotification('OpenAI提供商更新成功', 'success');
        } catch (error) {
            this.showNotification(`更新OpenAI提供商失败: ${error.message}`, 'error');
        }
    }

    // 删除OpenAI提供商
    async deleteOpenAIProvider(name) {
        if (!confirm(i18n.t('ai_providers.openai_delete_confirm'))) return;
        
        try {
            await this.makeRequest(`/openai-compatibility?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
            this.clearCache(); // 清除缓存
            this.loadOpenAIProviders();
            this.showNotification('OpenAI提供商删除成功', 'success');
        } catch (error) {
            this.showNotification(`删除OpenAI提供商失败: ${error.message}`, 'error');
        }
    }

    // 加载认证文件
    async loadAuthFiles() {
        try {
            const data = await this.makeRequest('/auth-files');
            this.renderAuthFiles(data.files || []);
        } catch (error) {
            console.error('加载认证文件失败:', error);
        }
    }

    // 渲染认证文件列表
    renderAuthFiles(files) {
        const container = document.getElementById('auth-files-list');
        
        if (files.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-file-alt"></i>
                    <h3>${i18n.t('auth_files.empty_title')}</h3>
                    <p>${i18n.t('auth_files.empty_desc')}</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = files.map(file => `
            <div class="file-item">
                <div class="item-content">
                    <div class="item-title">${file.name}</div>
                    <div class="item-subtitle">${i18n.t('auth_files.file_size')}: ${this.formatFileSize(file.size)}</div>
                    <div class="item-subtitle">${i18n.t('auth_files.file_modified')}: ${new Date(file.modtime).toLocaleString(i18n.currentLanguage === 'zh-CN' ? 'zh-CN' : 'en-US')}</div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-primary" onclick="manager.downloadAuthFile('${file.name}')">
                        <i class="fas fa-download"></i>
                    </button>
                    <button class="btn btn-danger" onclick="manager.deleteAuthFile('${file.name}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    }

    // 格式化文件大小
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
            this.showNotification(`文件上传失败: ${error.message}`, 'error');
        }
        
        // 清空文件输入
        event.target.value = '';
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
            this.showNotification(`文件下载失败: ${error.message}`, 'error');
        }
    }

    // 删除认证文件
    async deleteAuthFile(filename) {
        if (!confirm(`${i18n.t('auth_files.delete_confirm')} "${filename}" 吗？`)) return;
        
        try {
            await this.makeRequest(`/auth-files?name=${encodeURIComponent(filename)}`, { method: 'DELETE' });
            this.clearCache(); // 清除缓存
            this.loadAuthFiles();
            this.showNotification(i18n.t('auth_files.delete_success'), 'success');
        } catch (error) {
            this.showNotification(`文件删除失败: ${error.message}`, 'error');
        }
    }

    // 删除所有认证文件
    async deleteAllAuthFiles() {
        if (!confirm(i18n.t('auth_files.delete_all_confirm'))) return;
        
        try {
            const response = await this.makeRequest('/auth-files?all=true', { method: 'DELETE' });
            this.clearCache(); // 清除缓存
            this.loadAuthFiles();
            this.showNotification(`${i18n.t('auth_files.delete_all_success')} ${response.deleted} ${i18n.t('auth_files.files_count')}`, 'success');
        } catch (error) {
            this.showNotification(`删除文件失败: ${error.message}`, 'error');
        }
    }





    // 显示 Gemini Web Token 模态框
    showGeminiWebTokenModal() {
        const inlineSecure1psid = document.getElementById('secure-1psid-input');
        const inlineSecure1psidts = document.getElementById('secure-1psidts-input');
        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = `
            <h3>${i18n.t('auth_login.gemini_web_button')}</h3>
            <div class="gemini-web-form">
                <div class="form-group">
                    <label for="modal-secure-1psid">${i18n.t('auth_login.secure_1psid_label')}</label>
                    <input type="text" id="modal-secure-1psid" placeholder="${i18n.t('auth_login.secure_1psid_placeholder')}" required>
                    <div class="form-hint">从浏览器开发者工具 → Application → Cookies 中获取</div>
                </div>
                <div class="form-group">
                    <label for="modal-secure-1psidts">${i18n.t('auth_login.secure_1psidts_label')}</label>
                    <input type="text" id="modal-secure-1psidts" placeholder="${i18n.t('auth_login.secure_1psidts_placeholder')}" required>
                    <div class="form-hint">从浏览器开发者工具 → Application → Cookies 中获取</div>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.cancel')}</button>
                    <button class="btn btn-primary" onclick="manager.saveGeminiWebToken()">${i18n.t('common.save')}</button>
                </div>
            </div>
        `;
        this.showModal();

        const modalSecure1psid = document.getElementById('modal-secure-1psid');
        const modalSecure1psidts = document.getElementById('modal-secure-1psidts');

        if (modalSecure1psid && inlineSecure1psid) {
            modalSecure1psid.value = inlineSecure1psid.value.trim();
        }
        if (modalSecure1psidts && inlineSecure1psidts) {
            modalSecure1psidts.value = inlineSecure1psidts.value.trim();
        }

        if (modalSecure1psid) {
            modalSecure1psid.focus();
        }
    }

    // 保存 Gemini Web Token
    async saveGeminiWebToken() {
        const secure1psid = document.getElementById('modal-secure-1psid').value.trim();
        const secure1psidts = document.getElementById('modal-secure-1psidts').value.trim();
        
        if (!secure1psid || !secure1psidts) {
            this.showNotification('请填写完整的 Cookie 信息', 'error');
            return;
        }
        
        try {
            const response = await this.makeRequest('/gemini-web-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    secure_1psid: secure1psid,
                    secure_1psidts: secure1psidts
                })
            });
            
            this.closeModal();
            this.loadAuthFiles(); // 刷新认证文件列表
            const inlineSecure1psid = document.getElementById('secure-1psid-input');
            const inlineSecure1psidts = document.getElementById('secure-1psidts-input');
            if (inlineSecure1psid) {
                inlineSecure1psid.value = secure1psid;
            }
            if (inlineSecure1psidts) {
                inlineSecure1psidts.value = secure1psidts;
            }
            this.showNotification(`${i18n.t('auth_login.gemini_web_saved')}: ${response.file}`, 'success');
        } catch (error) {
            this.showNotification(`保存失败: ${error.message}`, 'error');
        }
    }

    // ===== 使用统计相关方法 =====
    
    // 初始化图表变量
    requestsChart = null;
    tokensChart = null;
    currentUsageData = null;
    
    // 加载使用统计
    async loadUsageStats() {
        try {
            const response = await this.makeRequest('/usage');
            const usage = response?.usage || null;
            this.currentUsageData = usage;

            if (!usage) {
                throw new Error('usage payload missing');
            }

            // 更新概览卡片
            this.updateUsageOverview(usage);

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
                plugins: {
                    legend: {
                        display: false
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
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        fill: true,
                        tension: 0.4
                    },
                    point: {
                        backgroundColor: '#3b82f6',
                        borderColor: '#ffffff',
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
                plugins: {
                    legend: {
                        display: false
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
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        fill: true,
                        tension: 0.4
                    },
                    point: {
                        backgroundColor: '#10b981',
                        borderColor: '#ffffff',
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
            return { labels: [], datasets: [{ data: [] }] };
        }
        
        let dataSource, labels, values;
        
        if (period === 'hour') {
            dataSource = this.currentUsageData.requests_by_hour || {};
            labels = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
            values = labels.map(hour => dataSource[hour] || 0);
        } else {
            dataSource = this.currentUsageData.requests_by_day || {};
            labels = Object.keys(dataSource).sort();
            values = labels.map(day => dataSource[day] || 0);
        }
        
        return {
            labels: labels,
            datasets: [{
                data: values
            }]
        };
    }
    
    // 获取Token图表数据
    getTokensChartData(period) {
        if (!this.currentUsageData) {
            return { labels: [], datasets: [{ data: [] }] };
        }
        
        let dataSource, labels, values;
        
        if (period === 'hour') {
            dataSource = this.currentUsageData.tokens_by_hour || {};
            labels = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
            values = labels.map(hour => dataSource[hour] || 0);
        } else {
            dataSource = this.currentUsageData.tokens_by_day || {};
            labels = Object.keys(dataSource).sort();
            values = labels.map(day => dataSource[day] || 0);
        }
        
        return {
            labels: labels,
            datasets: [{
                data: values
            }]
        };
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
}

// 全局管理器实例
let manager;

// 尝试自动加载根目录 Logo（支持多种常见文件名/扩展名）
function setupSiteLogo() {
    const img = document.getElementById('site-logo');
    const loginImg = document.getElementById('login-logo');
    if (!img && !loginImg) return;
    
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
