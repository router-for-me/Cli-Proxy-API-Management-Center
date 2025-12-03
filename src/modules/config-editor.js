export const configEditorModule = {
    setupConfigEditor() {
        const textarea = document.getElementById('config-editor');
        const saveBtn = document.getElementById('config-save-btn');
        const reloadBtn = document.getElementById('config-reload-btn');
        const statusEl = document.getElementById('config-editor-status');

        this.configEditorElements = {
            textarea,
            editorInstance: null,
            saveBtn,
            reloadBtn,
            statusEl
        };

        if (!textarea || !saveBtn || !reloadBtn || !statusEl) {
            return;
        }

        if (window.CodeMirror) {
            const editorInstance = window.CodeMirror.fromTextArea(textarea, {
                mode: 'yaml',
                theme: 'default',
                lineNumbers: true,
                indentUnit: 2,
                tabSize: 2,
                lineWrapping: true,
                autoCloseBrackets: true,
                extraKeys: {
                    'Ctrl-/': 'toggleComment',
                    'Cmd-/': 'toggleComment'
                }
            });

            editorInstance.on('change', () => {
                this.isConfigEditorDirty = true;
                this.updateConfigEditorStatus('info', i18n.t('config_management.status_dirty'));
            });

            this.configEditorElements.editorInstance = editorInstance;
        } else {
            textarea.addEventListener('input', () => {
                this.isConfigEditorDirty = true;
                this.updateConfigEditorStatus('info', i18n.t('config_management.status_dirty'));
            });
        }

        saveBtn.addEventListener('click', () => this.saveConfigFile());
        reloadBtn.addEventListener('click', () => this.loadConfigFileEditor(true));

        this.refreshConfigEditor();
    },

    updateConfigEditorAvailability() {
        const { textarea, editorInstance, saveBtn, reloadBtn } = this.configEditorElements || {};
        if ((!textarea && !editorInstance) || !saveBtn || !reloadBtn) {
            return;
        }

        const disabled = !this.isConnected;
        if (editorInstance) {
            editorInstance.setOption('readOnly', disabled ? 'nocursor' : false);
            const wrapper = editorInstance.getWrapperElement();
            if (wrapper) {
                wrapper.classList.toggle('cm-readonly', disabled);
            }
        } else if (textarea) {
            textarea.disabled = disabled;
        }

        saveBtn.disabled = disabled;
        reloadBtn.disabled = disabled;

        if (disabled) {
            this.updateConfigEditorStatus('info', i18n.t('config_management.status_disconnected'));
        }

        this.refreshConfigEditor();
        this.lastEditorConnectionState = this.isConnected;
    },

    refreshConfigEditor() {
        const instance = this.configEditorElements && this.configEditorElements.editorInstance;
        if (instance && typeof instance.refresh === 'function') {
            setTimeout(() => instance.refresh(), 0);
        }
    },

    updateConfigEditorStatus(type, message) {
        const statusEl = (this.configEditorElements && this.configEditorElements.statusEl) || document.getElementById('config-editor-status');
        if (!statusEl) {
            return;
        }

        statusEl.textContent = message;
        statusEl.classList.remove('success', 'error');

        if (type === 'success') {
            statusEl.classList.add('success');
        } else if (type === 'error') {
            statusEl.classList.add('error');
        }
    },

    async loadConfigFileEditor(forceRefresh = false) {
        const { textarea, editorInstance, reloadBtn } = this.configEditorElements || {};
        if (!textarea && !editorInstance) {
            return;
        }

        if (!this.isConnected) {
            this.updateConfigEditorStatus('info', i18n.t('config_management.status_disconnected'));
            return;
        }

        if (reloadBtn) {
            reloadBtn.disabled = true;
        }
        this.updateConfigEditorStatus('info', i18n.t('config_management.status_loading'));

        try {
            const yamlText = await this.fetchConfigFile(forceRefresh);

            if (editorInstance) {
                editorInstance.setValue(yamlText || '');
                if (typeof editorInstance.markClean === 'function') {
                    editorInstance.markClean();
                }
            } else if (textarea) {
                textarea.value = yamlText || '';
            }

            this.isConfigEditorDirty = false;
            this.updateConfigEditorStatus('success', i18n.t('config_management.status_loaded'));
            this.refreshConfigEditor();
        } catch (error) {
            console.error('加载配置文件失败:', error);
            this.updateConfigEditorStatus('error', `${i18n.t('config_management.status_load_failed')}: ${error.message}`);
        } finally {
            if (reloadBtn) {
                reloadBtn.disabled = !this.isConnected;
            }
        }
    },

    async fetchConfigFile(forceRefresh = false) {
        if (!forceRefresh && this.configYamlCache) {
            return this.configYamlCache;
        }

        const requestUrl = '/config.yaml';

        try {
            const response = await this.apiClient.requestRaw(requestUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/yaml'
                }
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => '');
                const message = errorText || `HTTP ${response.status}`;
                throw new Error(message);
            }

            const contentType = response.headers.get('content-type') || '';
            if (!/yaml/i.test(contentType)) {
                throw new Error(i18n.t('config_management.error_yaml_not_supported'));
            }

            const text = await response.text();
            this.lastConfigFetchUrl = requestUrl;
            this.configYamlCache = text;
            return text;
        } catch (error) {
            throw error instanceof Error ? error : new Error(String(error));
        }
    },

    async saveConfigFile() {
        const { textarea, editorInstance, saveBtn, reloadBtn } = this.configEditorElements || {};
        if ((!textarea && !editorInstance) || !saveBtn) {
            return;
        }

        if (!this.isConnected) {
            this.updateConfigEditorStatus('error', i18n.t('config_management.status_disconnected'));
            return;
        }

        const yamlText = editorInstance ? editorInstance.getValue() : (textarea ? textarea.value : '');

        saveBtn.disabled = true;
        if (reloadBtn) {
            reloadBtn.disabled = true;
        }
        this.updateConfigEditorStatus('info', i18n.t('config_management.status_saving'));

        try {
            await this.writeConfigFile('/config.yaml', yamlText);
            this.lastConfigFetchUrl = '/config.yaml';
            this.configYamlCache = yamlText;
            this.isConfigEditorDirty = false;
            if (editorInstance && typeof editorInstance.markClean === 'function') {
                editorInstance.markClean();
            }
            this.showNotification(i18n.t('config_management.save_success'), 'success');
            this.updateConfigEditorStatus('success', i18n.t('config_management.status_saved'));
            this.clearCache();
            if (this.events && typeof this.events.emit === 'function') {
                this.events.emit('config:refresh-requested', { forceRefresh: true });
            }
        } catch (error) {
            const errorMessage = `${i18n.t('config_management.status_save_failed')}: ${error.message}`;
            this.updateConfigEditorStatus('error', errorMessage);
            this.showNotification(errorMessage, 'error');
            this.isConfigEditorDirty = true;
        } finally {
            saveBtn.disabled = !this.isConnected;
            if (reloadBtn) {
                reloadBtn.disabled = !this.isConnected;
            }
        }
    },

    async writeConfigFile(endpoint, yamlText) {
        const response = await this.apiClient.requestRaw(endpoint, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/yaml',
                'Accept': 'application/json, text/plain, */*'
            },
            body: yamlText
        });

        if (!response.ok) {
            const contentType = response.headers.get('content-type') || '';
            let errorText = '';
            if (contentType.includes('application/json')) {
                const data = await response.json().catch(() => ({}));
                errorText = data.message || data.error || '';
            } else {
                errorText = await response.text().catch(() => '');
            }
            throw new Error(errorText || `HTTP ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            const data = await response.json().catch(() => null);
            if (data && data.ok === false) {
                throw new Error(data.message || data.error || 'Server rejected the update');
            }
        }
    },

    registerConfigEditorListeners() {
        if (!this.events || typeof this.events.on !== 'function') {
            return;
        }
        this.events.on('data:config-loaded', async (event) => {
            const detail = event?.detail || {};
            try {
                await this.loadConfigFileEditor(detail.forceRefresh || false);
                this.refreshConfigEditor();
            } catch (error) {
                console.error('加载配置文件失败:', error);
            }
        });
    }
};
