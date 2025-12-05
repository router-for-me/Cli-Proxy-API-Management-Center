import { secureStorage } from '../utils/secure-storage.js';

export const loginModule = {
    async checkLoginStatus() {
        // 将旧的明文缓存迁移为加密格式
        secureStorage.migratePlaintextKeys(['apiBase', 'apiUrl', 'managementKey']);

        const savedBase = secureStorage.getItem('apiBase');
        const savedKey = secureStorage.getItem('managementKey');
        const wasLoggedIn = localStorage.getItem('isLoggedIn') === 'true';

        if (savedBase && savedKey && wasLoggedIn) {
            try {
                console.log(i18n.t('auto_login.title'));
                this.showAutoLoginLoading();
                await this.attemptAutoLogin(savedBase, savedKey);
                return;
            } catch (error) {
                console.log(`${i18n.t('notification.login_failed')}: ${error.message}`);
                localStorage.removeItem('isLoggedIn');
                this.hideAutoLoginLoading();
            }
        }

        this.showLoginPage();
        this.loadLoginSettings();
    },

    showAutoLoginLoading() {
        document.getElementById('auto-login-loading').style.display = 'flex';
        document.getElementById('login-page').style.display = 'none';
        document.getElementById('main-page').style.display = 'none';
    },

    hideAutoLoginLoading() {
        document.getElementById('auto-login-loading').style.display = 'none';
    },

    async attemptAutoLogin(apiBase, managementKey) {
        try {
            this.setApiBase(apiBase);
            this.setManagementKey(managementKey);

            const savedProxy = localStorage.getItem('proxyUrl');
            if (savedProxy) {
                // 代理设置会在后续的API请求中自动使用
            }

            await this.testConnection();

            this.isLoggedIn = true;
            this.hideAutoLoginLoading();
            this.showMainPage();

            console.log(i18n.t('auto_login.title'));
            return true;
        } catch (error) {
            console.error('自动登录失败:', error);
            this.isLoggedIn = false;
            this.isConnected = false;
            throw error;
        }
    },

    showLoginPage() {
        document.getElementById('login-page').style.display = 'flex';
        document.getElementById('main-page').style.display = 'none';
        this.isLoggedIn = false;
        this.resetBrandTitleState();
        this.updateLoginConnectionInfo();
    },

    showMainPage() {
        document.getElementById('login-page').style.display = 'none';
        document.getElementById('main-page').style.display = 'block';
        this.isLoggedIn = true;
        this.updateConnectionInfo();
        this.startBrandCollapseCycle();
    },

    async login(apiBase, managementKey) {
        try {
            this.setApiBase(apiBase);
            this.setManagementKey(managementKey);

            await this.testConnection();

            this.isLoggedIn = true;
            localStorage.setItem('isLoggedIn', 'true');

            this.showMainPage();
            return true;
        } catch (error) {
            console.error('登录失败:', error);
            throw error;
        }
    },

    logout() {
        this.isLoggedIn = false;
        this.isConnected = false;
        this.clearCache();
        this.stopStatusUpdateTimer();
        this.resetVersionInfo();
        this.setManagementKey('', { persist: false });
        this.oauthExcludedModels = {};
        this._oauthExcludedLoading = false;
        if (typeof this.renderOauthExcludedModels === 'function') {
            this.renderOauthExcludedModels('all');
        }
        if (typeof this.clearAvailableModels === 'function') {
            this.clearAvailableModels('common.disconnected');
        }

        localStorage.removeItem('isLoggedIn');
        secureStorage.removeItem('managementKey');

        this.showLoginPage();
    },

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
                submitBtn.innerHTML = `<div class=\"loading\"></div> ${i18n.t('login.submitting')}`;
                submitBtn.disabled = true;
            }
            this.hideLoginError();

            this.setManagementKey(managementKey);

            await this.login(this.apiBase, this.managementKey);
        } catch (error) {
            this.showLoginError(`${i18n.t('login.error_title')}: ${error.message}`);
        } finally {
            if (submitBtn) {
                submitBtn.innerHTML = originalText;
                submitBtn.disabled = false;
            }
        }
    },

    toggleLoginKeyVisibility(button) {
        const inputGroup = button.closest('.input-group');
        const keyInput = inputGroup.querySelector('input[type=\"password\"], input[type=\"text\"]');

        if (keyInput.type === 'password') {
            keyInput.type = 'text';
            button.innerHTML = '<i class=\"fas fa-eye-slash\"></i>';
        } else {
            keyInput.type = 'password';
            button.innerHTML = '<i class=\"fas fa-eye\"></i>';
        }
    },

    showLoginError(message) {
        const errorDiv = document.getElementById('login-error');
        const errorMessage = document.getElementById('login-error-message');

        errorMessage.textContent = message;
        errorDiv.style.display = 'flex';
    },

    hideLoginError() {
        const errorDiv = document.getElementById('login-error');
        errorDiv.style.display = 'none';
    },

    updateConnectionInfo() {
        const apiUrlElement = document.getElementById('display-api-url');
        const statusElement = document.getElementById('display-connection-status');

        if (apiUrlElement) {
            apiUrlElement.textContent = this.apiBase || '-';
        }

        if (statusElement) {
            let statusHtml = '';
            if (this.isConnected) {
                statusHtml = `<span class=\"status-indicator connected\"><i class=\"fas fa-circle\"></i> ${i18n.t('common.connected')}</span>`;
            } else {
                statusHtml = `<span class=\"status-indicator disconnected\"><i class=\"fas fa-circle\"></i> ${i18n.t('common.disconnected')}</span>`;
            }
            statusElement.innerHTML = statusHtml;
        }
    },

    loadLoginSettings() {
        const savedBase = secureStorage.getItem('apiBase');
        const savedKey = secureStorage.getItem('managementKey');
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
        this.setManagementKey(savedKey || '', { persist: false });

        this.setupLoginAutoSave();
    },

    setupLoginAutoSave() {
        const loginKeyInput = document.getElementById('login-management-key');
        const apiBaseInput = document.getElementById('login-api-base');
        const resetButton = document.getElementById('login-reset-api-base');

        const saveKey = (val) => {
            const trimmed = val.trim();
            if (trimmed) {
                this.setManagementKey(trimmed);
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

        this.updateLoginConnectionInfo();
    },

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
};
