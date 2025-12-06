export const authFilesModule = {
    // 加载认证文件
    async loadAuthFiles(keyStats = null) {
        try {
            const data = await this.makeRequest('/auth-files');
            if (!keyStats) {
                keyStats = await this.getKeyStats();
            }
            await this.renderAuthFiles(data.files || [], keyStats);
        } catch (error) {
            console.error('加载认证文件失败:', error);
        }
    },

    // 渲染认证文件列表
    async renderAuthFiles(files, keyStats = null) {
        const container = document.getElementById('auth-files-list');
        if (!container) {
            return;
        }

        const allFiles = Array.isArray(files) ? files : [];
        const visibleFiles = allFiles.filter(file => {
            if (!file) return false;
            return this.shouldDisplayDisabledGeminiCli(file) || file.disabled !== true;
        });
        const stats = keyStats || await this.getKeyStats();

        this.cachedAuthFiles = visibleFiles.map(file => ({ ...file }));
        this.authFileStatsCache = stats || { bySource: {}, byAuthIndex: {} };
        this.syncAuthFileControls();

        if (this.cachedAuthFiles.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-file-alt"></i>
                    <h3>${i18n.t('auth_files.empty_title')}</h3>
                    <p>${i18n.t('auth_files.empty_desc')}</p>
                </div>
            `;
            this.updateFilterButtons(new Set(['all']));
            this.bindAuthFileFilterEvents();
            this.applyAuthFileFilterState(false);
            this.authFilesPagination.currentPage = 1;
            this.authFilesPagination.totalPages = 1;
            this.updatePaginationControls(0);
            return;
        }

        const existingTypes = new Set(['all']);
        this.cachedAuthFiles.forEach(file => {
            if (file.type) {
                existingTypes.add(file.type);
            }
        });

        this.updateFilterButtons(existingTypes);
        this.bindAuthFileFilterEvents();
        this.applyAuthFileFilterState(false);
        this.renderAuthFilesPage(this.authFilesPagination.currentPage);
        this.bindAuthFileActionEvents();
    },

    isRuntimeOnlyAuthFile(file) {
        if (!file) return false;
        const runtimeValue = file.runtime_only;
        return runtimeValue === true || runtimeValue === 'true';
    },

    shouldDisplayDisabledGeminiCli(file) {
        if (!file) return false;
        const provider = typeof file.provider === 'string' ? file.provider.toLowerCase() : '';
        const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
        const isGeminiCli = provider === 'gemini-cli' || type === 'gemini-cli';
        return isGeminiCli && !this.isRuntimeOnlyAuthFile(file);
    },

    resolveAuthFileStats(file, stats = {}) {
        const statsBySource = (stats && stats.bySource) || stats || {};
        const statsByAuthIndex = (stats && stats.byAuthIndex) || {};
        const rawFileName = typeof file?.name === 'string' ? file.name : '';
        const defaultStats = { success: 0, failure: 0 };
        const authIndexKey = this.normalizeAuthIndexValue(file?.auth_index);

        if (authIndexKey && statsByAuthIndex[authIndexKey]) {
            return statsByAuthIndex[authIndexKey];
        }

        if (!rawFileName) {
            return defaultStats;
        }

        const fromName = statsBySource[rawFileName];
        if (fromName && (fromName.success > 0 || fromName.failure > 0)) {
            return fromName;
        }

        let fileStats = fromName || defaultStats;
        if (fileStats.success === 0 && fileStats.failure === 0) {
            const nameWithoutExt = rawFileName.replace(/\.[^/.]+$/, "");

            if (nameWithoutExt && nameWithoutExt !== rawFileName) {
                const candidateNames = new Set([nameWithoutExt]);
                const normalizedName = nameWithoutExt.toLowerCase();
                const typePrefix = typeof file?.type === 'string' ? file.type.trim().toLowerCase() : '';
                const providerPrefix = typeof file?.provider === 'string' ? file.provider.trim().toLowerCase() : '';
                const prefixList = [];

                if (typePrefix) {
                    prefixList.push(`${typePrefix}-`);
                }
                if (providerPrefix && providerPrefix !== typePrefix) {
                    prefixList.push(`${providerPrefix}-`);
                }

                prefixList.forEach(prefix => {
                    if (prefix && normalizedName.startsWith(prefix)) {
                        const trimmed = nameWithoutExt.substring(prefix.length);
                        if (trimmed) {
                            candidateNames.add(trimmed);
                        }
                    }
                });

                for (const candidate of candidateNames) {
                    const candidateStats = statsBySource[candidate];
                    if (candidateStats && (candidateStats.success > 0 || candidateStats.failure > 0)) {
                        fileStats = candidateStats;
                        break;
                    }
                }
            }
        }

        return fileStats || defaultStats;
    },

    normalizeAuthIndexValue(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value.toString();
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            return trimmed ? trimmed : null;
        }
        return null;
    },

    buildAuthFileItemHtml(file) {
        const rawFileName = typeof file?.name === 'string' ? file.name : '';
        const safeFileName = this.escapeHtml(rawFileName);
        const stats = this.authFileStatsCache || {};
        const fileStats = this.resolveAuthFileStats(file, stats);
        const fileType = file.type || 'unknown';
        let typeDisplayKey;
        switch (fileType) {
            case 'qwen':
                typeDisplayKey = 'auth_files.type_qwen';
                break;
            case 'gemini':
                typeDisplayKey = 'auth_files.type_gemini';
                break;
            case 'gemini-cli':
                typeDisplayKey = 'auth_files.type_gemini-cli';
                break;
            case 'aistudio':
                typeDisplayKey = 'auth_files.type_aistudio';
                break;
            case 'claude':
                typeDisplayKey = 'auth_files.type_claude';
                break;
            case 'codex':
                typeDisplayKey = 'auth_files.type_codex';
                break;
            case 'antigravity':
                typeDisplayKey = 'auth_files.type_antigravity';
                break;
            case 'iflow':
                typeDisplayKey = 'auth_files.type_iflow';
                break;
            case 'vertex':
                typeDisplayKey = 'auth_files.type_vertex';
                break;
            case 'empty':
                typeDisplayKey = 'auth_files.type_empty';
                break;
            default:
                typeDisplayKey = 'auth_files.type_unknown';
                break;
        }
        const typeBadge = `<span class="file-type-badge ${fileType}">${i18n.t(typeDisplayKey)}</span>`;
        const isRuntimeOnly = this.isRuntimeOnlyAuthFile(file);
        const shouldShowMainFlag = this.shouldDisplayDisabledGeminiCli(file);
        const mainFlagButton = shouldShowMainFlag ? `
                            <button class="btn-small btn-warning main-flag-btn" title="主" disabled>主</button>` : '';
        const actionsHtml = isRuntimeOnly ? `
                        <div class="item-actions">
                            <span class="virtual-auth-badge">虚拟认证文件</span>
                        </div>` : `
                        <div class="item-actions" data-filename="${safeFileName}">
                            ${mainFlagButton}
                            <button class="btn-small btn-info" data-action="showDetails" title="详细信息">
                                <i class="fas fa-info-circle"></i>
                            </button>
                            <button class="btn-small btn-primary" data-action="download" title="下载">
                                <i class="fas fa-download"></i>
                            </button>
                            <button class="btn-small btn-danger" data-action="delete" title="删除">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>`;

        return `
            <div class="file-item" data-file-type="${fileType}" data-file-name="${safeFileName}" ${isRuntimeOnly ? 'data-runtime-only="true"' : ''}>
                <div class="item-content">
                    <div class="item-title">${typeBadge}${safeFileName}</div>
                    <div class="item-meta">
                        <span class="item-subtitle">${i18n.t('auth_files.file_modified')}: ${new Date(file.modtime).toLocaleString(i18n.currentLanguage === 'zh-CN' ? 'zh-CN' : 'en-US')}</span>
                        <span class="item-subtitle">${i18n.t('auth_files.file_size')}: ${this.formatFileSize(file.size)}</span>
                    </div>
                    <div class="item-footer">
                        <div class="item-stats">
                            <span class="stat-badge stat-success">
                                <i class="fas fa-check-circle"></i> ${i18n.t('stats.success')}: ${fileStats.success}
                            </span>
                            <span class="stat-badge stat-failure">
                                <i class="fas fa-times-circle"></i> ${i18n.t('stats.failure')}: ${fileStats.failure}
                            </span>
                        </div>
                        ${actionsHtml}
                    </div>
                </div>
            </div>
        `;
    },

    getFilteredAuthFiles(filterType = this.currentAuthFileFilter) {
        const files = Array.isArray(this.cachedAuthFiles) ? this.cachedAuthFiles : [];
        if (!files.length) {
            return [];
        }

        const typeFilter = (filterType || 'all').toLowerCase();
        const keyword = (this.authFileSearchQuery || '').trim().toLowerCase();

        return files.filter(file => {
            const name = String(file?.name || '').toLowerCase();
            const type = String(file?.type || '').toLowerCase();
            const provider = String(file?.provider || '').toLowerCase();

            if (typeFilter !== 'all') {
                if (!type) return false;
                if (type !== typeFilter) {
                    if (!provider || provider !== typeFilter) {
                        return false;
                    }
                }
            }

            if (!keyword) return true;
            return name.includes(keyword) || type.includes(keyword) || provider.includes(keyword);
        });
    },

    updateAuthFileSearchQuery(value = '') {
        const normalized = (value || '').trim();
        if (this.authFileSearchQuery === normalized) {
            return;
        }
        this.authFileSearchQuery = normalized;
        this.authFilesPagination.currentPage = 1;
        this.renderAuthFilesPage(1);
    },

    updateAuthFilesPageSize(value) {
        const normalized = this.normalizeAuthFilesPageSize(value);
        if (this.authFilesPagination?.pageSize === normalized) {
            this.syncAuthFileControls();
            return;
        }
        this.authFilesPagination.pageSize = normalized;
        this.authFilesPagination.currentPage = 1;
        try {
            localStorage.setItem(this.authFilesPageSizeKey, `${normalized}`);
        } catch (error) {
            console.warn('Failed to persist auth files page size:', error);
        }
        this.syncAuthFileControls();
        this.renderAuthFilesPage(1);
    },

    syncAuthFileControls() {
        const searchInput = document.getElementById('auth-files-search-input');
        if (searchInput && searchInput.value !== this.authFileSearchQuery) {
            searchInput.value = this.authFileSearchQuery;
        }

        const pageSizeInput = document.getElementById('auth-files-page-size-input');
        const targetSize = this.authFilesPagination?.pageSize || 9;
        if (pageSizeInput && parseInt(pageSizeInput.value, 10) !== targetSize) {
            pageSizeInput.value = targetSize;
        }
    },

    bindAuthFilesSearchControl() {
        const searchInput = document.getElementById('auth-files-search-input');
        if (!searchInput) return;

        if (searchInput._authFileSearchListener) {
            searchInput.removeEventListener('input', searchInput._authFileSearchListener);
        }

        const debounced = this.debounce((value) => {
            this.updateAuthFileSearchQuery(value);
        }, 250);

        const listener = (event) => {
            const value = event?.target?.value ?? '';
            debounced(value);
        };

        searchInput._authFileSearchListener = listener;
        searchInput.addEventListener('input', listener);
    },

    bindAuthFilesPageSizeControl() {
        const pageSizeInput = document.getElementById('auth-files-page-size-input');
        if (!pageSizeInput) return;

        if (pageSizeInput._authFilePageSizeListener) {
            pageSizeInput.removeEventListener('change', pageSizeInput._authFilePageSizeListener);
        }

        const listener = (event) => {
            const value = parseInt(event?.target?.value, 10);
            if (!Number.isFinite(value)) {
                return;
            }
            this.updateAuthFilesPageSize(value);
        };

        pageSizeInput._authFilePageSizeListener = listener;
        pageSizeInput.addEventListener('change', listener);

        if (pageSizeInput._authFilePageSizeBlur) {
            pageSizeInput.removeEventListener('blur', pageSizeInput._authFilePageSizeBlur);
        }

        const blurListener = () => {
            if (!pageSizeInput.value) {
                this.syncAuthFileControls();
            }
        };

        pageSizeInput._authFilePageSizeBlur = blurListener;
        pageSizeInput.addEventListener('blur', blurListener);
    },

    renderAuthFilesPage(page = null) {
        const container = document.getElementById('auth-files-list');
        if (!container) return;

        const pageSize = this.authFilesPagination?.pageSize || 9;
        const filteredFiles = this.getFilteredAuthFiles();
        const totalItems = filteredFiles.length;
        const hasCachedFiles = Array.isArray(this.cachedAuthFiles) && this.cachedAuthFiles.length > 0;
        const filterApplied = (this.currentAuthFileFilter && this.currentAuthFileFilter !== 'all');
        const searchApplied = Boolean((this.authFileSearchQuery || '').trim());

        if (totalItems === 0) {
            const titleKey = hasCachedFiles && (filterApplied || searchApplied)
                ? 'auth_files.search_empty_title'
                : 'auth_files.empty_title';
            const descKey = hasCachedFiles && (filterApplied || searchApplied)
                ? 'auth_files.search_empty_desc'
                : 'auth_files.empty_desc';
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-file-alt"></i>
                    <h3>${i18n.t(titleKey)}</h3>
                    <p>${i18n.t(descKey)}</p>
                </div>
            `;
            this.authFilesPagination.currentPage = 1;
            this.updatePaginationControls(0);
            return;
        }

        const maxPages = Math.max(1, Math.ceil(totalItems / pageSize));
        let currentPage = page == null ? (this.authFilesPagination.currentPage || 1) : page;
        if (currentPage > maxPages) {
            currentPage = maxPages;
        }
        if (currentPage < 1) {
            currentPage = 1;
        }
        this.authFilesPagination.currentPage = currentPage;
        this.authFilesPagination.totalPages = maxPages;

        const startIndex = (currentPage - 1) * pageSize;
        const pageFiles = filteredFiles.slice(startIndex, startIndex + pageSize);

        container.innerHTML = pageFiles.map(file => this.buildAuthFileItemHtml(file)).join('');
        this.updatePaginationControls(totalItems);
        this.bindAuthFileActionEvents();
    },

    bindAuthFilesPaginationEvents() {
        const container = document.getElementById('auth-files-pagination');
        if (!container) return;

        const oldListener = container._paginationListener;
        if (oldListener) {
            container.removeEventListener('click', oldListener);
        }

        const listener = (event) => {
            const button = event.target.closest('button[data-action]');
            if (!button || !container.contains(button)) return;
            event.preventDefault();
            const action = button.dataset.action;
            const currentPage = this.authFilesPagination?.currentPage || 1;
            if (action === 'prev') {
                this.renderAuthFilesPage(currentPage - 1);
            } else if (action === 'next') {
                this.renderAuthFilesPage(currentPage + 1);
            }
        };

        container._paginationListener = listener;
        container.addEventListener('click', listener);
    },

    updatePaginationControls(totalItems = 0) {
        const paginationContainer = document.getElementById('auth-files-pagination');
        const infoEl = document.getElementById('auth-files-pagination-info');
        if (!paginationContainer || !infoEl) return;

        const prevBtn = paginationContainer.querySelector('button[data-action=\"prev\"]');
        const nextBtn = paginationContainer.querySelector('button[data-action=\"next\"]');
        const pageSize = this.authFilesPagination?.pageSize || 9;
        const totalPages = this.authFilesPagination?.totalPages || 1;
        const currentPage = Math.min(this.authFilesPagination?.currentPage || 1, totalPages);
        const shouldShow = totalItems > pageSize;

        paginationContainer.style.display = shouldShow ? 'flex' : 'none';

        const infoParams = totalItems === 0
            ? { current: 0, total: 0, count: 0 }
            : { current: currentPage, total: totalPages, count: totalItems };
        infoEl.textContent = i18n.t('auth_files.pagination_info', infoParams);

        if (prevBtn) {
            prevBtn.disabled = currentPage <= 1;
        }
        if (nextBtn) {
            nextBtn.disabled = currentPage >= totalPages;
        }
    },

    updateFilterButtons(existingTypes) {
        const filterContainer = document.querySelector('.auth-file-filter');
        if (!filterContainer) return;

        const predefinedTypes = [
            { type: 'all', labelKey: 'auth_files.filter_all' },
            { type: 'qwen', labelKey: 'auth_files.filter_qwen' },
            { type: 'gemini', labelKey: 'auth_files.filter_gemini' },
            { type: 'gemini-cli', labelKey: 'auth_files.filter_gemini-cli' },
            { type: 'aistudio', labelKey: 'auth_files.filter_aistudio' },
            { type: 'claude', labelKey: 'auth_files.filter_claude' },
            { type: 'codex', labelKey: 'auth_files.filter_codex' },
            { type: 'antigravity', labelKey: 'auth_files.filter_antigravity' },
            { type: 'iflow', labelKey: 'auth_files.filter_iflow' },
            { type: 'vertex', labelKey: 'auth_files.filter_vertex' },
            { type: 'empty', labelKey: 'auth_files.filter_empty' }
        ];

        const existingButtons = filterContainer.querySelectorAll('.filter-btn');
        const existingButtonTypes = new Set();
        existingButtons.forEach(btn => {
            existingButtonTypes.add(btn.dataset.type);
        });

        existingButtons.forEach(btn => {
            const btnType = btn.dataset.type;
            if (existingTypes.has(btnType)) {
                btn.style.display = 'inline-block';
                const match = predefinedTypes.find(item => item.type === btnType);
                if (match) {
                    btn.textContent = i18n.t(match.labelKey);
                    btn.setAttribute('data-i18n-text', match.labelKey);
                }
            } else {
                btn.style.display = 'none';
            }
        });

        const predefinedTypeSet = new Set(predefinedTypes.map(t => t.type));
        existingTypes.forEach(type => {
            if (type !== 'all' && !predefinedTypeSet.has(type) && !existingButtonTypes.has(type)) {
                const btn = document.createElement('button');
                btn.className = 'filter-btn';
                btn.dataset.type = type;

                const match = predefinedTypes.find(item => item.type === type);
                if (match) {
                    btn.setAttribute('data-i18n-text', match.labelKey);
                    btn.textContent = i18n.t(match.labelKey);
                } else {
                    const dynamicKey = `auth_files.filter_${type}`;
                    btn.setAttribute('data-i18n-text', dynamicKey);
                    btn.textContent = this.generateDynamicTypeLabel(type);
                }

                const emptyBtn = filterContainer.querySelector('[data-type=\"empty\"]');
                if (emptyBtn) {
                    filterContainer.insertBefore(btn, emptyBtn);
                } else {
                    filterContainer.appendChild(btn);
                }
            }
        });
    },

    handleFilterClick(clickedBtn, options = {}) {
        if (!clickedBtn) return;
        const { skipRender = false } = options;
        const filterBtns = document.querySelectorAll('.auth-file-filter .filter-btn');

        filterBtns.forEach(b => b.classList.remove('active'));
        clickedBtn.classList.add('active');

        const filterType = clickedBtn.dataset.type;
        this.currentAuthFileFilter = filterType || 'all';

        if (!skipRender) {
            this.authFilesPagination.currentPage = 1;
            this.renderAuthFilesPage(1);
        }

        this.refreshFilterButtonTexts();
        this.renderOauthExcludedModels();
    },

    generateDynamicTypeLabel(type) {
        if (!type) return '';
        const key = `auth_files.type_${type}`;
        const translated = i18n.t(key);
        if (translated && translated !== key) {
            return translated;
        }
        if (type.toLowerCase() === 'iflow') return 'iFlow';
        return type.charAt(0).toUpperCase() + type.slice(1);
    },

    bindAuthFileFilterEvents() {
        const filterContainer = document.querySelector('.auth-file-filter');
        if (!filterContainer) return;

        if (filterContainer._filterListener) {
            filterContainer.removeEventListener('click', filterContainer._filterListener);
        }

        const listener = (event) => {
            const button = event.target.closest('.filter-btn');
            if (!button || !filterContainer.contains(button)) return;
            event.preventDefault();
            this.handleFilterClick(button);
        };

        filterContainer._filterListener = listener;
        filterContainer.addEventListener('click', listener);

        this.refreshFilterButtonTexts();
    },

    applyAuthFileFilterState(shouldRender = false) {
        const filterContainer = document.querySelector('.auth-file-filter');
        if (!filterContainer) return;

        const currentType = this.currentAuthFileFilter || 'all';
        const buttons = filterContainer.querySelectorAll('.filter-btn');
        if (buttons.length === 0) return;

        let targetButton = null;
        buttons.forEach(btn => {
            if (btn.dataset.type === currentType) {
                targetButton = btn;
            }
        });

        if (!targetButton) {
            targetButton = filterContainer.querySelector('.filter-btn[data-type=\"all\"]') || buttons[0];
            if (targetButton) {
                this.currentAuthFileFilter = targetButton.dataset.type || 'all';
            }
        }

        if (targetButton) {
            this.handleFilterClick(targetButton, { skipRender: !shouldRender });
        }
    },

    removeAuthFileElements(filenames = []) {
        if (!Array.isArray(filenames) || filenames.length === 0) {
            return;
        }

        const removalSet = new Set(filenames);
        this.cachedAuthFiles = (this.cachedAuthFiles || []).filter(file => file && !removalSet.has(file.name));

        if (!this.cachedAuthFiles.length) {
            this.authFilesPagination.currentPage = 1;
        }
        this.renderAuthFilesPage(this.authFilesPagination.currentPage);
    },

    refreshFilterButtonTexts() {
        document.querySelectorAll('.auth-file-filter .filter-btn[data-i18n-text]').forEach(btn => {
            const key = btn.getAttribute('data-i18n-text');
            if (key) {
                btn.textContent = i18n.t(key);
            }
        });
    },

    bindAuthFileActionEvents() {
        const container = document.getElementById('auth-files-list');
        if (!container) return;

        const oldListener = container._authFileActionListener;
        if (oldListener) {
            container.removeEventListener('click', oldListener);
        }

        const listener = (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) return;

            const action = button.dataset.action;
            const actionsContainer = button.closest('.item-actions');
            if (!actionsContainer) return;

            const filename = actionsContainer.dataset.filename;
            if (!filename) return;

            switch (action) {
                case 'showDetails':
                    this.showAuthFileDetails(filename);
                    break;
                case 'download':
                    this.downloadAuthFile(filename);
                    break;
                case 'delete':
                    this.deleteAuthFile(filename);
                    break;
            }
        };

        container._authFileActionListener = listener;
        container.addEventListener('click', listener);
    },

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    },

    openVertexFilePicker() {
        const fileInput = document.getElementById('vertex-file-input');
        if (fileInput) {
            fileInput.click();
        }
    },

    handleVertexFileSelection(event) {
        const fileInput = event?.target;
        const file = fileInput?.files?.[0] || null;

        if (fileInput) {
            fileInput.value = '';
        }

        if (file && !file.name.toLowerCase().endsWith('.json')) {
            this.showNotification(i18n.t('vertex_import.file_required'), 'error');
            this.vertexImportState.file = null;
            this.updateVertexFileDisplay();
            this.updateVertexImportButtonState();
            return;
        }

        this.vertexImportState.file = file;
        this.updateVertexFileDisplay(file ? file.name : '');
        this.updateVertexImportButtonState();
    },

    updateVertexFileDisplay(filename = '') {
        const displayInput = document.getElementById('vertex-file-display');
        if (!displayInput) return;
        displayInput.value = filename || '';
    },

    updateVertexImportButtonState() {
        const importBtn = document.getElementById('vertex-import-btn');
        if (!importBtn) return;
        const disabled = !this.vertexImportState.file || this.vertexImportState.loading;
        importBtn.disabled = disabled;
    },

    async importVertexCredential() {
        if (!this.vertexImportState.file) {
            this.showNotification(i18n.t('vertex_import.file_required'), 'error');
            return;
        }

        const locationInput = document.getElementById('vertex-location');
        const location = locationInput ? locationInput.value.trim() : '';
        const formData = new FormData();
        formData.append('file', this.vertexImportState.file, this.vertexImportState.file.name);
        if (location) {
            formData.append('location', location);
        }

        try {
            this.vertexImportState.loading = true;
            this.updateVertexImportButtonState();

            const response = await this.apiClient.requestRaw('/vertex/import', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData?.message || errorData?.error || errorMessage;
                } catch (parseError) {
                    const text = await response.text();
                    if (text) {
                        errorMessage = text;
                    }
                }
                throw new Error(errorMessage);
            }

            const result = await response.json();
            this.vertexImportState.result = result;
            this.renderVertexImportResult(result);
            this.showNotification(i18n.t('vertex_import.success'), 'success');
            this.vertexImportState.file = null;
            this.updateVertexFileDisplay('');
        } catch (error) {
            console.error('Vertex credential import failed:', error);
            this.showNotification(`${i18n.t('notification.import_failed')}: ${error.message}`, 'error');
        } finally {
            this.vertexImportState.loading = false;
            this.updateVertexImportButtonState();
            const fileInput = document.getElementById('vertex-file-input');
            if (fileInput) {
                fileInput.value = '';
            }
        }
    },

    renderVertexImportResult(result = null) {
        const container = document.getElementById('vertex-import-result');
        const projectEl = document.getElementById('vertex-result-project');
        const emailEl = document.getElementById('vertex-result-email');
        const locationEl = document.getElementById('vertex-result-location');
        const fileEl = document.getElementById('vertex-result-file');
        if (!container || !projectEl || !emailEl || !locationEl || !fileEl) return;

        if (!result) {
            container.style.display = 'none';
            this.vertexImportState.result = null;
            return;
        }

        this.vertexImportState.result = result;
        projectEl.textContent = result.project || '-';
        emailEl.textContent = result.email || '-';
        locationEl.textContent = result.location || '-';
        fileEl.textContent = result.file || '-';
        container.style.display = 'block';
    },

    showAuthFileDetails(filename, content) {
        const file = (this.cachedAuthFiles || []).find(f => f && f.name === filename);
        if (!file) return;

        const stats = this.resolveAuthFileStats(file, this.authFileStatsCache || {});
        const size = typeof file.size === 'number' ? this.formatFileSize(file.size) : '-';
        const provider = file.provider || '-';
        const type = file.type || '-';
        const createdAt = file.created_at ? new Date(file.created_at).toLocaleString('zh-CN') : '-';

        const jsonContent = content || JSON.stringify(file, null, 2);

        // 使用独立的 JSON 弹窗样式，避免被通用 .modal 的 display:none 覆盖
        const modalHtml = `
            <div class="json-modal" id="json-modal">
                <div class="json-modal-content">
                    <div class="json-modal-header">
                        <h3>${this.escapeHtml(filename)}</h3>
                    </div>
                    <div class="json-modal-body">
                        <pre class="json-content">${this.escapeHtml(jsonContent)}</pre>
                    </div>
                    <div class="json-modal-footer">
                        <button class="btn btn-secondary" data-action="copy">
                            <i class="fas fa-copy"></i>
                            ${i18n.t('common.copy')}
                        </button>
                        <button class="btn btn-secondary" data-action="close">
                            ${i18n.t('common.close')}
                        </button>
                    </div>
                </div>
            </div>
        `;

        const oldModal = document.getElementById('json-modal');
        if (oldModal) {
            oldModal.remove();
        }

        document.body.insertAdjacentHTML('beforeend', modalHtml);
        const modal = document.getElementById('json-modal');

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeJsonModal();
            }
        });

        this.bindJsonModalEvents(modal);
    },

    bindJsonModalEvents(modal) {
        modal.addEventListener('click', (e) => {
            const button = e.target.closest('button[data-action]');
            if (!button) return;

            const action = button.dataset.action;
            switch (action) {
                case 'copy':
                    this.copyJsonContent();
                    break;
                case 'close':
                    this.closeJsonModal();
                    break;
            }
        });
    },

    closeJsonModal() {
        const modal = document.getElementById('json-modal');
        if (modal) {
            modal.remove();
        }
    },

    copyJsonContent() {
        const jsonContent = document.querySelector('.json-content');
        if (jsonContent) {
            const text = jsonContent.textContent;
            navigator.clipboard.writeText(text).then(() => {
                this.showNotification('内容已复制到剪贴板', 'success');
            }).catch(() => {
                this.showNotification('复制失败', 'error');
            });
        }
    },

    async downloadAuthFile(filename) {
        try {
            const response = await this.apiClient.requestRaw(`/auth-files/download?name=${encodeURIComponent(filename)}`);

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
            this.showNotification(`${i18n.t('notification.download_failed')}: ${error.message}`, 'error');
        }
    },

    async deleteAuthFile(filename) {
        if (!confirm(`${i18n.t('auth_files.delete_confirm')} "${filename}" 吗？`)) return;

        try {
            await this.makeRequest(`/auth-files?name=${encodeURIComponent(filename)}`, { method: 'DELETE' });
            this.removeAuthFileElements([filename]);
            this.clearCache();
            await this.loadAuthFiles();
            this.showNotification(i18n.t('auth_files.delete_success'), 'success');
        } catch (error) {
            this.showNotification(`${i18n.t('notification.delete_failed')}: ${error.message}`, 'error');
        }
    },

    async deleteAllAuthFiles() {
        const filterType = (this.currentAuthFileFilter || 'all').toLowerCase();
        const isFiltered = filterType !== 'all';
        const typeLabel = this.generateDynamicTypeLabel(filterType);
        const confirmMessage = isFiltered
            ? i18n.t('auth_files.delete_filtered_confirm').replace('{type}', typeLabel)
            : i18n.t('auth_files.delete_all_confirm');

        if (!confirm(confirmMessage)) return;

        try {
            if (!isFiltered) {
                const response = await this.makeRequest('/auth-files?all=true', { method: 'DELETE' });
                const currentNames = (this.cachedAuthFiles || []).map(file => file.name).filter(Boolean);
                if (currentNames.length > 0) {
                    this.removeAuthFileElements(currentNames);
                }
                this.clearCache();
                this.currentAuthFileFilter = 'all';
                await this.loadAuthFiles();
                this.showNotification(`${i18n.t('auth_files.delete_all_success')} ${response.deleted} ${i18n.t('auth_files.files_count')}`, 'success');
                return;
            }

            const deletableFiles = (this.cachedAuthFiles || []).filter(file => {
                if (!file || file.runtime_only) return false;
                const fileType = (file.type || 'unknown').toLowerCase();
                return fileType === filterType;
            });

            if (deletableFiles.length === 0) {
                this.showNotification(i18n.t('auth_files.delete_filtered_none').replace('{type}', typeLabel), 'info');
                return;
            }

            let success = 0;
            let failed = 0;
            const deletedNames = [];

            for (const file of deletableFiles) {
                try {
                    await this.makeRequest(`/auth-files?name=${encodeURIComponent(file.name)}`, { method: 'DELETE' });
                    success++;
                    deletedNames.push(file.name);
                } catch (error) {
                    console.error('删除认证文件失败:', file?.name, error);
                    failed++;
                }
            }

            if (deletedNames.length > 0) {
                this.removeAuthFileElements(deletedNames);
            }

            this.clearCache();
            this.currentAuthFileFilter = 'all';
            await this.loadAuthFiles();

            if (failed === 0) {
                const successMsg = i18n.t('auth_files.delete_filtered_success')
                    .replace('{count}', success)
                    .replace('{type}', typeLabel);
                this.showNotification(successMsg, 'success');
            } else {
                const warningMsg = i18n.t('auth_files.delete_filtered_partial')
                    .replace('{success}', success)
                    .replace('{failed}', failed)
                    .replace('{type}', typeLabel);
                this.showNotification(warningMsg, 'warning');
            }
        } catch (error) {
            this.showNotification(`${i18n.t('notification.delete_failed')}: ${error.message}`, 'error');
        }
    },

    // 触发文件上传选择器
    uploadAuthFile() {
        const authFileInput = document.getElementById('auth-file-input');
        if (authFileInput) {
            authFileInput.click();
        }
    },

    // 处理文件上传
    async handleFileUpload(event) {
        const input = event?.target;
        const files = Array.from(input?.files || []);
        if (input) {
            input.value = '';
        }
        if (!files.length) return;

        const validFiles = [];
        const invalidFiles = [];
        files.forEach(file => {
            if (file && file.name.endsWith('.json')) {
                validFiles.push(file);
            } else if (file) {
                invalidFiles.push(file.name);
            }
        });

        if (invalidFiles.length) {
            this.showNotification(i18n.t('auth_files.upload_error_json'), 'error');
        }
        if (!validFiles.length) return;

        let successCount = 0;
        const failed = [];

        for (const file of validFiles) {
            try {
                await this.uploadSingleAuthFile(file);
                successCount++;
            } catch (error) {
                failed.push({ name: file.name, message: error.message });
            }
        }

        if (successCount > 0) {
            this.clearCache();
            await this.loadAuthFiles();
            const suffix = validFiles.length > 1 ? ` (${successCount}/${validFiles.length})` : '';
            this.showNotification(`${i18n.t('auth_files.upload_success')}${suffix}`, failed.length ? 'warning' : 'success');
        }

        if (failed.length) {
            const details = failed.map(item => `${item.name}: ${item.message}`).join('; ');
            this.showNotification(`${i18n.t('notification.upload_failed')}: ${details}`, 'error');
        }
    },

    async uploadSingleAuthFile(file) {
        const formData = new FormData();
        formData.append('file', file, file.name);

        const response = await this.apiClient.requestRaw('/auth-files', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }
    },

    normalizeOauthExcludedMap(payload = {}) {
        const raw = (payload && (payload['oauth-excluded-models'] || payload.items)) || payload || {};
        if (!raw || typeof raw !== 'object') {
            return {};
        }
        const normalized = {};
        Object.entries(raw).forEach(([provider, models]) => {
            const key = typeof provider === 'string' ? provider.trim() : '';
            if (!key) return;
            const list = Array.isArray(models)
                ? models.map(item => String(item || '').trim()).filter(Boolean)
                : [];
            normalized[key.toLowerCase()] = list;
        });
        return normalized;
    },

    resolveOauthExcludedFromConfig(config = null) {
        const sources = [];
        if (config && typeof config === 'object') {
            sources.push(config);
        }
        if (this.configCache && typeof this.configCache === 'object') {
            if (this.configCache['oauth-excluded-models'] !== undefined) {
                sources.push({ 'oauth-excluded-models': this.configCache['oauth-excluded-models'] });
            }
            if (this.configCache['__full__']) {
                sources.push(this.configCache['__full__']);
            }
        }

        for (const source of sources) {
            if (!source || typeof source !== 'object') continue;
            if (Object.prototype.hasOwnProperty.call(source, 'oauth-excluded-models')) {
                return {
                    map: this.normalizeOauthExcludedMap(source),
                    found: true
                };
            }
        }

        return { map: {}, found: false };
    },

    applyOauthExcludedFromConfig(config = null, options = {}) {
        const { render = true } = options || {};
        const { map, found } = this.resolveOauthExcludedFromConfig(config);
        if (!found) {
            return false;
        }

        this.oauthExcludedModels = map;
        this._oauthExcludedLoading = false;
        this.setOauthExcludedStatus('');
        this.updateOauthExcludedButtonsState(false);
        if (render) {
            this.renderOauthExcludedModels();
        }
        return true;
    },

    getFilteredOauthExcludedMap(filterType = this.currentAuthFileFilter) {
        const map = this.oauthExcludedModels || {};
        if (!map || typeof map !== 'object') {
            return {};
        }
        const type = (filterType || 'all').toLowerCase();
        if (type === 'all') {
            return map;
        }
        const result = {};
        Object.entries(map).forEach(([provider, models]) => {
            if ((provider || '').toLowerCase() === type) {
                result[provider] = models;
            }
        });
        return result;
    },

    findOauthExcludedEntry(provider) {
        if (!provider || provider === 'all') {
            return null;
        }
        const normalized = provider.toLowerCase();
        const map = this.oauthExcludedModels || {};
        for (const [key, models] of Object.entries(map)) {
            if ((key || '').toLowerCase() === normalized) {
                return { provider: key, models: Array.isArray(models) ? models : [] };
            }
        }
        return null;
    },

    setOauthExcludedForm(provider = '', models = null) {
        const providerSelect = document.getElementById('oauth-excluded-provider-select');
        const modelsInput = document.getElementById('oauth-excluded-models');

        const normalizedProvider = (provider || '').trim();
        if (providerSelect) {
            const options = Array.from(providerSelect.options || []);
            let match = options.find(opt => (opt.value || '').toLowerCase() === normalizedProvider.toLowerCase());
            if (!match && normalizedProvider) {
                match = new Option(this.generateDynamicTypeLabel(normalizedProvider) || normalizedProvider, normalizedProvider);
                providerSelect.appendChild(match);
            }
            if (normalizedProvider && match) {
                providerSelect.value = match.value;
            } else {
                providerSelect.value = 'auto';
            }
        }

        if (modelsInput && models !== null && models !== undefined) {
            const list = Array.isArray(models) ? models : [];
            modelsInput.value = list.map(item => item || '').join('\n');
        }
    },

    syncOauthExcludedFormWithFilter(overrideModels = false) {
        const filterType = (this.currentAuthFileFilter || 'all').toLowerCase();
        const entry = this.findOauthExcludedEntry(filterType);

        if (filterType === 'all') {
            if (overrideModels) {
                if (entry) {
                    this.setOauthExcludedForm(entry.provider, entry.models);
                } else {
                    this.setOauthExcludedForm('', '');
                }
            }
            return;
        }

        if (overrideModels) {
            this.setOauthExcludedForm(filterType, entry ? entry.models : []);
        } else {
            this.setOauthExcludedForm(filterType);
        }
    },

    getOauthExcludedProviderValue() {
        const providerSelect = document.getElementById('oauth-excluded-provider-select');
        const filterFallback = (this.currentAuthFileFilter && this.currentAuthFileFilter !== 'all')
            ? this.currentAuthFileFilter
            : '';

        let selected = (providerSelect && providerSelect.value) ? providerSelect.value.trim() : '';
        if (!selected || selected === 'auto') {
            return filterFallback;
        }
        return selected;
    },

    refreshOauthProviderOptions() {
        const providerSelect = document.getElementById('oauth-excluded-provider-select');
        if (!providerSelect) return;

        const allowedProviders = ['gemini-cli', 'vertex', 'aistudio', 'antigravity', 'claude', 'codex', 'qwen', 'iflow'];
        const mapProviders = Object.keys(this.oauthExcludedModels || {});
        const filterType = (this.currentAuthFileFilter || '').toLowerCase();
        const providers = Array.from(new Set([...allowedProviders, ...mapProviders].filter(Boolean)));

        const prevValue = providerSelect.value || 'auto';

        providerSelect.innerHTML = '';
        const addOption = (value, textKey, fallbackText = null) => {
            const opt = document.createElement('option');
            opt.value = value;
            if (textKey) {
                opt.setAttribute('data-i18n-text', textKey);
                opt.textContent = i18n.t(textKey);
            } else {
                opt.textContent = fallbackText || value;
            }
            providerSelect.appendChild(opt);
        };

        addOption('auto', 'oauth_excluded.provider_auto');
        providers.sort((a, b) => a.localeCompare(b)).forEach(item => addOption(item, null, this.generateDynamicTypeLabel(item) || item));

        const restoreValue = (() => {
            if (prevValue && Array.from(providerSelect.options).some(opt => opt.value === prevValue)) {
                return prevValue;
            }
            if (filterType && Array.from(providerSelect.options).some(opt => opt.value === filterType)) {
                return filterType;
            }
            return 'auto';
        })();
        providerSelect.value = restoreValue;
    },

    parseOauthExcludedModelsInput(input = '') {
        const tokens = (input || '').split(/[\n,]/).map(token => token.trim()).filter(Boolean);
        const unique = [];
        tokens.forEach(token => {
            if (!unique.includes(token)) {
                unique.push(token);
            }
        });
        return unique;
    },

    openOauthExcludedEditor(provider = '', models = null) {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        if (!modal || !modalBody) return;

        const normalizedProvider = (provider || '').trim();
        const fallbackProvider = normalizedProvider
            || ((this.currentAuthFileFilter && this.currentAuthFileFilter !== 'all') ? this.currentAuthFileFilter : '');
        let targetModels = models;

        if ((targetModels === null || targetModels === undefined) && fallbackProvider) {
            const existing = this.findOauthExcludedEntry(fallbackProvider);
            if (existing) {
                targetModels = existing.models;
            }
        }

        modalBody.innerHTML = `
            <h3>${fallbackProvider
                ? i18n.t('oauth_excluded.edit_title', { provider: this.generateDynamicTypeLabel(fallbackProvider) })
                : i18n.t('oauth_excluded.add_title')
            }</h3>
            <div class="provider-item oauth-excluded-editor-card">
                <div class="item-content">
                    <div class="form-group">
                        <label for="oauth-excluded-provider-select" data-i18n="oauth_excluded.provider_label">${i18n.t('oauth_excluded.provider_label')}</label>
                        <select id="oauth-excluded-provider-select"></select>
                        <p class="form-hint" data-i18n="oauth_excluded.provider_hint">${i18n.t('oauth_excluded.provider_hint')}</p>
                    </div>
                    <div class="form-group">
                        <label for="oauth-excluded-models" data-i18n="oauth_excluded.models_label">${i18n.t('oauth_excluded.models_label')}</label>
                        <textarea id="oauth-excluded-models" rows="5" data-i18n-placeholder="oauth_excluded.models_placeholder" placeholder="${i18n.t('oauth_excluded.models_placeholder')}"></textarea>
                        <p class="form-hint" data-i18n="oauth_excluded.models_hint">${i18n.t('oauth_excluded.models_hint')}</p>
                    </div>
                </div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-primary" id="oauth-excluded-save">
                    <i class="fas fa-save"></i> ${i18n.t('oauth_excluded.save')}
                </button>
                <button class="btn btn-danger" id="oauth-excluded-delete">
                    <i class="fas fa-trash"></i> ${i18n.t('oauth_excluded.delete')}
                </button>
                <button class="btn btn-secondary" onclick="manager.closeModal()">
                    ${i18n.t('common.cancel')}
                </button>
            </div>
        `;

        this.refreshOauthProviderOptions();
        this.setOauthExcludedForm(fallbackProvider, targetModels != null ? targetModels : []);
        this.showModal();

        const saveBtn = document.getElementById('oauth-excluded-save');
        if (saveBtn) {
            saveBtn.onclick = () => this.saveOauthExcludedEntry();
        }
        const deleteBtn = document.getElementById('oauth-excluded-delete');
        if (deleteBtn) {
            deleteBtn.onclick = () => this.deleteOauthExcludedEntry();
        }

        const providerSelect = document.getElementById('oauth-excluded-provider-select');
        const syncDeleteState = () => {
            if (deleteBtn) {
                deleteBtn.disabled = !this.getOauthExcludedProviderValue();
            }
        };
        if (providerSelect) {
            providerSelect.addEventListener('change', syncDeleteState);
        }
        syncDeleteState();
        this.updateOauthExcludedButtonsState(false);
    },

    buildOauthExcludedItem(provider, models = []) {
        const providerLabel = this.generateDynamicTypeLabel(provider) || provider;
        const normalizedModels = Array.isArray(models) ? models.filter(Boolean) : [];
        const tags = normalizedModels.length
            ? normalizedModels.map(model => `<span class="provider-model-tag"><span class="model-name">${this.escapeHtml(String(model))}</span></span>`).join('')
            : `<span class="oauth-excluded-empty">${i18n.t('oauth_excluded.no_models')}</span>`;
        const modelCount = normalizedModels.length;

        return `
            <div class="provider-item oauth-excluded-card" data-provider="${this.escapeHtml(provider)}">
                <div class="item-content">
                    <div class="item-title">${this.escapeHtml(providerLabel)}</div>
                    <div class="item-meta">
                        <span class="item-subtitle">
                            ${modelCount > 0
                                ? i18n.t('oauth_excluded.model_count', { count: modelCount })
                                : i18n.t('oauth_excluded.no_models')}
                        </span>
                    </div>
                    <div class="provider-models oauth-excluded-tags">
                        ${tags}
                    </div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary" data-action="edit" data-provider="${this.escapeHtml(provider)}">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button class="btn btn-danger" data-action="delete" data-provider="${this.escapeHtml(provider)}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    },

    renderOauthExcludedModels(filterType = this.currentAuthFileFilter) {
        const container = document.getElementById('oauth-excluded-list');
        const scopeEl = document.getElementById('oauth-excluded-scope');
        if (!container) return;

        const currentType = (filterType || 'all').toLowerCase();
        const map = this.getFilteredOauthExcludedMap(currentType);
        const providers = Object.keys(map || {});

        if (scopeEl) {
            const label = currentType === 'all'
                ? i18n.t('oauth_excluded.scope_all')
                : i18n.t('oauth_excluded.scope_provider', { provider: this.generateDynamicTypeLabel(currentType) });
            scopeEl.textContent = label;
        }

        if (!this.isConnected) {
            container.innerHTML = `<div class="oauth-excluded-empty">${i18n.t('oauth_excluded.disconnected')}</div>`;
            return;
        }

        if (this._oauthExcludedLoading) {
            container.innerHTML = `<div class="loading-placeholder">${i18n.t('common.loading')}</div>`;
            return;
        }

        if (!providers.length) {
            const emptyKey = currentType === 'all'
                ? 'oauth_excluded.list_empty_all'
                : 'oauth_excluded.list_empty_filtered';
            container.innerHTML = `<div class="oauth-excluded-empty">${i18n.t(emptyKey)}</div>`;
            return;
        }

        const itemsHtml = providers
            .sort((a, b) => a.localeCompare(b))
            .map(provider => this.buildOauthExcludedItem(provider, map[provider]))
            .join('');
        container.innerHTML = itemsHtml;
        this.refreshOauthProviderOptions();
        this.bindOauthExcludedActionEvents();
    },

    bindOauthExcludedActionEvents() {
        const container = document.getElementById('oauth-excluded-list');
        if (!container) return;

        if (container._oauthExcludedListener) {
            container.removeEventListener('click', container._oauthExcludedListener);
        }

        const listener = (event) => {
            const button = event.target.closest('button[data-action]');
            if (!button || !container.contains(button)) return;
            const provider = button.dataset.provider;
            if (!provider) return;

            const entry = this.findOauthExcludedEntry(provider);
            if (button.dataset.action === 'edit') {
                this.openOauthExcludedEditor(provider, entry ? entry.models : []);
            } else if (button.dataset.action === 'delete') {
                this.deleteOauthExcludedEntry(provider);
            }
        };

        container._oauthExcludedListener = listener;
        container.addEventListener('click', listener);
    },

    updateOauthExcludedButtonsState(isLoading = false) {
        const refreshBtn = document.getElementById('oauth-excluded-refresh');
        const saveBtn = document.getElementById('oauth-excluded-save');
        const deleteBtn = document.getElementById('oauth-excluded-delete');
        const addBtn = document.getElementById('oauth-excluded-add');
        const disabled = isLoading || !this.isConnected;
        [refreshBtn, saveBtn, deleteBtn, addBtn].forEach(btn => {
            if (btn) {
                btn.disabled = disabled;
            }
        });
    },

    setOauthExcludedStatus(message = '') {
        const statusEl = document.getElementById('oauth-excluded-status');
        if (statusEl) {
            statusEl.textContent = message || '';
        }
    },

    async loadOauthExcludedModels(forceRefresh = false) {
        if (!this.isConnected) {
            this.renderOauthExcludedModels();
            this.updateOauthExcludedButtonsState();
            return;
        }

        if (this._oauthExcludedLoading) {
            return;
        }

        this._oauthExcludedLoading = true;
        this.updateOauthExcludedButtonsState(true);
        this.setOauthExcludedStatus(i18n.t('oauth_excluded.refreshing'));
        this.renderOauthExcludedModels();

        try {
            let targetMap = {};
            let hasData = false;

            if (!forceRefresh) {
                const { map, found } = this.resolveOauthExcludedFromConfig();
                if (found) {
                    targetMap = map;
                    hasData = true;
                }
            }

            if (!hasData) {
                try {
                    const configSection = await this.getConfig('oauth-excluded-models', forceRefresh);
                    if (configSection !== undefined) {
                        targetMap = this.normalizeOauthExcludedMap(configSection);
                        hasData = true;
                    }
                } catch (configError) {
                    console.warn('从配置获取 OAuth 排除列表失败，尝试回退接口:', configError);
                }
            }

            if (!hasData) {
                const data = await this.makeRequest('/oauth-excluded-models');
                targetMap = this.normalizeOauthExcludedMap(data);
                hasData = true;
            }

            this.oauthExcludedModels = targetMap;
            this.setOauthExcludedStatus('');
        } catch (error) {
            console.error('加载 OAuth 排除列表失败:', error);
            const message = `${i18n.t('oauth_excluded.load_failed')}: ${error.message}`;
            this.setOauthExcludedStatus(message);
            this.showNotification(message, 'error');
        } finally {
            this._oauthExcludedLoading = false;
            this.updateOauthExcludedButtonsState(false);
            this.renderOauthExcludedModels();
        }
    },

    async saveOauthExcludedEntry() {
        if (!this.isConnected) {
            this.showNotification(i18n.t('notification.connection_required'), 'error');
            return;
        }
        const modelsInput = document.getElementById('oauth-excluded-models');
        if (!modelsInput) return;

        const providerValue = this.getOauthExcludedProviderValue();
        if (!providerValue) {
            this.showNotification(i18n.t('oauth_excluded.provider_required'), 'error');
            return;
        }

        const models = this.parseOauthExcludedModelsInput(modelsInput.value);
        this.updateOauthExcludedButtonsState(true);
        this.setOauthExcludedStatus(i18n.t('oauth_excluded.saving'));

        try {
            await this.makeRequest('/oauth-excluded-models', {
                method: 'PATCH',
                body: JSON.stringify({
                    provider: providerValue,
                    models
                })
            });
            const successKey = models.length === 0 ? 'oauth_excluded.delete_success' : 'oauth_excluded.save_success';
            this.showNotification(i18n.t(successKey), 'success');
            this.clearCache('oauth-excluded-models');
            await this.loadOauthExcludedModels(true);
            this.closeModal();
        } catch (error) {
            this.showNotification(`${i18n.t('oauth_excluded.save_failed')}: ${error.message}`, 'error');
        } finally {
            this.setOauthExcludedStatus('');
            this.updateOauthExcludedButtonsState(false);
        }
    },

    async deleteOauthExcludedEntry(providerOverride = null) {
        if (!this.isConnected) {
            this.showNotification(i18n.t('notification.connection_required'), 'error');
            return;
        }
        const providerValue = (providerOverride || this.getOauthExcludedProviderValue() || '').trim();

        if (!providerValue) {
            this.showNotification(i18n.t('oauth_excluded.provider_required'), 'error');
            return;
        }

        if (!confirm(i18n.t('oauth_excluded.delete_confirm', { provider: providerValue }))) {
            return;
        }

        this.updateOauthExcludedButtonsState(true);
        this.setOauthExcludedStatus(i18n.t('oauth_excluded.deleting'));

        try {
            await this.makeRequest(`/oauth-excluded-models?provider=${encodeURIComponent(providerValue)}`, { method: 'DELETE' });
            this.showNotification(i18n.t('oauth_excluded.delete_success'), 'success');
            this.clearCache('oauth-excluded-models');
            await this.loadOauthExcludedModels(true);
            this.closeModal();
        } catch (error) {
            this.showNotification(`${i18n.t('oauth_excluded.delete_failed')}: ${error.message}`, 'error');
        } finally {
            this.setOauthExcludedStatus('');
            this.updateOauthExcludedButtonsState(false);
        }
    },

    registerAuthFilesListeners() {
        if (!this.events || typeof this.events.on !== 'function') {
            return;
        }
        this.events.on('data:config-loaded', async (event) => {
            const detail = event?.detail || {};
            const config = detail.config || {};
            const keyStats = detail.keyStats || null;
            try {
                await this.loadAuthFiles(keyStats);
            } catch (error) {
                console.error('加载认证文件失败:', error);
            }
            try {
                const applied = this.applyOauthExcludedFromConfig(config, { render: true });
                if (!applied) {
                    await this.loadOauthExcludedModels(true);
                }
            } catch (error) {
                console.error('加载 OAuth 排除列表失败:', error);
            }
        });

        this.events.on('connection:status-changed', (event) => {
            const detail = event?.detail || {};
            this.updateOauthExcludedButtonsState(false);
            if (detail.isConnected) {
                if (!this.applyOauthExcludedFromConfig(null, { render: true })) {
                    this.renderOauthExcludedModels();
                }
            } else {
                this.renderOauthExcludedModels();
            }
        });
    }
};
