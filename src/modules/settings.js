// 设置与开关相关方法模块
// 注意：这些函数依赖于在 CLIProxyManager 实例上提供的 makeRequest/clearCache/showNotification 等基础能力

export async function updateDebug(enabled) {
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

export async function updateProxyUrl() {
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

export async function clearProxyUrl() {
    try {
        await this.makeRequest('/proxy-url', { method: 'DELETE' });
        document.getElementById('proxy-url').value = '';
        this.clearCache(); // 清除缓存
        this.showNotification(i18n.t('notification.proxy_cleared'), 'success');
    } catch (error) {
        this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
    }
}

export async function updateRequestRetry() {
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

export async function loadDebugSettings() {
    try {
        const config = await this.getConfig();
        if (config.debug !== undefined) {
            document.getElementById('debug-toggle').checked = config.debug;
        }
    } catch (error) {
        console.error('加载调试设置失败:', error);
    }
}

export async function loadProxySettings() {
    try {
        const config = await this.getConfig();
        if (config['proxy-url'] !== undefined) {
            document.getElementById('proxy-url').value = config['proxy-url'] || '';
        }
    } catch (error) {
        console.error('加载代理设置失败:', error);
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
    updateSwitchPreviewModel
};
