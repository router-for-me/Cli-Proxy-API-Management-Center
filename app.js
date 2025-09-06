// CLI Proxy API 管理界面 JavaScript
class CLIProxyManager {
    constructor() {
        // 仅保存基础地址（不含 /v0/management），请求时自动补齐
        this.apiBase = 'http://localhost:8317';
        this.apiUrl = this.computeApiUrl(this.apiBase);
        this.managementKey = '';
        this.isConnected = false;
        
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

    init() {
        this.bindEvents();
        this.loadSettings();
        this.setupNavigation();
    }

    // 事件绑定
    bindEvents() {
        // 认证相关
        document.getElementById('test-connection').addEventListener('click', () => this.testConnection());
        document.getElementById('toggle-key-visibility').addEventListener('click', () => this.toggleKeyVisibility());
        
        // 连接状态检查
        document.getElementById('connection-status').addEventListener('click', () => this.checkConnectionStatus());
        document.getElementById('refresh-all').addEventListener('click', () => this.refreshAllData());
        
        // 基础设置
        document.getElementById('debug-toggle').addEventListener('change', (e) => this.updateDebug(e.target.checked));
        document.getElementById('update-proxy').addEventListener('click', () => this.updateProxyUrl());
        document.getElementById('clear-proxy').addEventListener('click', () => this.clearProxyUrl());
        document.getElementById('update-retry').addEventListener('click', () => this.updateRequestRetry());
        document.getElementById('switch-project-toggle').addEventListener('change', (e) => this.updateSwitchProject(e.target.checked));
        document.getElementById('switch-preview-model-toggle').addEventListener('change', (e) => this.updateSwitchPreviewModel(e.target.checked));
        document.getElementById('allow-localhost-toggle').addEventListener('change', (e) => this.updateAllowLocalhost(e.target.checked));
        
        // API 密钥管理
        document.getElementById('add-api-key').addEventListener('click', () => this.showAddApiKeyModal());
        document.getElementById('add-gemini-key').addEventListener('click', () => this.showAddGeminiKeyModal());
        document.getElementById('add-codex-key').addEventListener('click', () => this.showAddCodexKeyModal());
        document.getElementById('add-claude-key').addEventListener('click', () => this.showAddClaudeKeyModal());
        document.getElementById('add-openai-provider').addEventListener('click', () => this.showAddOpenAIProviderModal());
        
        // 认证文件管理
        document.getElementById('upload-auth-file').addEventListener('click', () => this.uploadAuthFile());
        document.getElementById('delete-all-auth-files').addEventListener('click', () => this.deleteAllAuthFiles());
        document.getElementById('auth-file-input').addEventListener('change', (e) => this.handleFileUpload(e));
        
        // 模态框
        document.querySelector('.close').addEventListener('click', () => this.closeModal());
        window.addEventListener('click', (e) => {
            if (e.target === document.getElementById('modal')) {
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

    // 加载设置
    loadSettings() {
        const savedBase = localStorage.getItem('apiBase');
        const savedUrl = localStorage.getItem('apiUrl');
        const savedKey = localStorage.getItem('managementKey');
        
        if (savedBase) {
            this.setApiBase(savedBase);
            document.getElementById('api-url').value = this.apiBase;
        } else if (savedUrl) {
            const base = (savedUrl || '').replace(/\/?v0\/management\/?$/i, '');
            this.setApiBase(base);
            document.getElementById('api-url').value = this.apiBase;
        } else {
            this.setApiBase(this.apiBase);
            document.getElementById('api-url').value = this.apiBase;
        }
        
        if (savedKey) {
            document.getElementById('management-key').value = savedKey;
            this.managementKey = savedKey;
        }
        
        // 监听API URL和密钥变化
        const apiInput = document.getElementById('api-url');
        const keyInput = document.getElementById('management-key');

        const saveBase = (val) => this.setApiBase(val);
        const saveBaseDebounced = this.debounce(saveBase, 500);

        apiInput.addEventListener('change', (e) => saveBase(e.target.value));
        apiInput.addEventListener('input', (e) => saveBaseDebounced(e.target.value));

        const saveKey = (val) => {
            this.managementKey = val;
            localStorage.setItem('managementKey', this.managementKey);
        };
        const saveKeyDebounced = this.debounce(saveKey, 500);

        keyInput.addEventListener('change', (e) => saveKey(e.target.value));
        keyInput.addEventListener('input', (e) => saveKeyDebounced(e.target.value));
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

    // 测试连接
    async testConnection() {
        const button = document.getElementById('test-connection');
        const originalText = button.innerHTML;
        
        button.innerHTML = '<div class="loading"></div> 连接中...';
        button.disabled = true;
        
        try {
            await this.makeRequest('/debug');
            this.isConnected = true;
            this.showNotification('连接成功！', 'success');
            this.updateConnectionStatus();
            await this.loadAllData();
        } catch (error) {
            this.isConnected = false;
            this.showNotification(`连接失败: ${error.message}`, 'error');
            this.updateConnectionStatus();
        } finally {
            button.innerHTML = originalText;
            button.disabled = false;
        }
    }

    // 更新连接状态
    updateConnectionStatus() {
        const statusButton = document.getElementById('connection-status');
        const apiStatus = document.getElementById('api-status');
        const lastUpdate = document.getElementById('last-update');
        
        if (this.isConnected) {
            statusButton.innerHTML = '<i class="fas fa-circle connection-indicator connected"></i> 已连接';
            statusButton.className = 'btn btn-success';
            apiStatus.textContent = '已连接';
        } else {
            statusButton.innerHTML = '<i class="fas fa-circle connection-indicator disconnected"></i> 未连接';
            statusButton.className = 'btn btn-danger';
            apiStatus.textContent = '未连接';
        }
        
        lastUpdate.textContent = new Date().toLocaleString('zh-CN');
    }

    // 检查连接状态
    async checkConnectionStatus() {
        await this.testConnection();
    }

    // 刷新所有数据
    async refreshAllData() {
        if (!this.isConnected) {
            this.showNotification('请先建立连接', 'error');
            return;
        }
        
        const button = document.getElementById('refresh-all');
        const originalText = button.innerHTML;
        
        button.innerHTML = '<div class="loading"></div> 刷新中...';
        button.disabled = true;
        
        try {
            await this.loadAllData();
            this.showNotification('数据刷新成功', 'success');
        } catch (error) {
            this.showNotification(`刷新失败: ${error.message}`, 'error');
        } finally {
            button.innerHTML = originalText;
            button.disabled = false;
        }
    }

    // 加载所有数据
    async loadAllData() {
        await Promise.all([
            this.loadDebugSettings(),
            this.loadProxySettings(),
            this.loadRetrySettings(),
            this.loadQuotaSettings(),
            this.loadLocalhostSettings(),
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
            const data = await this.makeRequest('/debug');
            document.getElementById('debug-toggle').checked = data.debug;
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
            this.showNotification('调试设置已更新', 'success');
        } catch (error) {
            this.showNotification(`更新调试设置失败: ${error.message}`, 'error');
            // 恢复原状态
            document.getElementById('debug-toggle').checked = !enabled;
        }
    }

    // 加载代理设置
    async loadProxySettings() {
        try {
            const data = await this.makeRequest('/proxy-url');
            document.getElementById('proxy-url').value = data['proxy-url'] || '';
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
            this.showNotification('代理设置已更新', 'success');
        } catch (error) {
            this.showNotification(`更新代理设置失败: ${error.message}`, 'error');
        }
    }

    // 清空代理URL
    async clearProxyUrl() {
        try {
            await this.makeRequest('/proxy-url', { method: 'DELETE' });
            document.getElementById('proxy-url').value = '';
            this.showNotification('代理设置已清空', 'success');
        } catch (error) {
            this.showNotification(`清空代理设置失败: ${error.message}`, 'error');
        }
    }

    // 加载重试设置
    async loadRetrySettings() {
        try {
            const data = await this.makeRequest('/request-retry');
            document.getElementById('request-retry').value = data['request-retry'];
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
            this.showNotification('重试设置已更新', 'success');
        } catch (error) {
            this.showNotification(`更新重试设置失败: ${error.message}`, 'error');
        }
    }

    // 加载配额设置
    async loadQuotaSettings() {
        try {
            const [switchProject, switchPreview] = await Promise.all([
                this.makeRequest('/quota-exceeded/switch-project'),
                this.makeRequest('/quota-exceeded/switch-preview-model')
            ]);
            
            document.getElementById('switch-project-toggle').checked = switchProject['switch-project'];
            document.getElementById('switch-preview-model-toggle').checked = switchPreview['switch-preview-model'];
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
            this.showNotification('项目切换设置已更新', 'success');
        } catch (error) {
            this.showNotification(`更新项目切换设置失败: ${error.message}`, 'error');
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
            this.showNotification('预览模型切换设置已更新', 'success');
        } catch (error) {
            this.showNotification(`更新预览模型切换设置失败: ${error.message}`, 'error');
            document.getElementById('switch-preview-model-toggle').checked = !enabled;
        }
    }

    // 加载本地访问设置
    async loadLocalhostSettings() {
        try {
            const data = await this.makeRequest('/allow-localhost-unauthenticated');
            document.getElementById('allow-localhost-toggle').checked = data['allow-localhost-unauthenticated'];
        } catch (error) {
            console.error('加载本地访问设置失败:', error);
        }
    }

    // 更新本地访问设置
    async updateAllowLocalhost(enabled) {
        try {
            await this.makeRequest('/allow-localhost-unauthenticated', {
                method: 'PUT',
                body: JSON.stringify({ value: enabled })
            });
            this.showNotification('本地访问设置已更新', 'success');
        } catch (error) {
            this.showNotification(`更新本地访问设置失败: ${error.message}`, 'error');
            document.getElementById('allow-localhost-toggle').checked = !enabled;
        }
    }

    // 加载API密钥
    async loadApiKeys() {
        try {
            const data = await this.makeRequest('/api-keys');
            this.renderApiKeys(data['api-keys'] || []);
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
                    <h3>暂无API密钥</h3>
                    <p>点击上方按钮添加第一个密钥</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = keys.map((key, index) => `
            <div class="key-item">
                <div class="item-content">
                    <div class="item-title">API密钥 #${index + 1}</div>
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
            <h3>添加API密钥</h3>
            <div class="form-group">
                <label for="new-api-key">API密钥:</label>
                <input type="text" id="new-api-key" placeholder="请输入API密钥">
            </div>
            <div style="text-align: right; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.addApiKey()" style="margin-left: 10px;">添加</button>
            </div>
        `;
        
        modal.style.display = 'block';
    }

    // 添加API密钥
    async addApiKey() {
        const newKey = document.getElementById('new-api-key').value.trim();
        
        if (!newKey) {
            this.showNotification('请输入API密钥', 'error');
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
            
            this.closeModal();
            this.loadApiKeys();
            this.showNotification('API密钥添加成功', 'success');
        } catch (error) {
            this.showNotification(`添加API密钥失败: ${error.message}`, 'error');
        }
    }

    // 编辑API密钥
    editApiKey(index, currentKey) {
        const modal = document.getElementById('modal');
        const modalBody = document.getElementById('modal-body');
        
        modalBody.innerHTML = `
            <h3>编辑API密钥</h3>
            <div class="form-group">
                <label for="edit-api-key">API密钥:</label>
                <input type="text" id="edit-api-key" value="${currentKey}">
            </div>
            <div style="text-align: right; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.updateApiKey(${index})" style="margin-left: 10px;">更新</button>
            </div>
        `;
        
        modal.style.display = 'block';
    }

    // 更新API密钥
    async updateApiKey(index) {
        const newKey = document.getElementById('edit-api-key').value.trim();
        
        if (!newKey) {
            this.showNotification('请输入API密钥', 'error');
            return;
        }
        
        try {
            await this.makeRequest('/api-keys', {
                method: 'PATCH',
                body: JSON.stringify({ index, value: newKey })
            });
            
            this.closeModal();
            this.loadApiKeys();
            this.showNotification('API密钥更新成功', 'success');
        } catch (error) {
            this.showNotification(`更新API密钥失败: ${error.message}`, 'error');
        }
    }

    // 删除API密钥
    async deleteApiKey(index) {
        if (!confirm('确定要删除这个API密钥吗？')) return;
        
        try {
            await this.makeRequest(`/api-keys?index=${index}`, { method: 'DELETE' });
            this.loadApiKeys();
            this.showNotification('API密钥删除成功', 'success');
        } catch (error) {
            this.showNotification(`删除API密钥失败: ${error.message}`, 'error');
        }
    }

    // 加载Gemini密钥
    async loadGeminiKeys() {
        try {
            const data = await this.makeRequest('/generative-language-api-key');
            this.renderGeminiKeys(data['generative-language-api-key'] || []);
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
                    <h3>暂无Gemini密钥</h3>
                    <p>点击上方按钮添加第一个密钥</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = keys.map((key, index) => `
            <div class="key-item">
                <div class="item-content">
                    <div class="item-title">Gemini密钥 #${index + 1}</div>
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
            <div style="text-align: right; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.addGeminiKey()" style="margin-left: 10px;">添加</button>
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
            <div style="text-align: right; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.updateGeminiKey('${currentKey}')" style="margin-left: 10px;">更新</button>
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
            
            this.closeModal();
            this.loadGeminiKeys();
            this.showNotification('Gemini密钥更新成功', 'success');
        } catch (error) {
            this.showNotification(`更新Gemini密钥失败: ${error.message}`, 'error');
        }
    }

    // 删除Gemini密钥
    async deleteGeminiKey(key) {
        if (!confirm('确定要删除这个Gemini密钥吗？')) return;
        
        try {
            await this.makeRequest(`/generative-language-api-key?value=${encodeURIComponent(key)}`, { method: 'DELETE' });
            this.loadGeminiKeys();
            this.showNotification('Gemini密钥删除成功', 'success');
        } catch (error) {
            this.showNotification(`删除Gemini密钥失败: ${error.message}`, 'error');
        }
    }

    // 加载Codex密钥
    async loadCodexKeys() {
        try {
            const data = await this.makeRequest('/codex-api-key');
            this.renderCodexKeys(data['codex-api-key'] || []);
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
                    <h3>暂无Codex配置</h3>
                    <p>点击上方按钮添加第一个配置</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = keys.map((config, index) => `
            <div class="provider-item">
                <div class="item-content">
                    <div class="item-title">Codex配置 #${index + 1}</div>
                    <div class="item-subtitle">密钥: ${this.maskApiKey(config['api-key'])}</div>
                    ${config['base-url'] ? `<div class="item-subtitle">地址: ${config['base-url']}</div>` : ''}
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
            <div style="text-align: right; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.addCodexKey()" style="margin-left: 10px;">添加</button>
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
            <div style="text-align: right; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.updateCodexKey(${index})" style="margin-left: 10px;">更新</button>
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
            
            this.closeModal();
            this.loadCodexKeys();
            this.showNotification('Codex配置更新成功', 'success');
        } catch (error) {
            this.showNotification(`更新Codex配置失败: ${error.message}`, 'error');
        }
    }

    // 删除Codex密钥
    async deleteCodexKey(apiKey) {
        if (!confirm('确定要删除这个Codex配置吗？')) return;
        
        try {
            await this.makeRequest(`/codex-api-key?api-key=${encodeURIComponent(apiKey)}`, { method: 'DELETE' });
            this.loadCodexKeys();
            this.showNotification('Codex配置删除成功', 'success');
        } catch (error) {
            this.showNotification(`删除Codex配置失败: ${error.message}`, 'error');
        }
    }

    // 加载Claude密钥
    async loadClaudeKeys() {
        try {
            const data = await this.makeRequest('/claude-api-key');
            this.renderClaudeKeys(data['claude-api-key'] || []);
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
                    <h3>暂无Claude配置</h3>
                    <p>点击上方按钮添加第一个配置</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = keys.map((config, index) => `
            <div class="provider-item">
                <div class="item-content">
                    <div class="item-title">Claude配置 #${index + 1}</div>
                    <div class="item-subtitle">密钥: ${this.maskApiKey(config['api-key'])}</div>
                    ${config['base-url'] ? `<div class="item-subtitle">地址: ${config['base-url']}</div>` : ''}
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
            <div style="text-align: right; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.addClaudeKey()" style="margin-left: 10px;">添加</button>
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
            <div style="text-align: right; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.updateClaudeKey(${index})" style="margin-left: 10px;">更新</button>
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
            
            this.closeModal();
            this.loadClaudeKeys();
            this.showNotification('Claude配置更新成功', 'success');
        } catch (error) {
            this.showNotification(`更新Claude配置失败: ${error.message}`, 'error');
        }
    }

    // 删除Claude密钥
    async deleteClaudeKey(apiKey) {
        if (!confirm('确定要删除这个Claude配置吗？')) return;
        
        try {
            await this.makeRequest(`/claude-api-key?api-key=${encodeURIComponent(apiKey)}`, { method: 'DELETE' });
            this.loadClaudeKeys();
            this.showNotification('Claude配置删除成功', 'success');
        } catch (error) {
            this.showNotification(`删除Claude配置失败: ${error.message}`, 'error');
        }
    }

    // 加载OpenAI提供商
    async loadOpenAIProviders() {
        try {
            const data = await this.makeRequest('/openai-compatibility');
            this.renderOpenAIProviders(data['openai-compatibility'] || []);
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
                    <h3>暂无OpenAI兼容提供商</h3>
                    <p>点击上方按钮添加第一个提供商</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = providers.map((provider, index) => `
            <div class="provider-item">
                <div class="item-content">
                    <div class="item-title">${provider.name}</div>
                    <div class="item-subtitle">地址: ${provider['base-url']}</div>
                    <div class="item-subtitle">密钥数量: ${(provider['api-keys'] || []).length}</div>
                    <div class="item-subtitle">模型数量: ${(provider.models || []).length}</div>
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
            <div style="text-align: right; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.addOpenAIProvider()" style="margin-left: 10px;">添加</button>
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
            <div style="text-align: right; margin-top: 20px;">
                <button class="btn btn-secondary" onclick="manager.closeModal()">取消</button>
                <button class="btn btn-primary" onclick="manager.updateOpenAIProvider(${index})" style="margin-left: 10px;">更新</button>
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
            
            this.closeModal();
            this.loadOpenAIProviders();
            this.showNotification('OpenAI提供商更新成功', 'success');
        } catch (error) {
            this.showNotification(`更新OpenAI提供商失败: ${error.message}`, 'error');
        }
    }

    // 删除OpenAI提供商
    async deleteOpenAIProvider(name) {
        if (!confirm('确定要删除这个OpenAI提供商吗？')) return;
        
        try {
            await this.makeRequest(`/openai-compatibility?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
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
                    <h3>暂无认证文件</h3>
                    <p>点击上方按钮上传第一个文件</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = files.map(file => `
            <div class="file-item">
                <div class="item-content">
                    <div class="item-title">${file.name}</div>
                    <div class="item-subtitle">大小: ${this.formatFileSize(file.size)}</div>
                    <div class="item-subtitle">修改时间: ${new Date(file.modtime).toLocaleString('zh-CN')}</div>
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
            this.showNotification('只能上传JSON文件', 'error');
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
            
            this.loadAuthFiles();
            this.showNotification('文件上传成功', 'success');
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
            
            this.showNotification('文件下载成功', 'success');
        } catch (error) {
            this.showNotification(`文件下载失败: ${error.message}`, 'error');
        }
    }

    // 删除认证文件
    async deleteAuthFile(filename) {
        if (!confirm(`确定要删除文件 "${filename}" 吗？`)) return;
        
        try {
            await this.makeRequest(`/auth-files?name=${encodeURIComponent(filename)}`, { method: 'DELETE' });
            this.loadAuthFiles();
            this.showNotification('文件删除成功', 'success');
        } catch (error) {
            this.showNotification(`文件删除失败: ${error.message}`, 'error');
        }
    }

    // 删除所有认证文件
    async deleteAllAuthFiles() {
        if (!confirm('确定要删除所有认证文件吗？此操作不可恢复！')) return;
        
        try {
            const response = await this.makeRequest('/auth-files?all=true', { method: 'DELETE' });
            this.loadAuthFiles();
            this.showNotification(`成功删除 ${response.deleted} 个文件`, 'success');
        } catch (error) {
            this.showNotification(`删除文件失败: ${error.message}`, 'error');
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
    if (!img) return;
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
            img.src = test.src;
            img.style.display = 'inline-block';
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
    setupSiteLogo();
    manager = new CLIProxyManager();
});
