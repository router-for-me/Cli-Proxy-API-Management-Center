export const apiKeysModule = {
    // 加载API密钥
    async loadApiKeys() {
        try {
            const data = await this.makeRequest('/api-keys');
            const apiKeysValue = data?.['api-keys'] || [];
            const keys = Array.isArray(apiKeysValue) ? apiKeysValue : [];
            this.renderApiKeys(keys);
        } catch (error) {
            console.error('加载API密钥失败:', error);
        }
    },

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
            const keyArgument = encodeURIComponent(normalizedKey);
            return `
            <div class="key-item">
                <div class="item-content">
                    <div class="item-title">${i18n.t('api_keys.item_title')} #${index + 1}</div>
                    <div class="item-value">${maskedDisplay}</div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary" data-action="edit-api-key" data-index="${index}" data-key="${keyArgument}">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" data-action="delete-api-key" data-index="${index}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
        }).join('');

        this.bindApiKeyListEvents(container);
    },

    // 注意: escapeHtml, maskApiKey, normalizeArrayResponse
    // 现在由 app.js 通过工具模块提供，通过 this 访问

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
    },

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
    },

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
    },

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
    },

    populateApiKeyEntryFields(wrapperId, entries = []) {
        const wrapper = document.getElementById(wrapperId);
        if (!wrapper) return;
        wrapper.innerHTML = '';

        if (!Array.isArray(entries) || entries.length === 0) {
            this.addApiKeyEntryField(wrapperId);
            return;
        }

        entries.forEach(entry => this.addApiKeyEntryField(wrapperId, entry));
    },

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
    },

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
    },

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
    },

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
    },

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
    },

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

            this.clearCache('api-keys'); // 仅清除 api-keys 段缓存
            this.closeModal();
            this.loadApiKeys();
            this.showNotification(i18n.t('notification.api_key_added'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.add_failed')}: ${error.message}`, 'error');
        }
    },

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
    },

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

            this.clearCache('api-keys'); // 仅清除 api-keys 段缓存
            this.closeModal();
            this.loadApiKeys();
            this.showNotification(i18n.t('notification.api_key_updated'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.update_failed')}: ${error.message}`, 'error');
        }
    },

    // 删除API密钥
    async deleteApiKey(index) {
        if (!confirm(i18n.t('api_keys.delete_confirm'))) return;

        try {
            await this.makeRequest(`/api-keys?index=${index}`, { method: 'DELETE' });
            this.clearCache('api-keys'); // 仅清除 api-keys 段缓存
            this.loadApiKeys();
            this.showNotification(i18n.t('notification.api_key_deleted'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.delete_failed')}: ${error.message}`, 'error');
        }
    },

    bindApiKeyListEvents(container = null) {
        if (this.apiKeyListEventsBound) {
            return;
        }
        const listContainer = container || document.getElementById('api-keys-list');
        if (!listContainer) return;

        listContainer.addEventListener('click', (event) => {
            const button = event.target.closest('[data-action][data-index]');
            if (!button || !listContainer.contains(button)) return;

            const action = button.dataset.action;
            const index = Number(button.dataset.index);
            if (!Number.isFinite(index)) return;

            switch (action) {
                case 'edit-api-key': {
                    const rawKey = button.dataset.key || '';
                    let decodedKey = '';
                    try {
                        decodedKey = decodeURIComponent(rawKey);
                    } catch (e) {
                        decodedKey = rawKey;
                    }
                    this.editApiKey(index, decodedKey);
                    break;
                }
                case 'delete-api-key':
                    this.deleteApiKey(index);
                    break;
                default:
                    break;
            }
        });

        this.apiKeyListEventsBound = true;
    }
};
