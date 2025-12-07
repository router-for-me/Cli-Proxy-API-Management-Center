// AI 提供商配置相关方法模块
// 这些函数依赖于 CLIProxyManager 实例上的 makeRequest/getConfig/clearCache/showNotification 等能力，
// 以及 apiKeysModule 中的工具方法（如 applyHeadersToConfig/renderHeaderBadges）。

import { normalizeModelList } from '../utils/models.js';

const getStatsBySource = (stats) => {
    if (stats && typeof stats === 'object' && stats.bySource) {
        return stats.bySource;
    }
    return stats || {};
};

const buildModelEndpoint = (baseUrl) => {
    if (!baseUrl) return '';
    const trimmed = String(baseUrl).trim().replace(/\/+$/g, '');
    if (!trimmed) return '';

    // 如果 base 已以 /v1 结尾，直接拼 /models；否则拼 /v1/models，避免丢失中间路径
    if (trimmed.endsWith('/v1')) {
        return `${trimmed}/models`;
    }
    return `${trimmed}/v1/models`;
};

const buildChatCompletionsEndpoint = (baseUrl) => {
    if (!baseUrl) return '';
    const trimmed = String(baseUrl).trim().replace(/\/+$/g, '');
    if (!trimmed) return '';
    if (trimmed.endsWith('/chat/completions')) {
        return trimmed;
    }
    if (trimmed.endsWith('/v1')) {
        return `${trimmed}/chat/completions`;
    }
    return `${trimmed}/v1/chat/completions`;
};

const normalizeExcludedModels = (input) => {
    const rawList = Array.isArray(input)
        ? input
        : (typeof input === 'string' ? input.split(/[\n,]/) : []);
    const seen = new Set();
    const normalized = [];

    rawList.forEach(item => {
        if (item === undefined || item === null) {
            return;
        }
        const trimmed = String(item).trim();
        if (!trimmed) return;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        normalized.push(trimmed);
    });

    return normalized;
};

export function collectExcludedModels(textareaId) {
    const textarea = document.getElementById(textareaId);
    if (!textarea) return [];
    return normalizeExcludedModels(textarea.value);
}

export function setExcludedModelsValue(textareaId, models = []) {
    const textarea = document.getElementById(textareaId);
    if (!textarea) return;
    textarea.value = normalizeExcludedModels(models).join('\n');
}

export function renderExcludedModelBadges(models) {
    const normalized = normalizeExcludedModels(models);
    if (!normalized.length) {
        return '';
    }
    const badges = normalized.map(model => `
        <span class="provider-model-tag excluded-model-tag">
            <span class="model-name">${this.escapeHtml(model)}</span>
        </span>
    `).join('');

    return `
            <div class="item-subtitle">${i18n.t('ai_providers.excluded_models_count', { count: normalized.length })}</div>
            <div class="provider-models excluded-models">
                ${badges}
            </div>
        `;
}

export async function loadGeminiKeys() {
    try {
        const config = await this.getConfig();
        const keys = this.getGeminiKeysFromConfig(config);
        await this.renderGeminiKeys(keys);
    } catch (error) {
        console.error('加载Gemini密钥失败:', error);
    }
}

export function getGeminiKeysFromConfig(config) {
    if (!config) {
        return [];
    }

    const geminiKeys = Array.isArray(config['gemini-api-key']) ? config['gemini-api-key'] : [];
    return geminiKeys;
}

