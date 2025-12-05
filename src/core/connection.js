// 连接与配置缓存核心模块
// 提供 API 基础地址规范化、请求封装、配置缓存以及统一数据加载能力

import { STATUS_UPDATE_INTERVAL_MS, DEFAULT_API_PORT } from '../utils/constants.js';
import { secureStorage } from '../utils/secure-storage.js';
import { normalizeModelList, classifyModels } from '../utils/models.js';

const buildModelsEndpoint = (baseUrl) => {
    if (!baseUrl) return '';
    const trimmed = String(baseUrl).trim().replace(/\/+$/g, '');
    if (!trimmed) return '';
    return trimmed.endsWith('/v1') ? `${trimmed}/models` : `${trimmed}/v1/models`;
};

const normalizeApiKeyList = (input) => {
    if (!Array.isArray(input)) return [];
    const seen = new Set();
    const keys = [];

    input.forEach(item => {
        const value = typeof item === 'string'
            ? item
            : (item && item['api-key'] ? item['api-key'] : '');
        const trimmed = String(value || '').trim();
        if (!trimmed || seen.has(trimmed)) {
            return;
        }
        seen.add(trimmed);
        keys.push(trimmed);
    });

    return keys;
};

export const connectionModule = {
    // 规范化基础地址，移除尾部斜杠与 /v0/management
    normalizeBase(input) {
        return this.apiClient.normalizeBase(input);
    },

    // 由基础地址生成完整管理 API 地址
    computeApiUrl(base) {
        return this.apiClient.computeApiUrl(base);
    },

    setApiBase(newBase) {
        this.apiClient.setApiBase(newBase);
        this.apiBase = this.apiClient.apiBase;
        this.apiUrl = this.apiClient.apiUrl;
        secureStorage.setItem('apiBase', this.apiBase);
        secureStorage.setItem('apiUrl', this.apiUrl); // 兼容旧字段
        this.updateLoginConnectionInfo();
    },

    setManagementKey(key, { persist = true } = {}) {
        this.managementKey = key || '';
        this.apiClient.setManagementKey(this.managementKey);
        if (persist) {
            secureStorage.setItem('managementKey', this.managementKey);
        }
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

        this.setManagementKey(savedKey || '', { persist: false });

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

    renderVersionCheckStatus({
        currentVersion,
        latestVersion,
        message,
        status
    } = {}) {
        const resolvedCurrent = (typeof currentVersion === 'undefined' || currentVersion === null)
            ? this.serverVersion
            : currentVersion;
        const resolvedLatest = (typeof latestVersion === 'undefined' || latestVersion === null)
            ? this.latestVersion
            : latestVersion;
        const resolvedMessage = (typeof message === 'undefined' || message === null)
            ? (this.versionCheckMessage || i18n.t('system_info.version_check_idle'))
            : message;
        const resolvedStatus = status || this.versionCheckStatus || 'muted';

        this.latestVersion = resolvedLatest || null;
        this.versionCheckMessage = resolvedMessage;
        this.versionCheckStatus = resolvedStatus;

        const currentEl = document.getElementById('version-check-current');
        if (currentEl) {
            currentEl.textContent = resolvedCurrent || i18n.t('system_info.version_unknown');
        }

        const latestEl = document.getElementById('version-check-latest');
        if (latestEl) {
            latestEl.textContent = resolvedLatest || '-';
        }

        const resultEl = document.getElementById('version-check-result');
        if (resultEl) {
            resultEl.textContent = resolvedMessage;
            resultEl.className = `version-check-result ${resolvedStatus}`.trim();
        }
    },

    resetVersionCheckStatus() {
        this.latestVersion = null;
        this.versionCheckMessage = i18n.t('system_info.version_check_idle');
        this.versionCheckStatus = 'muted';
        this.renderVersionCheckStatus({
            currentVersion: this.serverVersion,
            latestVersion: this.latestVersion,
            message: this.versionCheckMessage,
            status: this.versionCheckStatus
        });
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

        this.renderVersionCheckStatus({
            currentVersion: this.serverVersion,
            latestVersion: this.latestVersion,
            message: this.versionCheckMessage,
            status: this.versionCheckStatus
        });
    },

    // 清空版本信息（例如登出时）
    resetVersionInfo() {
        this.serverVersion = null;
        this.serverBuildDate = null;
        this.resetVersionCheckStatus();
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

    parseVersionSegments(version) {
        if (!version || typeof version !== 'string') return null;
        const cleaned = version.trim().replace(/^v/i, '');
        if (!cleaned) return null;
        const parts = cleaned.split(/[^0-9]+/).filter(Boolean).map(segment => {
            const parsed = parseInt(segment, 10);
            return Number.isFinite(parsed) ? parsed : 0;
        });
        return parts.length ? parts : null;
    },

    compareVersions(latestVersion, currentVersion) {
        const latestParts = this.parseVersionSegments(latestVersion);
        const currentParts = this.parseVersionSegments(currentVersion);
        if (!latestParts || !currentParts) {
            return null;
        }

        const length = Math.max(latestParts.length, currentParts.length);
        for (let i = 0; i < length; i++) {
            const latest = latestParts[i] || 0;
            const current = currentParts[i] || 0;
            if (latest > current) return 1;
            if (latest < current) return -1;
        }

        return 0;
    },

    async checkLatestVersion() {
        if (!this.isConnected) {
            const message = i18n.t('notification.connection_required');
            this.renderVersionCheckStatus({
                currentVersion: this.serverVersion,
                latestVersion: this.latestVersion,
                message,
                status: 'warning'
            });
            this.showNotification(message, 'error');
            return;
        }

        const button = document.getElementById('version-check-btn');
        const originalLabel = button ? button.innerHTML : '';

        if (button) {
            button.disabled = true;
            button.innerHTML = `<div class="loading"></div> ${i18n.t('system_info.version_checking')}`;
        }

        this.renderVersionCheckStatus({
            currentVersion: this.serverVersion,
            latestVersion: this.latestVersion,
            message: i18n.t('system_info.version_checking'),
            status: 'info'
        });

        try {
            const data = await this.makeRequest('/latest-version');
            const latestVersion = data?.['latest-version'] || data?.latest_version || '';
            const latestParts = this.parseVersionSegments(latestVersion);
            const currentParts = this.parseVersionSegments(this.serverVersion);
            const comparison = (latestParts && currentParts)
                ? this.compareVersions(latestVersion, this.serverVersion)
                : null;
            let messageKey = 'system_info.version_check_error';
            let statusClass = 'error';

            if (!latestParts) {
                messageKey = 'system_info.version_check_error';
            } else if (!currentParts) {
                messageKey = 'system_info.version_current_missing';
                statusClass = 'warning';
            } else if (comparison > 0) {
                messageKey = 'system_info.version_update_available';
                statusClass = 'warning';
            } else {
                messageKey = 'system_info.version_is_latest';
                statusClass = 'success';
            }

            const message = i18n.t(messageKey, latestVersion ? { version: latestVersion } : undefined);
            this.renderVersionCheckStatus({
                currentVersion: this.serverVersion,
                latestVersion,
                message,
                status: statusClass
            });

            if (latestVersion && comparison !== null) {
                const notifyKey = comparison > 0
                    ? 'system_info.version_update_available'
                    : 'system_info.version_is_latest';
                const notifyType = comparison > 0 ? 'warning' : 'success';
                this.showNotification(i18n.t(notifyKey, { version: latestVersion }), notifyType);
            }
        } catch (error) {
            const message = `${i18n.t('system_info.version_check_error')}: ${error.message}`;
            this.renderVersionCheckStatus({
                currentVersion: this.serverVersion,
                latestVersion: this.latestVersion,
                message,
                status: 'error'
            });
            this.showNotification(message, 'error');
        } finally {
            if (button) {
                button.disabled = false;
                button.innerHTML = originalLabel;
            }
        }
    },

    // API 请求方法
    async makeRequest(endpoint, options = {}) {
        try {
            return await this.apiClient.request(endpoint, options);
        } catch (error) {
            console.error('API请求失败:', error);
            throw error;
        }
    },

    buildAvailableModelsEndpoint() {
        return buildModelsEndpoint(this.apiBase || this.apiClient?.apiBase || '');
    },

    setAvailableModelsStatus(message = '', type = 'info') {
        const statusEl = document.getElementById('available-models-status');
        if (!statusEl) return;
        statusEl.textContent = message || '';
        statusEl.className = `available-models-status ${type}`;
    },

    renderAvailableModels(models = []) {
        const listEl = document.getElementById('available-models-list');
        if (!listEl) return;

        if (!models.length) {
            listEl.innerHTML = `
                <div class="available-models-empty">
                    <i class="fas fa-inbox"></i>
                    <span>${i18n.t('system_info.models_empty')}</span>
                </div>
            `;
            return;
        }

        const language = (i18n?.currentLanguage || '').toLowerCase();
        const otherLabel = language.startsWith('zh') ? '其他' : 'Other';
        const groups = classifyModels(models, { otherLabel });

        const groupHtml = groups.map(group => {
            const pills = group.items.map(model => {
                const name = this.escapeHtml(model.name || '');
                const alias = model.alias ? `<span class="model-alias">${this.escapeHtml(model.alias)}</span>` : '';
                const description = model.description ? this.escapeHtml(model.description) : '';
                const titleAttr = description ? ` title="${description}"` : '';
                return `
                    <span class="provider-model-tag available-model-tag"${titleAttr}>
                        <span class="model-name">${name}</span>
                        ${alias}
                    </span>
                `;
            }).join('');

            const label = this.escapeHtml(group.label || group.id || '');
            return `
                <div class="available-model-group">
                    <div class="available-model-group-header">
                        <div class="available-model-group-title">
                            <span class="available-model-group-label">${label}</span>
                            <span class="available-model-group-count">${group.items.length}</span>
                        </div>
                    </div>
                    <div class="available-model-group-body">
                        ${pills}
                    </div>
                </div>
            `;
        }).join('');

        listEl.innerHTML = groupHtml;
    },

    clearAvailableModels(messageKey = 'system_info.models_empty') {
        this.availableModels = [];
        this.availableModelApiKeysCache = null;
        const listEl = document.getElementById('available-models-list');
        if (listEl) {
            listEl.innerHTML = '';
        }
        this.setAvailableModelsStatus(i18n.t(messageKey), 'warning');
    },

    async resolveApiKeysForModels({ config = null, forceRefresh = false } = {}) {
        if (!forceRefresh && Array.isArray(this.availableModelApiKeysCache) && this.availableModelApiKeysCache.length) {
            return this.availableModelApiKeysCache;
        }

        const configKeys = normalizeApiKeyList(config?.['api-keys'] || this.configCache?.['api-keys']);
        if (configKeys.length) {
            this.availableModelApiKeysCache = configKeys;
            return configKeys;
        }

        try {
            const data = await this.makeRequest('/api-keys');
            const keys = normalizeApiKeyList(data?.['api-keys']);
            if (keys.length) {
                this.availableModelApiKeysCache = keys;
            }
            return keys;
        } catch (error) {
            console.warn('自动获取 API Key 失败:', error);
            return [];
        }
    },

    async loadAvailableModels({ config = null, forceRefresh = false } = {}) {
        const listEl = document.getElementById('available-models-list');
        const statusEl = document.getElementById('available-models-status');

        if (!listEl || !statusEl) {
            return;
        }

        if (!this.isConnected) {
            this.setAvailableModelsStatus(i18n.t('common.disconnected'), 'warning');
            listEl.innerHTML = '';
            return;
        }

        const endpoint = this.buildAvailableModelsEndpoint();
        if (!endpoint) {
            this.setAvailableModelsStatus(i18n.t('system_info.models_error'), 'error');
            listEl.innerHTML = `
                <div class="available-models-empty">
                    <i class="fas fa-exclamation-circle"></i>
                    <span>${i18n.t('login.error_invalid')}</span>
                </div>
            `;
            return;
        }

        this.availableModelsLoading = true;
        this.setAvailableModelsStatus(i18n.t('system_info.models_loading'), 'info');
        listEl.innerHTML = '<div class="available-models-placeholder"><i class="fas fa-spinner fa-spin"></i></div>';

        try {
            const headers = {};
            const keys = await this.resolveApiKeysForModels({ config, forceRefresh });
            if (keys.length) {
                headers.Authorization = `Bearer ${keys[0]}`;
            }

            const response = await fetch(endpoint, { headers });
            if (!response.ok) {
                throw new Error(`${response.status} ${response.statusText}`);
            }

            let data;
            try {
                data = await response.json();
            } catch (err) {
                const text = await response.text();
                throw new Error(text || err.message || 'Invalid JSON');
            }

            const models = normalizeModelList(data, { dedupe: true });
            this.availableModels = models;

            if (!models.length) {
                this.setAvailableModelsStatus(i18n.t('system_info.models_empty'), 'warning');
                this.renderAvailableModels([]);
                return;
            }

            this.setAvailableModelsStatus(i18n.t('system_info.models_count', { count: models.length }), 'success');
            this.renderAvailableModels(models);
        } catch (error) {
            console.error('加载可用模型失败:', error);
            this.availableModels = [];
            this.setAvailableModelsStatus(`${i18n.t('system_info.models_error')}: ${error.message}`, 'error');
            listEl.innerHTML = `
                <div class="available-models-empty">
                    <i class="fas fa-exclamation-circle"></i>
                    <span>${this.escapeHtml(error.message || '')}</span>
                </div>
            `;
        } finally {
            this.availableModelsLoading = false;
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
            this.setAvailableModelsStatus(i18n.t('common.disconnected'), 'warning');
            const modelsList = document.getElementById('available-models-list');
            if (modelsList) {
                modelsList.innerHTML = '';
            }
        }

        lastUpdate.textContent = new Date().toLocaleString('zh-CN');

        if (this.lastEditorConnectionState !== this.isConnected) {
            this.updateConfigEditorAvailability();
        }

        // 更新连接信息显示
        this.updateConnectionInfo();

        if (this.events && typeof this.events.emit === 'function') {
            const shouldEmit = this.lastConnectionStatusEmitted !== this.isConnected;
            if (shouldEmit) {
                this.events.emit('connection:status-changed', {
                    isConnected: this.isConnected,
                    apiBase: this.apiBase
                });
                this.lastConnectionStatusEmitted = this.isConnected;
            }
        }
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
        return this.configService.isCacheValid(section);
    },

    // 获取配置（优先使用缓存，支持按段获取）
    async getConfig(section = null, forceRefresh = false) {
        try {
            const config = await this.configService.getConfig(section, forceRefresh);
            this.configCache = this.configService.cache;
            this.cacheTimestamps = this.configService.cacheTimestamps;
            this.updateConnectionStatus();
            return config;
        } catch (error) {
            console.error('获取配置失败:', error);
            throw error;
        }
    },

    // 清除缓存（支持清除特定配置段）
    clearCache(section = null) {
        this.configService.clearCache(section);
        this.configCache = this.configService.cache;
        this.cacheTimestamps = this.configService.cacheTimestamps;
        if (!section || section === 'api-keys') {
            this.availableModelApiKeysCache = null;
        }
        if (!section) {
            this.configYamlCache = '';
            this.availableModels = [];
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

            await this.loadAvailableModels({ config, forceRefresh });

            if (this.events && typeof this.events.emit === 'function') {
                this.events.emit('data:config-loaded', {
                    config,
                    usageData,
                    keyStats,
                    forceRefresh
                });
            }

            console.log('配置加载完成，使用缓存:', !forceRefresh && this.isCacheValid());
        } catch (error) {
            console.error('加载配置失败:', error);
        }
    },

    // 从配置对象更新所有设置 —— 委派给 settings 模块，保持兼容旧调用
    async updateSettingsFromConfig(config, keyStats = null) {
        if (typeof this.applySettingsFromConfig === 'function') {
            return this.applySettingsFromConfig(config, keyStats);
        }
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
