// 设置与开关相关方法模块
// 注意：这些函数依赖于在 CLIProxyManager 实例上提供的 makeRequest/clearCache/showNotification/errorHandler 等基础能力

export async function updateDebug(enabled) {
    const previousValue = !enabled;
    try {
        await this.makeRequest('/debug', {
            method: 'PUT',
            body: JSON.stringify({ value: enabled })
        });
        this.clearCache('debug'); // 仅清除 debug 配置段的缓存
        this.showNotification(i18n.t('notification.debug_updated'), 'success');
    } catch (error) {
        this.errorHandler.handleUpdateError(
            error,
            i18n.t('settings.debug_mode') || '调试模式',
            () => document.getElementById('debug-toggle').checked = previousValue
        );
    }
}

export async function updateProxyUrl() {
    const proxyUrl = document.getElementById('proxy-url').value.trim();
    const previousValue = document.getElementById('proxy-url').getAttribute('data-previous-value') || '';

    try {
        await this.makeRequest('/proxy-url', {
            method: 'PUT',
            body: JSON.stringify({ value: proxyUrl })
        });
        this.clearCache('proxy-url'); // 仅清除 proxy-url 配置段的缓存
        document.getElementById('proxy-url').setAttribute('data-previous-value', proxyUrl);
        this.showNotification(i18n.t('notification.proxy_updated'), 'success');
    } catch (error) {
        this.errorHandler.handleUpdateError(
            error,
            i18n.t('settings.proxy_url') || '代理设置',
            () => document.getElementById('proxy-url').value = previousValue
        );
    }
}

export async function clearProxyUrl() {
    const previousValue = document.getElementById('proxy-url').value;

    try {
        await this.makeRequest('/proxy-url', { method: 'DELETE' });
        document.getElementById('proxy-url').value = '';
        document.getElementById('proxy-url').setAttribute('data-previous-value', '');
        this.clearCache('proxy-url'); // 仅清除 proxy-url 配置段的缓存
        this.showNotification(i18n.t('notification.proxy_cleared'), 'success');
    } catch (error) {
        this.errorHandler.handleUpdateError(
            error,
            i18n.t('settings.proxy_url') || '代理设置',
            () => document.getElementById('proxy-url').value = previousValue
        );
    }
}

export async function updateRequestRetry() {
    const retryInput = document.getElementById('request-retry');
    const retryCount = parseInt(retryInput.value);
    const previousValue = retryInput.getAttribute('data-previous-value') || '0';

    try {
        await this.makeRequest('/request-retry', {
            method: 'PUT',
            body: JSON.stringify({ value: retryCount })
        });
        this.clearCache('request-retry'); // 仅清除 request-retry 配置段的缓存
        retryInput.setAttribute('data-previous-value', retryCount.toString());
        this.showNotification(i18n.t('notification.retry_updated'), 'success');
    } catch (error) {
        this.errorHandler.handleUpdateError(
            error,
            i18n.t('settings.request_retry') || '重试设置',
            () => retryInput.value = previousValue
        );
    }
}

export async function loadDebugSettings() {
    try {
        const debugValue = await this.getConfig('debug'); // 仅获取 debug 配置段
        if (debugValue !== undefined) {
            document.getElementById('debug-toggle').checked = debugValue;
        }
    } catch (error) {
        this.errorHandler.handleLoadError(error, i18n.t('settings.debug_mode') || '调试设置');
    }
}

export async function loadProxySettings() {
    try {
        const proxyUrl = await this.getConfig('proxy-url'); // 仅获取 proxy-url 配置段
        const proxyInput = document.getElementById('proxy-url');
        if (proxyUrl !== undefined) {
            proxyInput.value = proxyUrl || '';
            proxyInput.setAttribute('data-previous-value', proxyUrl || '');
        }
    } catch (error) {
        this.errorHandler.handleLoadError(error, i18n.t('settings.proxy_settings') || '代理设置');
    }
}

export async function loadRetrySettings() {
    try {
        const config = await this.getConfig();
        if (config['request-retry'] !== undefined) {
            document.getElementById('request-retry').value = config['request-retry'];
        }
    } catch (error) {
        console.error('加载重试设置失败:', error);
    }
}