export async function renderGeminiKeys(keys, keyStats = null) {
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

    if (!keyStats) {
        keyStats = await this.getKeyStats();
    }
    const statsBySource = getStatsBySource(keyStats);

    container.innerHTML = normalizedList.map((config, index) => {
        const rawKey = config['api-key'] || '';
        const masked = this.maskApiKey(rawKey || '');
        const maskedDisplay = this.escapeHtml(masked);
        const usageStats = (rawKey && (statsBySource[rawKey] || statsBySource[masked])) || { success: 0, failure: 0 };
        const configJson = JSON.stringify(config).replace(/"/g, '&quot;');
        const apiKeyJson = JSON.stringify(rawKey || '').replace(/"/g, '&quot;');
        const baseUrl = config['base-url'] || config['base_url'] || '';
        const excludedModelsHtml = this.renderExcludedModelBadges(config['excluded-models']);
        return `
            <div class="key-item">
                <div class="item-content">
                    <div class="item-title">${i18n.t('ai_providers.gemini_item_title')} #${index + 1}</div>
                    <div class="item-subtitle">${i18n.t('common.api_key')}: ${maskedDisplay}</div>
                    ${baseUrl ? `<div class="item-subtitle">${i18n.t('common.base_url')}: ${this.escapeHtml(baseUrl)}</div>` : ''}
                    ${this.renderHeaderBadges(config.headers)}
                    ${excludedModelsHtml}
                    <div class="item-stats">
                        <span class="stat-badge stat-success">
                            <i class="fas fa-check-circle"></i> ${i18n.t('stats.success')}: ${usageStats.success}
                        </span>
                        <span class="stat-badge stat-failure">
                            <i class="fas fa-times-circle"></i> ${i18n.t('stats.failure')}: ${usageStats.failure}
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
        `;
    }).join('');
}

export function showAddGeminiKeyModal() {
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
            <div class="form-group">
                <label for="new-gemini-excluded-models">${i18n.t('ai_providers.excluded_models_label')}</label>
                <p class="form-hint">${i18n.t('ai_providers.excluded_models_hint')}</p>
                <textarea id="new-gemini-excluded-models" rows="3" data-i18n-placeholder="ai_providers.excluded_models_placeholder" placeholder="${i18n.t('ai_providers.excluded_models_placeholder')}"></textarea>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.cancel')}</button>
                <button class="btn btn-primary" onclick="manager.addGeminiKey()">${i18n.t('common.add')}</button>
            </div>
        `;

    modal.style.display = 'block';
    this.populateGeminiKeyFields('new-gemini-keys-wrapper');
    this.populateHeaderFields('new-gemini-headers-wrapper');
    this.setExcludedModelsValue('new-gemini-excluded-models');
}

export async function addGeminiKey() {
    const entries = this.collectGeminiKeyFieldInputs('new-gemini-keys-wrapper');
    const headers = this.collectHeaderInputs('new-gemini-headers-wrapper');
    const excludedModels = this.collectExcludedModels('new-gemini-excluded-models');

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
            newConfig['excluded-models'] = excludedModels;
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

export function addGeminiKeyField(wrapperId, entry = {}, options = {}) {
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

export function populateGeminiKeyFields(wrapperId, entries = [], options = {}) {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;
    wrapper.innerHTML = '';

    if (!Array.isArray(entries) || entries.length === 0) {
        this.addGeminiKeyField(wrapperId, {}, options);
        return;
    }

    entries.forEach(entry => this.addGeminiKeyField(wrapperId, entry, options));
}

export function collectGeminiKeyFieldInputs(wrapperId) {
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

export function editGeminiKey(index, config) {
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
            <div class="form-group">
                <label for="edit-gemini-excluded-models">${i18n.t('ai_providers.excluded_models_label')}</label>
                <p class="form-hint">${i18n.t('ai_providers.excluded_models_hint')}</p>
                <textarea id="edit-gemini-excluded-models" rows="3" data-i18n-placeholder="ai_providers.excluded_models_placeholder" placeholder="${i18n.t('ai_providers.excluded_models_placeholder')}"></textarea>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.cancel')}</button>
                <button class="btn btn-primary" onclick="manager.updateGeminiKey(${index})">${i18n.t('common.update')}</button>
            </div>
        `;

    modal.style.display = 'block';
    this.populateGeminiKeyFields('edit-gemini-keys-wrapper', [config], { allowRemoval: false });
    this.populateHeaderFields('edit-gemini-headers-wrapper', config.headers || null);
    this.setExcludedModelsValue('edit-gemini-excluded-models', config['excluded-models'] || []);
}

export async function updateGeminiKey(index) {
    const entries = this.collectGeminiKeyFieldInputs('edit-gemini-keys-wrapper');
    if (!entries.length) {
        this.showNotification(i18n.t('notification.please_enter') + ' ' + i18n.t('notification.gemini_api_key'), 'error');
        return;
    }
    const entry = entries[0];
    const newKey = entry['api-key'];
    const baseUrl = entry['base-url'] || '';
    const headers = this.collectHeaderInputs('edit-gemini-headers-wrapper');
    const excludedModels = this.collectExcludedModels('edit-gemini-excluded-models');

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
        newConfig['excluded-models'] = excludedModels;
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

export async function deleteGeminiKey(apiKey) {
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

// Codex providers
export async function loadCodexKeys() {
    try {
        const config = await this.getConfig();
        const keys = Array.isArray(config['codex-api-key']) ? config['codex-api-key'] : [];
        await this.renderCodexKeys(keys);
    } catch (error) {
        console.error('加载Codex密钥失败:', error);
    }
}

export async function renderCodexKeys(keys, keyStats = null) {
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
    const statsBySource = getStatsBySource(keyStats);

    container.innerHTML = list.map((config, index) => {
        const rawKey = config['api-key'] || '';
        const masked = this.maskApiKey(rawKey || '');
        const maskedDisplay = this.escapeHtml(masked);
        const usageStats = (rawKey && (statsBySource[rawKey] || statsBySource[masked])) || { success: 0, failure: 0 };
        const deleteArg = JSON.stringify(rawKey).replace(/"/g, '&quot;');
        const excludedModelsHtml = this.renderExcludedModelBadges(config['excluded-models']);
        return `
            <div class="provider-item">
                <div class="item-content">
                    <div class="item-title">${i18n.t('ai_providers.codex_item_title')} #${index + 1}</div>
                    <div class="item-subtitle">${i18n.t('common.api_key')}: ${maskedDisplay}</div>
                    ${config['base-url'] ? `<div class="item-subtitle">${i18n.t('common.base_url')}: ${this.escapeHtml(config['base-url'])}</div>` : ''}
                    ${config['proxy-url'] ? `<div class="item-subtitle">${i18n.t('common.proxy_url')}: ${this.escapeHtml(config['proxy-url'])}</div>` : ''}
                    ${this.renderHeaderBadges(config.headers)}
                    ${excludedModelsHtml}
                    <div class="item-stats">
                        <span class="stat-badge stat-success">
                            <i class="fas fa-check-circle"></i> ${i18n.t('stats.success')}: ${usageStats.success}
                        </span>
                        <span class="stat-badge stat-failure">
                            <i class="fas fa-times-circle"></i> ${i18n.t('stats.failure')}: ${usageStats.failure}
                        </span>
                    </div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary" onclick="manager.editCodexKey(${index}, ${JSON.stringify(config).replace(/\"/g, '&quot;')})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" onclick="manager.deleteCodexKey(${deleteArg})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

export function showAddCodexKeyModal() {
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
                <label for="new-codex-excluded-models">${i18n.t('ai_providers.excluded_models_label')}</label>
                <p class="form-hint">${i18n.t('ai_providers.excluded_models_hint')}</p>
                <textarea id="new-codex-excluded-models" rows="3" data-i18n-placeholder="ai_providers.excluded_models_placeholder" placeholder="${i18n.t('ai_providers.excluded_models_placeholder')}"></textarea>
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
    this.setExcludedModelsValue('new-codex-excluded-models');
}

export async function addCodexKey() {
    const apiKey = document.getElementById('new-codex-key').value.trim();
    const baseUrl = document.getElementById('new-codex-url').value.trim();
    const proxyUrl = document.getElementById('new-codex-proxy').value.trim();
    const headers = this.collectHeaderInputs('new-codex-headers-wrapper');
    const excludedModels = this.collectExcludedModels('new-codex-excluded-models');

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

        const newConfig = this.buildCodexConfig(apiKey, baseUrl, proxyUrl, {}, headers, excludedModels);

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

export function editCodexKey(index, config) {
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
                <label for="edit-codex-excluded-models">${i18n.t('ai_providers.excluded_models_label')}</label>
                <p class="form-hint">${i18n.t('ai_providers.excluded_models_hint')}</p>
                <textarea id="edit-codex-excluded-models" rows="3" data-i18n-placeholder="ai_providers.excluded_models_placeholder" placeholder="${i18n.t('ai_providers.excluded_models_placeholder')}"></textarea>
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
    this.setExcludedModelsValue('edit-codex-excluded-models', config['excluded-models'] || []);
}

export async function updateCodexKey(index) {
    const apiKey = document.getElementById('edit-codex-key').value.trim();
    const baseUrl = document.getElementById('edit-codex-url').value.trim();
    const proxyUrl = document.getElementById('edit-codex-proxy').value.trim();
    const headers = this.collectHeaderInputs('edit-codex-headers-wrapper');
    const excludedModels = this.collectExcludedModels('edit-codex-excluded-models');

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
        const newConfig = this.buildCodexConfig(apiKey, baseUrl, proxyUrl, original, headers, excludedModels);

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

export async function deleteCodexKey(apiKey) {
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

// Claude providers
export async function loadClaudeKeys() {
    try {
        const config = await this.getConfig();
        const keys = Array.isArray(config['claude-api-key']) ? config['claude-api-key'] : [];
        await this.renderClaudeKeys(keys);
    } catch (error) {
        console.error('加载Claude密钥失败:', error);
    }
}

export async function renderClaudeKeys(keys, keyStats = null) {
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
    const statsBySource = getStatsBySource(keyStats);

    container.innerHTML = list.map((config, index) => {
        const rawKey = config['api-key'] || '';
        const masked = this.maskApiKey(rawKey || '');
        const maskedDisplay = this.escapeHtml(masked);
        const usageStats = (rawKey && (statsBySource[rawKey] || statsBySource[masked])) || { success: 0, failure: 0 };
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
                            <i class="fas fa-check-circle"></i> ${i18n.t('stats.success')}: ${usageStats.success}
                        </span>
                        <span class="stat-badge stat-failure">
                            <i class="fas fa-times-circle"></i> ${i18n.t('stats.failure')}: ${usageStats.failure}
                        </span>
                    </div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary" onclick="manager.editClaudeKey(${index}, ${JSON.stringify(config).replace(/\"/g, '&quot;')})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" onclick="manager.deleteClaudeKey(${deleteArg})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

export function showAddClaudeKeyModal() {
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

export async function addClaudeKey() {
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

export function editClaudeKey(index, config) {
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

export async function updateClaudeKey(index) {
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

export async function deleteClaudeKey(apiKey) {
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

// OpenAI compatible providers
export async function loadOpenAIProviders() {
    try {
        const config = await this.getConfig();
        const providers = Array.isArray(config['openai-compatibility']) ? config['openai-compatibility'] : [];
        await this.renderOpenAIProviders(providers);
    } catch (error) {
        console.error('加载OpenAI提供商失败:', error);
    }
}

export async function renderOpenAIProviders(providers, keyStats = null) {
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
    const statsBySource = getStatsBySource(keyStats);

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
            const usageStats = statsBySource[key] || statsBySource[masked] || { success: 0, failure: 0 };
            totalSuccess += usageStats.success;
            totalFailure += usageStats.failure;
        });

        const deleteArg = JSON.stringify(name).replace(/"/g, '&quot;');
        return `
            <div class="provider-item">
                <div class="item-content">
                    <div class="item-title">${this.escapeHtml(name)}</div>
                    <div class="item-subtitle provider-base-url" title="${this.escapeHtml(baseUrl)}">${i18n.t('common.base_url')}: ${this.escapeHtml(baseUrl)}</div>
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
                    <button class="btn btn-secondary" onclick="manager.editOpenAIProvider(${index}, ${JSON.stringify(item).replace(/\"/g, '&quot;')})">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn btn-danger" onclick="manager.deleteOpenAIProvider(${deleteArg})">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

const getOpenAIContext = (mode = 'new') => {
    const isEdit = mode === 'edit';
    return {
        mode: isEdit ? 'edit' : 'new',
        baseUrlInputId: isEdit ? 'edit-provider-url' : 'new-provider-url',
        apiKeyWrapperId: isEdit ? 'edit-openai-keys-wrapper' : 'new-openai-keys-wrapper',
        headerWrapperId: isEdit ? 'edit-openai-headers-wrapper' : 'new-openai-headers-wrapper',
        modelWrapperId: isEdit ? 'edit-provider-models-wrapper' : 'new-provider-models-wrapper'
    };
};

function ensureOpenAIModelDiscoveryCard(manager) {
    let overlay = document.getElementById('openai-model-discovery');
    if (overlay) {
        return overlay;
    }

    overlay = document.createElement('div');
    overlay.id = 'openai-model-discovery';
    overlay.className = 'model-discovery-overlay';
    overlay.innerHTML = `
        <div class="model-discovery-card">
            <div class="model-discovery-header">
                <div class="model-discovery-title">
                    <h3>${i18n.t('ai_providers.openai_models_fetch_title')}</h3>
                    <p class="form-hint">${i18n.t('ai_providers.openai_models_fetch_hint')}</p>
                </div>
                <button type="button" class="btn btn-secondary" id="openai-model-discovery-back">${i18n.t('ai_providers.openai_models_fetch_back')}</button>
            </div>
            <div class="form-group">
                <label>${i18n.t('ai_providers.openai_models_fetch_url_label')}</label>
                <div class="input-group">
                    <input type="text" id="openai-model-discovery-url" readonly>
                    <button type="button" class="btn btn-secondary" id="openai-model-discovery-refresh">${i18n.t('ai_providers.openai_models_fetch_refresh')}</button>
                </div>
            </div>
            <div class="form-group">
                <label for="openai-model-discovery-search">${i18n.t('ai_providers.openai_models_search_label')}</label>
                <input type="text" id="openai-model-discovery-search" placeholder="${i18n.t('ai_providers.openai_models_search_placeholder')}">
            </div>
            <div id="openai-model-discovery-status" class="model-discovery-status"></div>
            <div id="openai-model-discovery-list" class="model-discovery-list"></div>
            <div class="modal-actions">
                <button class="btn btn-secondary" id="openai-model-discovery-cancel">${i18n.t('common.cancel')}</button>
                <button class="btn btn-primary" id="openai-model-discovery-apply">${i18n.t('ai_providers.openai_models_fetch_apply')}</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const bind = (id, handler) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', handler);
        }
    };

    bind('openai-model-discovery-back', () => manager.closeOpenAIModelDiscovery());
    bind('openai-model-discovery-cancel', () => manager.closeOpenAIModelDiscovery());
    bind('openai-model-discovery-refresh', () => manager.refreshOpenAIModelDiscovery());
    bind('openai-model-discovery-apply', () => manager.applyOpenAIModelDiscoverySelection());
    const searchInput = document.getElementById('openai-model-discovery-search');
    if (searchInput) {
        searchInput.addEventListener('input', (event) => {
            const query = event?.target?.value || '';
            manager.setOpenAIModelDiscoverySearch(query);
        });
    }

    return overlay;
}

export function setOpenAIModelDiscoveryStatus(message = '', type = 'info') {
    const status = document.getElementById('openai-model-discovery-status');
    if (!status) return;
    status.textContent = message;
    status.className = `model-discovery-status ${type}`;
}

export function setOpenAIModelDiscoverySearch(query = '') {
    if (!this.openAIModelDiscoveryContext) return;
    const normalized = (query || '').trim();
    this.openAIModelDiscoveryContext.modelSearchQuery = normalized;
    const models = this.openAIModelDiscoveryContext.discoveredModels || [];
    this.renderOpenAIModelDiscoveryList(models);
}

export function renderOpenAIModelDiscoveryList(models = []) {
    const list = document.getElementById('openai-model-discovery-list');
    if (!list) return;

    const context = this.openAIModelDiscoveryContext || {};
    const filter = (context.modelSearchQuery || '').trim().toLowerCase();
    const filtered = models
        .map((model, index) => ({ model, index }))
        .filter(({ model }) => {
            if (!filter) return true;
            const name = (model?.name || '').toLowerCase();
            const alias = (model?.alias || '').toLowerCase();
            const desc = (model?.description || '').toLowerCase();
            return name.includes(filter) || alias.includes(filter) || desc.includes(filter);
        });

    if (!models.length) {
        list.innerHTML = `
            <div class="model-discovery-empty">
                <i class="fas fa-box-open"></i>
                <span>${i18n.t('ai_providers.openai_models_fetch_empty')}</span>
            </div>
        `;
        return;
    }

    if (!filtered.length) {
        list.innerHTML = `
            <div class="model-discovery-empty">
                <i class="fas fa-search"></i>
                <span>${i18n.t('ai_providers.openai_models_search_empty')}</span>
            </div>
        `;
        return;
    }

    list.innerHTML = filtered.map(({ model, index }) => {
        const name = this.escapeHtml(model?.name || '');
        const alias = model?.alias ? `<span class="model-discovery-alias">${this.escapeHtml(model.alias)}</span>` : '';
        const desc = model?.description ? `<div class="model-discovery-desc">${this.escapeHtml(model.description)}</div>` : '';
        return `
            <label class="model-discovery-row">
                <input type="checkbox" class="model-discovery-checkbox" data-model-index="${index}">
                <div class="model-discovery-meta">
                    <div class="model-discovery-name">${name} ${alias}</div>
                    ${desc}
                </div>
            </label>
        `;
    }).join('');
}

export function openOpenAIModelDiscovery(mode = 'new') {
    const context = getOpenAIContext(mode);
    const baseInput = document.getElementById(context.baseUrlInputId);
    const baseUrl = baseInput ? baseInput.value.trim() : '';

    if (!baseUrl) {
        this.showNotification(i18n.t('ai_providers.openai_models_fetch_invalid_url'), 'error');
        return;
    }

    const endpoint = buildModelEndpoint(baseUrl);
    if (!endpoint) {
        this.showNotification(i18n.t('ai_providers.openai_models_fetch_invalid_url'), 'error');
        return;
    }

    const apiKeyEntries = this.collectApiKeyEntryInputs(context.apiKeyWrapperId);
    const firstKey = Array.isArray(apiKeyEntries) ? apiKeyEntries.find(entry => entry && entry['api-key']) : null;
    const headers = this.collectHeaderInputs(context.headerWrapperId) || {};

    if (firstKey && !headers.Authorization && !headers.authorization) {
        headers.Authorization = `Bearer ${firstKey['api-key']}`;
    }

    ensureOpenAIModelDiscoveryCard(this).classList.add('active');
    this.openAIModelDiscoveryContext = {
        ...context,
        endpoint,
        headers,
        discoveredModels: [],
        modelSearchQuery: ''
    };

    const urlInput = document.getElementById('openai-model-discovery-url');
    if (urlInput) {
        urlInput.value = endpoint;
    }
    const searchInput = document.getElementById('openai-model-discovery-search');
    if (searchInput) {
        searchInput.value = '';
    }

    this.renderOpenAIModelDiscoveryList([]);
    this.setOpenAIModelDiscoveryStatus(i18n.t('ai_providers.openai_models_fetch_loading'), 'info');
    this.refreshOpenAIModelDiscovery();
}

export async function refreshOpenAIModelDiscovery() {
    const context = this.openAIModelDiscoveryContext;
    if (!context || !context.endpoint) {
        return;
    }

    this.setOpenAIModelDiscoveryStatus(i18n.t('ai_providers.openai_models_fetch_loading'), 'info');
    const list = document.getElementById('openai-model-discovery-list');
    if (list) {
        list.innerHTML = '<div class="model-discovery-empty"><i class="fas fa-spinner fa-spin"></i></div>';
    }

    try {
        let response;
        let usedSimpleRequest = false;

        try {
            // 首先尝试正常的带自定义headers的请求
            response = await fetch(context.endpoint, {
                headers: context.headers || {}
            });
        } catch (error) {
            // 如果fetch失败(通常是CORS预检失败),尝试简单GET请求
            console.warn('Normal fetch failed, trying simple GET request:', error);
            usedSimpleRequest = true;
            response = await fetch(context.endpoint, {
                method: 'GET',
                mode: 'cors',
                credentials: 'omit'
                // 不发送自定义headers,避免触发OPTIONS预检
            });
        }

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

        const models = normalizeModelList(data);
        context.discoveredModels = models;

        this.renderOpenAIModelDiscoveryList(models);
        if (!models.length) {
            this.setOpenAIModelDiscoveryStatus(i18n.t('ai_providers.openai_models_fetch_empty'), 'warning');
        } else {
            if (usedSimpleRequest) {
                // 如果使用了简单请求,提示用户
                console.info('Models fetched using simple request (without custom headers)');
            }
            this.setOpenAIModelDiscoveryStatus('', 'info');
        }
    } catch (error) {
        context.discoveredModels = [];
        this.renderOpenAIModelDiscoveryList([]);
        this.setOpenAIModelDiscoveryStatus(`${i18n.t('ai_providers.openai_models_fetch_error')}: ${error.message}`, 'error');
    }
}

export function applyOpenAIModelDiscoverySelection() {
    const context = this.openAIModelDiscoveryContext;
    if (!context || !Array.isArray(context.discoveredModels) || !context.discoveredModels.length) {
        this.closeOpenAIModelDiscovery();
        return;
    }

    const list = document.getElementById('openai-model-discovery-list');
    if (!list) {
        this.closeOpenAIModelDiscovery();
        return;
    }

    const selectedIndices = Array.from(list.querySelectorAll('.model-discovery-checkbox:checked'))
        .map(input => Number.parseInt(input.getAttribute('data-model-index') || '-1', 10))
        .filter(index => Number.isFinite(index) && index >= 0 && index < context.discoveredModels.length);

    const selectedModels = selectedIndices.map(index => context.discoveredModels[index]);
    if (!selectedModels.length) {
        this.closeOpenAIModelDiscovery();
        return;
    }

    const existing = this.collectModelInputs(context.modelWrapperId);
    const mergedMap = new Map();
    existing.forEach(model => {
        if (model && model.name) {
            mergedMap.set(model.name, { ...model });
        }
    });

    let addedCount = 0;
    selectedModels.forEach(model => {
        const name = model && model.name;
        if (!name) return;
        if (!mergedMap.has(name)) {
            mergedMap.set(name, { name, ...(model.alias ? { alias: model.alias } : {}) });
            addedCount++;
        }
    });

    this.populateModelFields(context.modelWrapperId, Array.from(mergedMap.values()));
    if (context.mode === 'edit' && typeof this.populateOpenAITestModelOptions === 'function') {
        this.populateOpenAITestModelOptions(Array.from(mergedMap.values()), { preserveInput: true });
    }
    this.closeOpenAIModelDiscovery();

    if (addedCount > 0) {
        const template = i18n.t('ai_providers.openai_models_fetch_added');
        const message = template.replace('{count}', addedCount);
        this.showNotification(message, 'success');
    }
}

export function closeOpenAIModelDiscovery() {
    const overlay = document.getElementById('openai-model-discovery');
    if (overlay) {
        overlay.classList.remove('active');
    }
    this.openAIModelDiscoveryContext = null;
}

export function populateOpenAITestModelOptions(models = [], { preserveInput = true } = {}) {
    const select = document.getElementById('openai-test-model-select');
    const input = document.getElementById('openai-test-model-input');
    if (!select) return;

    const names = [];
    const seen = new Set();
    (Array.isArray(models) ? models : []).forEach(model => {
        const name = model?.name ? String(model.name).trim() : '';
        if (!name || seen.has(name)) return;
        seen.add(name);
        names.push(name);
    });

    if (!names.length) {
        select.disabled = true;
        select.innerHTML = `<option value="">${i18n.t('ai_providers.openai_test_select_empty')}</option>`;
        if (input && !preserveInput) {
            input.value = '';
        }
        return;
    }

    select.disabled = false;
    const placeholder = `<option value="">${i18n.t('ai_providers.openai_test_select_placeholder')}</option>`;
    const options = names.map(name => `<option value="${this.escapeHtml(name)}">${this.escapeHtml(name)}</option>`).join('');
    select.innerHTML = `${placeholder}${options}`;

    if (input) {
        if (!preserveInput || !input.value) {
            const firstName = names[0];
            if (firstName) {
                input.value = firstName;
                select.value = firstName;
                return;
            }
        }

        const current = input.value.trim();
        if (current && names.includes(current)) {
            select.value = current;
        } else {
            select.value = '';
        }
    }
}

export function setOpenAITestStatus(message = '', type = 'info') {
    const statusEl = document.getElementById('openai-test-status');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.className = `openai-test-status ${type || ''}`.trim();
}

const setOpenAITestButtonState = (state = 'idle') => {
    const button = document.getElementById('openai-test-button');
    if (!button) return;
    button.disabled = state === 'loading';
    button.classList.remove('openai-test-btn-success', 'openai-test-btn-error');

    switch (state) {
        case 'loading':
            button.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
            break;
        case 'success':
            button.classList.add('openai-test-btn-success');
            button.innerHTML = `<i class="fas fa-check"></i>`;
            break;
        case 'error':
            button.classList.add('openai-test-btn-error');
            button.innerHTML = `<i class="fas fa-times"></i>`;
            break;
        default:
            button.innerHTML = `<i class="fas fa-stethoscope"></i> ${i18n.t('ai_providers.openai_test_action')}`;
            break;
    }
};

export async function testOpenAIProviderConnection() {
    const baseUrlInput = document.getElementById('edit-provider-url');
    const baseUrl = baseUrlInput ? baseUrlInput.value.trim() : '';
    if (!baseUrl) {
        const message = i18n.t('notification.openai_test_url_required');
        this.setOpenAITestStatus(message, 'error');
        this.showNotification(message, 'error');
        return;
    }

    const endpoint = buildChatCompletionsEndpoint(baseUrl);
    if (!endpoint) {
        const message = i18n.t('notification.openai_test_url_required');
        this.setOpenAITestStatus(message, 'error');
        this.showNotification(message, 'error');
        return;
    }

    const apiKeyEntries = this.collectApiKeyEntryInputs('edit-openai-keys-wrapper');
    const firstKeyEntry = Array.isArray(apiKeyEntries) ? apiKeyEntries.find(entry => entry && entry['api-key']) : null;
    if (!firstKeyEntry) {
        const message = i18n.t('notification.openai_test_key_required');
        this.setOpenAITestStatus(message, 'error');
        this.showNotification(message, 'error');
        return;
    }

    const models = this.collectModelInputs('edit-provider-models-wrapper');
    this.populateOpenAITestModelOptions(models);

    const modelInput = document.getElementById('openai-test-model-input');
    let modelName = modelInput ? modelInput.value.trim() : '';
    if (!modelName) {
        const firstModel = Array.isArray(models) ? models.find(model => model && model.name) : null;
        if (firstModel && firstModel.name) {
            modelName = firstModel.name;
            if (modelInput) {
                modelInput.value = firstModel.name;
            }
        }
    }

    if (!modelName) {
        const message = i18n.t('notification.openai_test_model_required');
        this.setOpenAITestStatus(message, 'error');
        this.showNotification(message, 'error');
        return;
    }

    const customHeaders = this.collectHeaderInputs('edit-openai-headers-wrapper') || {};
    const headers = {
        'Content-Type': 'application/json',
        ...customHeaders
    };
    if (!headers.Authorization && !headers.authorization) {
        headers.Authorization = `Bearer ${firstKeyEntry['api-key']}`;
    }

    this.setOpenAITestStatus('', 'info');
    setOpenAITestButtonState('loading');

    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: modelName,
                messages: [{ role: 'user', content: 'Hi' }],
                stream: false,
                max_tokens: 5
            })
        });

        const rawText = await response.text();

        if (!response.ok) {
            let errorMessage = `${response.status} ${response.statusText}`;
            try {
                const parsed = rawText ? JSON.parse(rawText) : null;
                errorMessage = parsed?.error?.message || parsed?.message || errorMessage;
            } catch (error) {
                if (rawText) {
                    errorMessage = rawText;
                }
            }
            throw new Error(errorMessage);
        }

        this.setOpenAITestStatus('', 'info');
        setOpenAITestButtonState('success');
    } catch (error) {
        this.setOpenAITestStatus(`${i18n.t('ai_providers.openai_test_failed')}: ${error.message}`, 'error');
        setOpenAITestButtonState('error');
    }
}

export function showAddOpenAIProviderModal() {
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
                <div class="model-actions-inline">
                    <button type="button" class="btn btn-secondary" onclick="manager.addModelField('new-provider-models-wrapper')">${i18n.t('ai_providers.openai_models_add_btn')}</button>
                    <button type="button" class="btn btn-secondary" onclick="manager.openOpenAIModelDiscovery('new')">
                        <i class="fas fa-download"></i> ${i18n.t('ai_providers.openai_models_fetch_button')}
                    </button>
                </div>
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

export async function addOpenAIProvider() {
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

export function editOpenAIProvider(index, provider) {
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
                <div class="model-actions-inline">
                    <button type="button" class="btn btn-secondary" onclick="manager.addModelField('edit-provider-models-wrapper')">${i18n.t('ai_providers.openai_models_add_btn')}</button>
                    <button type="button" class="btn btn-secondary" onclick="manager.openOpenAIModelDiscovery('edit')">
                        <i class="fas fa-download"></i> ${i18n.t('ai_providers.openai_models_fetch_button')}
                    </button>
                </div>
            </div>
            <div class="form-group">
                <label>${i18n.t('ai_providers.openai_test_title')}</label>
                <p class="form-hint">${i18n.t('ai_providers.openai_test_hint')}</p>
                <div class="input-group openai-test-group">
                    <select id="openai-test-model-select" aria-label="${i18n.t('ai_providers.openai_test_model_placeholder')}"></select>
                    <input type="text" id="openai-test-model-input" placeholder="${i18n.t('ai_providers.openai_test_model_placeholder')}">
                    <button type="button" class="btn btn-secondary" id="openai-test-button" onclick="manager.testOpenAIProviderConnection()">
                        <i class="fas fa-stethoscope"></i> ${i18n.t('ai_providers.openai_test_action')}
                    </button>
                </div>
                <div id="openai-test-status" class="openai-test-status"></div>
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
    this.populateOpenAITestModelOptions(models);
    this.setOpenAITestStatus('', 'info');
    setOpenAITestButtonState('idle');

    const modelWrapper = document.getElementById('edit-provider-models-wrapper');
    if (modelWrapper) {
        modelWrapper.addEventListener('input', () => {
            const currentModels = this.collectModelInputs('edit-provider-models-wrapper');
            this.populateOpenAITestModelOptions(currentModels, { preserveInput: true });
        });
    }

    const modelSelect = document.getElementById('openai-test-model-select');
    if (modelSelect) {
        modelSelect.addEventListener('change', (event) => {
            const value = event?.target?.value || '';
            const input = document.getElementById('openai-test-model-input');
            if (input && value) {
                input.value = value;
            }
        });
    }
}

export async function updateOpenAIProvider(index) {
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

export async function deleteOpenAIProvider(name) {
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

export function addModelField(wrapperId, model = {}) {
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

export function populateModelFields(wrapperId, models = []) {
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;
    wrapper.innerHTML = '';

    if (!models.length) {
        this.addModelField(wrapperId);
        return;
    }

    models.forEach(model => this.addModelField(wrapperId, model));
}

export function collectModelInputs(wrapperId) {
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

export function renderModelBadges(models) {
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

export function validateOpenAIProviderInput(name, baseUrl, models) {
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

export const aiProvidersModule = {
    loadGeminiKeys,
    getGeminiKeysFromConfig,
    renderGeminiKeys,
    showAddGeminiKeyModal,
    addGeminiKey,
    addGeminiKeyField,
    populateGeminiKeyFields,
    collectGeminiKeyFieldInputs,
    editGeminiKey,
    updateGeminiKey,
    deleteGeminiKey,
    loadCodexKeys,
    renderCodexKeys,
    showAddCodexKeyModal,
    addCodexKey,
    editCodexKey,
    updateCodexKey,
    deleteCodexKey,
    loadClaudeKeys,
    renderClaudeKeys,
    showAddClaudeKeyModal,
    addClaudeKey,
    editClaudeKey,
    updateClaudeKey,
    deleteClaudeKey,
    loadOpenAIProviders,
    renderOpenAIProviders,
    showAddOpenAIProviderModal,
    addOpenAIProvider,
    editOpenAIProvider,
    updateOpenAIProvider,
    deleteOpenAIProvider,
    openOpenAIModelDiscovery,
    refreshOpenAIModelDiscovery,
    renderOpenAIModelDiscoveryList,
    setOpenAIModelDiscoveryStatus,
    setOpenAIModelDiscoverySearch,
    applyOpenAIModelDiscoverySelection,
    closeOpenAIModelDiscovery,
    populateOpenAITestModelOptions,
    setOpenAITestStatus,
    testOpenAIProviderConnection,
    addModelField,
    populateModelFields,
    collectModelInputs,
    renderModelBadges,
    renderExcludedModelBadges,
    collectExcludedModels,
    setExcludedModelsValue,
    validateOpenAIProviderInput
};
