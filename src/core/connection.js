// 连接与配置缓存核心模块
// 提供 API 基础地址规范化、请求封装、配置缓存以及统一数据加载能力

import { STATUS_UPDATE_INTERVAL_MS, DEFAULT_API_PORT } from '../utils/constants.js';
import { secureStorage } from '../utils/secure-storage.js';

export const connectionModule = {
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
    },

    // 由基础地址生成完整管理 API 地址
    computeApiUrl(base) {
        const b = this.normalizeBase(base);
        if (!b) return '';
        return b.replace(/\/$/, '') + '/v0/management';
    },

    setApiBase(newBase) {
        this.apiBase = this.normalizeBase(newBase);
        this.apiUrl = this.computeApiUrl(this.apiBase);
        secureStorage.setItem('apiBase', this.apiBase);
        secureStorage.setItem('apiUrl', this.apiUrl); // 兼容旧字段
        this.updateLoginConnectionInfo();
    },

    // 加载设置（简化版，仅加载内部状态）
    loadSettings() {
        secureStorage.migratePlaintextKeys(['apiBase', 'apiUrl', 'managementKey']);

        const savedBase = secureStorage.getItem('apiBase');
        const savedUrl = secureStorage.getItem('apiUrl');
        const savedKey = secureStorage.getItem('managementKey');

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
    },

    // 读取并填充管理中心版本号（可能来自构建时注入或占位符）
    initUiVersion() {
        const uiVersion = this.readUiVersionFromDom();
        this.uiVersion = uiVersion;
        this.renderVersionInfo();
    },

    // 从 DOM 获取版本占位符，并处理空值、引号或未替换的占位符
    readUiVersionFromDom() {
        const el = document.getElementById('ui-version');
        if (!el) return null;

        const raw = (el.dataset && el.dataset.uiVersion) ? el.dataset.uiVersion : el.textContent;
        if (typeof raw !== 'string') return null;

        const cleaned = raw.replace(/^"+|"+$/g, '').trim();
        if (!cleaned || cleaned === '__VERSION__') {
            return null;
        }
        return cleaned;
    },

    // 根据响应头更新版本与构建时间
    updateVersionFromHeaders(headers) {
        if (!headers || typeof headers.get !== 'function') {
            return;
        }

        const version = headers.get('X-CPA-VERSION');
        const buildDate = headers.get('X-CPA-BUILD-DATE');
        let updated = false;

        if (version && version !== this.serverVersion) {
            this.serverVersion = version;
            updated = true;
        }

        if (buildDate && buildDate !== this.serverBuildDate) {
            this.serverBuildDate = buildDate;
            updated = true;
        }

        if (updated) {
            this.renderVersionInfo();
        }
    },

    // 渲染底栏的版本与构建时间
    renderVersionInfo() {
        const versionEl = document.getElementById('api-version');
        const buildDateEl = document.getElementById('api-build-date');
        const uiVersionEl = document.getElementById('ui-version');

        if (versionEl) {
            versionEl.textContent = this.serverVersion || '-';
        }

        if (buildDateEl) {
            buildDateEl.textContent = this.serverBuildDate
                ? this.formatBuildDate(this.serverBuildDate)
                : '-';
        }

        if (uiVersionEl) {
            const domVersion = this.readUiVersionFromDom();
            uiVersionEl.textContent = this.uiVersion || domVersion || 'v0.0.0-dev';
        }
    },

    // 清空版本信息（例如登出时）
    resetVersionInfo() {
        this.serverVersion = null;
        this.serverBuildDate = null;
        this.renderVersionInfo();
    },

    // 格式化构建时间，优先使用界面语言对应的本地格式
    formatBuildDate(buildDate) {
        if (!buildDate) return '-';

        const parsed = Date.parse(buildDate);
        if (!Number.isNaN(parsed)) {
            const locale = i18n?.currentLanguage || undefined;
            return new Date(parsed).toLocaleString(locale);
        }

        return buildDate;
    },

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

            this.updateVersionFromHeaders(response.headers);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API请求失败:', error);
            throw error;
        }
    },

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
    },

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
                const fullTimestamp = this.cacheTimestamps && this.cacheTimestamps['__full__'];
                const cacheAge = fullTimestamp
                    ? Math.floor((Date.now() - fullTimestamp) / 1000)
                    : 0;
                configStatus.textContent = `${i18n.t('system_info.cache_data')} (${cacheAge}${i18n.t('system_info.seconds_ago')})`;
                configStatus.style.color = '#f59e0b'; // 橙色表示缓存
            } else if (this.configCache && this.configCache['__full__']) {
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
    },

    // 检查连接状态
    async checkConnectionStatus() {
        await this.testConnection();
    },

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
    },

    // 检查缓存是否有效
    isCacheValid(section = null) {
        if (section) {
            // 检查特定配置段的缓存
            // 注意：配置值可能是 false、0、'' 等 falsy 值，不能用 ! 判断
            if (!(section in this.configCache) || !(section in this.cacheTimestamps)) {
                return false;
            }
            return (Date.now() - this.cacheTimestamps[section]) < this.cacheExpiry;
        }
        // 检查全局缓存（兼容旧代码）
        if (!this.configCache['__full__'] || !this.cacheTimestamps['__full__']) {
            return false;
        }
        return (Date.now() - this.cacheTimestamps['__full__']) < this.cacheExpiry;
    },

    // 获取配置（优先使用缓存，支持按段获取）
    async getConfig(section = null, forceRefresh = false) {
        const now = Date.now();

        // 如果请求特定配置段且该段缓存有效
        if (section && !forceRefresh && this.isCacheValid(section)) {
            this.updateConnectionStatus();
            return this.configCache[section];
        }

        // 如果请求全部配置且全局缓存有效
        if (!section && !forceRefresh && this.isCacheValid()) {
            this.updateConnectionStatus();
            return this.configCache['__full__'];
        }

        try {
            const config = await this.makeRequest('/config');

            if (section) {
                // 缓存特定配置段
                this.configCache[section] = config[section];
                this.cacheTimestamps[section] = now;
                // 同时更新全局缓存中的这一段
                if (this.configCache['__full__']) {
                    this.configCache['__full__'][section] = config[section];
                } else {
                    // 如果全局缓存不存在，也创建它
                    this.configCache['__full__'] = config;
                    this.cacheTimestamps['__full__'] = now;
                }
                this.updateConnectionStatus();
                return config[section];
            }

            // 缓存全部配置
            this.configCache['__full__'] = config;
            this.cacheTimestamps['__full__'] = now;

            // 同时缓存各个配置段
            Object.keys(config).forEach(key => {
                this.configCache[key] = config[key];
                this.cacheTimestamps[key] = now;
            });

            this.updateConnectionStatus();
            return config;
        } catch (error) {
            console.error('获取配置失败:', error);
            throw error;
        }
    },

    // 清除缓存（支持清除特定配置段）
    clearCache(section = null) {
        if (section) {
            // 清除特定配置段的缓存
            delete this.configCache[section];
            delete this.cacheTimestamps[section];
            // 同时清除全局缓存中的这一段
            if (this.configCache['__full__']) {
                delete this.configCache['__full__'][section];
            }
        } else {
            // 清除所有缓存
            this.configCache = {};
            this.cacheTimestamps = {};
            this.configYamlCache = '';
        }
    },

    // 启动状态更新定时器
    startStatusUpdateTimer() {
        if (this.statusUpdateTimer) {
            clearInterval(this.statusUpdateTimer);
        }
        this.statusUpdateTimer = setInterval(() => {
            if (this.isConnected) {
                this.updateConnectionStatus();
            }
        }, STATUS_UPDATE_INTERVAL_MS);
    },

    // 停止状态更新定时器
    stopStatusUpdateTimer() {
        if (this.statusUpdateTimer) {
            clearInterval(this.statusUpdateTimer);
            this.statusUpdateTimer = null;
        }
    },

    // 加载所有数据 - 使用新的 /config 端点一次性获取所有配置
    async loadAllData(forceRefresh = false) {
        try {
            console.log(i18n.t('system_info.real_time_data'));
            // 使用新的 /config 端点一次性获取所有配置
            // 注意：getConfig(section, forceRefresh)，不传 section 表示获取全部
            const config = await this.getConfig(null, forceRefresh);

            // 获取一次usage统计数据，供渲染函数和loadUsageStats复用
            let usageData = null;
            let keyStats = null;
            try {
                const response = await this.makeRequest('/usage');
                usageData = response?.usage || null;
                if (usageData) {
                    keyStats = await this.getKeyStats(usageData);
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
        }
    },

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
    },

    detectApiBaseFromLocation() {
        try {
            const { protocol, hostname, port } = window.location;
            const normalizedPort = port ? `:${port}` : '';
            return this.normalizeBase(`${protocol}//${hostname}${normalizedPort}`);
        } catch (error) {
            console.warn('无法从当前地址检测 API 基础地址，使用默认设置', error);
            return this.normalizeBase(this.apiBase || `http://localhost:${DEFAULT_API_PORT}`);
        }
    }
};
