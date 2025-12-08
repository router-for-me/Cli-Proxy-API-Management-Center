export const oauthModule = {
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
    },

    // 从 URL 中提取 state 参数
    extractStateFromUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.searchParams.get('state');
        } catch (error) {
            console.error('Failed to extract state from URL:', error);
            return null;
        }
    },

    // 打开 Codex 授权链接
    openCodexLink() {
        const urlInput = document.getElementById('codex-oauth-url');
        if (urlInput && urlInput.value) {
            window.open(urlInput.value, '_blank');
        }
    },

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
    },

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
    },

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
    },

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
    },

    // 打开 Anthropic 授权链接
    openAnthropicLink() {
        const urlInput = document.getElementById('anthropic-oauth-url');
        if (urlInput && urlInput.value) {
            window.open(urlInput.value, '_blank');
        }
    },

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
    },

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
    },

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
    },

    // ===== Antigravity OAuth 相关方法 =====

    // 开始 Antigravity OAuth 流程
    async startAntigravityOAuth() {
        try {
            const response = await this.makeRequest('/antigravity-auth-url?is_webui=1');
            const authUrl = response.url;
            const state = response.state || this.extractStateFromUrl(authUrl);

            // 显示授权链接
            const urlInput = document.getElementById('antigravity-oauth-url');
            const content = document.getElementById('antigravity-oauth-content');
            const status = document.getElementById('antigravity-oauth-status');

            if (urlInput) {
                urlInput.value = authUrl;
            }
            if (content) {
                content.style.display = 'block';
            }
            if (status) {
                status.textContent = i18n.t('auth_login.antigravity_oauth_status_waiting');
                status.style.color = 'var(--warning-text)';
            }

            // 开始轮询认证状态
            this.startAntigravityOAuthPolling(state);

        } catch (error) {
            this.showNotification(`${i18n.t('auth_login.antigravity_oauth_start_error')} ${error.message}`, 'error');
        }
    },

    // 打开 Antigravity 授权链接
    openAntigravityLink() {
        const urlInput = document.getElementById('antigravity-oauth-url');
        if (urlInput && urlInput.value) {
            window.open(urlInput.value, '_blank');
        }
    },

    // 复制 Antigravity 授权链接
    async copyAntigravityLink() {
        const urlInput = document.getElementById('antigravity-oauth-url');
        if (urlInput && urlInput.value) {
            try {
                await navigator.clipboard.writeText(urlInput.value);
                this.showNotification(i18n.t('notification.link_copied'), 'success');
            } catch (error) {
                urlInput.select();
                document.execCommand('copy');
                this.showNotification(i18n.t('notification.link_copied'), 'success');
            }
        }
    },

    // 开始轮询 Antigravity OAuth 状态
    startAntigravityOAuthPolling(state) {
        if (!state) {
            this.showNotification(i18n.t('auth_login.missing_state'), 'error');
            return;
        }

        const pollInterval = setInterval(async () => {
            try {
                const response = await this.makeRequest(`/get-auth-status?state=${encodeURIComponent(state)}`);
                const status = response.status;
                const statusElement = document.getElementById('antigravity-oauth-status');

                if (status === 'ok') {
                    clearInterval(pollInterval);
                    this.resetAntigravityOAuthUI();
                    this.showNotification(i18n.t('auth_login.antigravity_oauth_status_success'), 'success');
                    this.loadAuthFiles();
                } else if (status === 'error') {
                    clearInterval(pollInterval);
                    const errorMessage = response.error || 'Unknown error';
                    if (statusElement) {
                        statusElement.textContent = `${i18n.t('auth_login.antigravity_oauth_status_error')} ${errorMessage}`;
                        statusElement.style.color = 'var(--error-text)';
                    }
                    this.showNotification(`${i18n.t('auth_login.antigravity_oauth_status_error')} ${errorMessage}`, 'error');
                    setTimeout(() => {
                        this.resetAntigravityOAuthUI();
                    }, 3000);
                } else if (status === 'wait') {
                    if (statusElement) {
                        statusElement.textContent = i18n.t('auth_login.antigravity_oauth_status_waiting');
                        statusElement.style.color = 'var(--warning-text)';
                    }
                }
            } catch (error) {
                clearInterval(pollInterval);
                const statusElement = document.getElementById('antigravity-oauth-status');
                if (statusElement) {
                    statusElement.textContent = `${i18n.t('auth_login.antigravity_oauth_polling_error')} ${error.message}`;
                    statusElement.style.color = 'var(--error-text)';
                }
                this.showNotification(`${i18n.t('auth_login.antigravity_oauth_polling_error')} ${error.message}`, 'error');
                setTimeout(() => {
                    this.resetAntigravityOAuthUI();
                }, 3000);
            }
        }, 2000);

        setTimeout(() => {
            clearInterval(pollInterval);
        }, 5 * 60 * 1000);
    },

    // 重置 Antigravity OAuth UI 到初始状态
    resetAntigravityOAuthUI() {
        const urlInput = document.getElementById('antigravity-oauth-url');
        const content = document.getElementById('antigravity-oauth-content');
        const status = document.getElementById('antigravity-oauth-status');

        if (urlInput) {
            urlInput.value = '';
        }
        if (content) {
            content.style.display = 'none';
        }
        if (status) {
            status.textContent = '';
            status.style.color = '';
            status.className = '';
        }
    },

    // ===== Gemini CLI OAuth 相关方法 =====

    // 开始 Gemini CLI OAuth 流程
    async startGeminiCliOAuth() {
        try {
            const response = await this.makeRequest('/gemini-cli-auth-url?is_webui=1');
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
    },

    // 打开 Gemini CLI 授权链接
    openGeminiCliLink() {
        const urlInput = document.getElementById('gemini-cli-oauth-url');
        if (urlInput && urlInput.value) {
            window.open(urlInput.value, '_blank');
        }
    },

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
    },

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
    },

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
    },

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
            this.startQwenOAuthPolling(state);

        } catch (error) {
            this.showNotification(`${i18n.t('auth_login.qwen_oauth_start_error')} ${error.message}`, 'error');
        }
    },

    // 打开 Qwen 授权链接
    openQwenLink() {
        const urlInput = document.getElementById('qwen-oauth-url');
        if (urlInput && urlInput.value) {
            window.open(urlInput.value, '_blank');
        }
    },

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
    },

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
    },

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
    },

    // ===== iFlow OAuth 相关方法 =====

    // 开始 iFlow OAuth 流程
    async startIflowOAuth() {
        if (!this.isIflowOAuthAllowed()) {
            const statusEl = document.getElementById('iflow-oauth-status');
            if (statusEl) {
                statusEl.textContent = i18n.t('auth_login.iflow_oauth_local_only');
                statusEl.style.display = 'block';
                statusEl.style.color = 'var(--warning-text)';
            }
            this.showNotification(i18n.t('auth_login.iflow_oauth_local_only'), 'error');
            return;
        }

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
    },

    // 打开 iFlow 授权链接
    openIflowLink() {
        const urlInput = document.getElementById('iflow-oauth-url');
        if (urlInput && urlInput.value) {
            window.open(urlInput.value, '_blank');
        }
    },

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
    },

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
    },

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
    },

    // 提交 iFlow Cookie 登录
    async submitIflowCookieLogin() {
        const cookieInput = document.getElementById('iflow-cookie-input');
        const statusEl = document.getElementById('iflow-cookie-status');
        const submitBtn = document.getElementById('iflow-cookie-submit');
        const cookieValue = cookieInput ? cookieInput.value.trim() : '';

        this.renderIflowCookieResult(null);

        if (!cookieValue) {
            this.showNotification(i18n.t('auth_login.iflow_cookie_required'), 'error');
            if (statusEl) {
                statusEl.textContent = `${i18n.t('auth_login.iflow_cookie_status_error')} ${i18n.t('auth_login.iflow_cookie_required')}`;
                statusEl.style.color = 'var(--error-text)';
            }
            return;
        }

        try {
            if (submitBtn) {
                submitBtn.disabled = true;
            }
            if (statusEl) {
                statusEl.textContent = i18n.t('auth_login.iflow_oauth_status_waiting');
                statusEl.style.color = 'var(--warning-text)';
            }

            const response = await this.makeRequest('/iflow-auth-url', {
                method: 'POST',
                body: JSON.stringify({ cookie: cookieValue })
            });

            this.renderIflowCookieResult(response);
            if (statusEl) {
                statusEl.textContent = i18n.t('auth_login.iflow_cookie_status_success');
                statusEl.style.color = 'var(--success-text)';
            }
            if (cookieInput) {
                cookieInput.value = '';
            }

            this.showNotification(i18n.t('auth_login.iflow_cookie_status_success'), 'success');
            this.loadAuthFiles();
        } catch (error) {
            if (statusEl) {
                statusEl.textContent = `${i18n.t('auth_login.iflow_cookie_status_error')} ${error.message}`;
                statusEl.style.color = 'var(--error-text)';
            }
            this.showNotification(`${i18n.t('auth_login.iflow_cookie_start_error')} ${error.message}`, 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
            }
        }
    },

    renderIflowCookieResult(result = null) {
        const container = document.getElementById('iflow-cookie-result');
        const emailEl = document.getElementById('iflow-cookie-result-email');
        const expiredEl = document.getElementById('iflow-cookie-result-expired');
        const pathEl = document.getElementById('iflow-cookie-result-path');
        const typeEl = document.getElementById('iflow-cookie-result-type');

        if (!container || !emailEl || !expiredEl || !pathEl || !typeEl) {
            return;
        }

        if (!result) {
            container.style.display = 'none';
            emailEl.textContent = '-';
            expiredEl.textContent = '-';
            pathEl.textContent = '-';
            typeEl.textContent = '-';
            return;
        }

        emailEl.textContent = result.email || '-';
        expiredEl.textContent = result.expired || '-';
        pathEl.textContent = result.saved_path || result.savedPath || result.path || '-';
        typeEl.textContent = result.type || '-';
        container.style.display = 'block';
    }
};