export async function loadQuotaSettings() {
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

export async function loadUsageStatisticsSettings() {
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

export async function loadRequestLogSetting() {
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

export async function loadWsAuthSetting() {
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

export async function updateUsageStatisticsEnabled(enabled) {
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

export async function updateRequestLog(enabled) {
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

export async function updateWsAuth(enabled) {
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

export async function updateLoggingToFile(enabled) {
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

export async function updateSwitchProject(enabled) {
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

export async function updateSwitchPreviewModel(enabled) {
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

// 统一应用配置到界面，供 connection 模块或事件总线调用
export async function applySettingsFromConfig(config = {}, keyStats = null) {
    if (!config || typeof config !== 'object') {
        return;
    }

    // 调试设置
    if (config.debug !== undefined) {
        const toggle = document.getElementById('debug-toggle');
        if (toggle) {
            toggle.checked = config.debug;
        }
    }

    // 代理设置
    if (config['proxy-url'] !== undefined) {
        const proxyInput = document.getElementById('proxy-url');
        if (proxyInput) {
            proxyInput.value = config['proxy-url'] || '';
        }
    }

    // 请求重试设置
    if (config['request-retry'] !== undefined) {
        const retryInput = document.getElementById('request-retry');
        if (retryInput) {
            retryInput.value = config['request-retry'];
        }
    }

    // 配额超出行为
    if (config['quota-exceeded']) {
        if (config['quota-exceeded']['switch-project'] !== undefined) {
            const toggle = document.getElementById('switch-project-toggle');
            if (toggle) {
                toggle.checked = config['quota-exceeded']['switch-project'];
            }
        }
        if (config['quota-exceeded']['switch-preview-model'] !== undefined) {
            const toggle = document.getElementById('switch-preview-model-toggle');
            if (toggle) {
                toggle.checked = config['quota-exceeded']['switch-preview-model'];
            }
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
        if (typeof this.toggleLogsNavItem === 'function') {
            this.toggleLogsNavItem(config['logging-to-file']);
        }
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
    if (config['api-keys'] && typeof this.renderApiKeys === 'function') {
        this.renderApiKeys(config['api-keys']);
    }

    // Gemini keys
    if (typeof this.renderGeminiKeys === 'function') {
        await this.renderGeminiKeys(this.getGeminiKeysFromConfig(config), keyStats);
    }

    // Codex 密钥
    if (typeof this.renderCodexKeys === 'function') {
        await this.renderCodexKeys(Array.isArray(config['codex-api-key']) ? config['codex-api-key'] : [], keyStats);
    }

    // Claude 密钥
    if (typeof this.renderClaudeKeys === 'function') {
        await this.renderClaudeKeys(Array.isArray(config['claude-api-key']) ? config['claude-api-key'] : [], keyStats);
    }

    // OpenAI 兼容提供商
    if (typeof this.renderOpenAIProviders === 'function') {
        await this.renderOpenAIProviders(Array.isArray(config['openai-compatibility']) ? config['openai-compatibility'] : [], keyStats);
    }
}

// 设置模块订阅全局事件，减少与连接层耦合
export function registerSettingsListeners() {
    if (!this.events || typeof this.events.on !== 'function') {
        return;
    }
    this.events.on('data:config-loaded', (event) => {
        const detail = event?.detail || {};
        this.applySettingsFromConfig(detail.config || {}, detail.keyStats || null);
    });
}

export const settingsModule = {
    updateDebug,
    updateProxyUrl,
    clearProxyUrl,
    updateRequestRetry,
    loadDebugSettings,
    loadProxySettings,
    loadRetrySettings,
    loadQuotaSettings,
    loadUsageStatisticsSettings,
    loadRequestLogSetting,
    loadWsAuthSetting,
    updateUsageStatisticsEnabled,
    updateRequestLog,
    updateWsAuth,
    updateLoggingToFile,
    updateSwitchProject,
    updateSwitchPreviewModel,
    applySettingsFromConfig,
    registerSettingsListeners
};
