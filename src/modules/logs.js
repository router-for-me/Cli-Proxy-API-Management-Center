export const logsModule = {
    toggleLogsNavItem(show) {
        const logsNavItem = document.getElementById('logs-nav-item');
        if (logsNavItem) {
            logsNavItem.style.display = show ? '' : 'none';
        }
    },

    async refreshLogs(incremental = false) {
        const logsContent = document.getElementById('logs-content');
        if (!logsContent) return;

        try {
            if (incremental && !this.latestLogTimestamp) {
                incremental = false;
            }

            if (!incremental) {
                logsContent.innerHTML = '<div class="loading-placeholder" data-i18n="logs.loading">' + i18n.t('logs.loading') + '</div>';
            }

            let url = '/logs';
            const params = new URLSearchParams();

            if (incremental && this.latestLogTimestamp) {
                params.set('after', this.latestLogTimestamp);
            }

            const logFetchLimit = Number.isFinite(this.logFetchLimit) ? this.logFetchLimit : 2500;
            if (logFetchLimit > 0) {
                params.set('limit', logFetchLimit);
            }

            const queryString = params.toString();
            if (queryString) {
                url += `?${queryString}`;
            }

            const response = await this.makeRequest(url, {
                method: 'GET'
            });

            if (response && response.lines) {
                if (response['latest-timestamp']) {
                    this.latestLogTimestamp = response['latest-timestamp'];
                }

                if (incremental && response.lines.length > 0) {
                    this.appendLogs(response.lines, response['line-count'] || 0);
                } else if (!incremental && response.lines.length > 0) {
                    this.renderLogs(response.lines, response['line-count'] || response.lines.length, true);
                } else if (!incremental) {
                    this.latestLogTimestamp = null;
                    this.renderLogs([], 0, false);
                }
            } else if (!incremental) {
                this.latestLogTimestamp = null;
                this.renderLogs([], 0, false);
            }
        } catch (error) {
            console.error('加载日志失败:', error);
            if (!incremental) {
                this.allLogLines = [];
                this.displayedLogLines = [];
                this.latestLogTimestamp = null;
                const is404 = error.message && (error.message.includes('404') || error.message.includes('Not Found'));

                if (is404) {
                    logsContent.innerHTML = '<div class="upgrade-notice"><i class="fas fa-arrow-circle-up"></i><h3 data-i18n="logs.upgrade_required_title">' +
                        i18n.t('logs.upgrade_required_title') + '</h3><p data-i18n="logs.upgrade_required_desc">' +
                        i18n.t('logs.upgrade_required_desc') + '</p></div>';
                } else {
                    logsContent.innerHTML = '<div class="error-state"><i class="fas fa-exclamation-triangle"></i><p data-i18n="logs.load_error">' +
                        i18n.t('logs.load_error') + '</p><p>' + error.message + '</p></div>';
                }
            }
        }
    },

    renderLogs(lines, lineCount, scrollToBottom = true) {
        const logsContent = document.getElementById('logs-content');
        if (!logsContent) return;

        const sourceLines = Array.isArray(lines) ? lines : [];
        const filteredLines = sourceLines.filter(line => !line.includes('/v0/management/'));
        let displayedLines = filteredLines;
        if (filteredLines.length > this.maxDisplayLogLines) {
            const linesToRemove = filteredLines.length - this.maxDisplayLogLines;
            displayedLines = filteredLines.slice(linesToRemove);
        }

        this.allLogLines = displayedLines.slice();

        if (displayedLines.length === 0) {
            this.displayedLogLines = [];
            logsContent.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p data-i18n="logs.empty_title">' +
                i18n.t('logs.empty_title') + '</p><p data-i18n="logs.empty_desc">' +
                i18n.t('logs.empty_desc') + '</p></div>';
            return;
        }

        const visibleLines = this.filterLogLinesBySearch(displayedLines);
        this.displayedLogLines = visibleLines.slice();

        if (visibleLines.length === 0) {
            logsContent.innerHTML = '<div class="empty-state"><i class="fas fa-search"></i><p data-i18n="logs.search_empty_title">' +
                i18n.t('logs.search_empty_title') + '</p><p data-i18n="logs.search_empty_desc">' +
                i18n.t('logs.search_empty_desc') + '</p></div>';
            return;
        }

        const displayedLineCount = this.displayedLogLines.length;
        logsContent.innerHTML = `
            <div class="logs-info">
                <span><i class="fas fa-list-ol"></i> ${displayedLineCount} ${i18n.t('logs.lines')}</span>
            </div>
            <pre class="logs-text">${this.buildLogsHtml(this.displayedLogLines)}</pre>
        `;

        if (scrollToBottom && !this.logSearchQuery) {
            const logsTextElement = logsContent.querySelector('.logs-text');
            if (logsTextElement) {
                logsTextElement.scrollTop = logsTextElement.scrollHeight;
            }
        }
    },

    appendLogs(newLines, totalLineCount) {
        const logsContent = document.getElementById('logs-content');
        if (!logsContent) return;

        if (!newLines || newLines.length === 0) {
            return;
        }

        const logsTextElement = logsContent.querySelector('.logs-text');
        const logsInfoElement = logsContent.querySelector('.logs-info');

        const filteredNewLines = newLines.filter(line => !line.includes('/v0/management/'));
        if (filteredNewLines.length === 0) {
            return;
        }

        if (!logsTextElement) {
            this.renderLogs(filteredNewLines, totalLineCount || filteredNewLines.length, true);
            return;
        }

        const isAtBottom = logsTextElement.scrollHeight - logsTextElement.scrollTop - logsTextElement.clientHeight < 50;

        const baseLines = Array.isArray(this.allLogLines) && this.allLogLines.length > 0
            ? this.allLogLines
            : (Array.isArray(this.displayedLogLines) ? this.displayedLogLines : []);

        this.allLogLines = baseLines.concat(filteredNewLines);
        if (this.allLogLines.length > this.maxDisplayLogLines) {
            this.allLogLines = this.allLogLines.slice(this.allLogLines.length - this.maxDisplayLogLines);
        }

        const visibleLines = this.filterLogLinesBySearch(this.allLogLines);
        this.displayedLogLines = visibleLines.slice();

        if (visibleLines.length === 0) {
            this.renderLogs(this.allLogLines, this.allLogLines.length, false);
            return;
        }

        logsTextElement.innerHTML = this.buildLogsHtml(this.displayedLogLines);

        if (logsInfoElement) {
            const displayedLines = this.displayedLogLines.length;
            logsInfoElement.innerHTML = `<span><i class="fas fa-list-ol"></i> ${displayedLines} ${i18n.t('logs.lines')}</span>`;
        }

        if (isAtBottom && !this.logSearchQuery) {
            logsTextElement.scrollTop = logsTextElement.scrollHeight;
        }
    },

    filterLogLinesBySearch(lines) {
        const keyword = (this.logSearchQuery || '').toLowerCase();
        if (!keyword) {
            return Array.isArray(lines) ? lines.slice() : [];
        }
        if (!Array.isArray(lines) || lines.length === 0) {
            return [];
        }
        return lines.filter(line => (line || '').toLowerCase().includes(keyword));
    },

    updateLogSearchQuery(value = '') {
        const normalized = (value || '').trim();
        if (this.logSearchQuery === normalized) {
            return;
        }
        this.logSearchQuery = normalized;
        this.applyLogSearchFilter();
    },

    applyLogSearchFilter() {
        const logsContent = document.getElementById('logs-content');
        if (!logsContent) return;
        if (logsContent.querySelector('.upgrade-notice') || logsContent.querySelector('.error-state')) {
            return;
        }
        const baseLines = Array.isArray(this.allLogLines) ? this.allLogLines : [];
        if (baseLines.length === 0 && logsContent.querySelector('.loading-placeholder')) {
            return;
        }
        this.renderLogs(baseLines, baseLines.length, false);
    },

    buildLogsHtml(lines) {
        if (!lines || lines.length === 0) {
            return '';
        }

        return lines.map(line => {
            let processedLine = line.replace(/\[GIN\]\s+\d{4}\/\d{2}\/\d{2}\s+-\s+\d{2}:\d{2}:\d{2}\s+/g, '');
            const highlights = [];

            const statusInfo = this.detectHttpStatus(line);
            if (statusInfo) {
                const statusPattern = new RegExp(`\\b${statusInfo.code}\\b`);
                const match = statusPattern.exec(processedLine);
                if (match) {
                    highlights.push({
                        start: match.index,
                        end: match.index + match[0].length,
                        className: `log-status-tag log-status-${statusInfo.bucket}`,
                        priority: 10
                    });
                }
            }

            const timestampPattern = /\d{4}[-/]\d{2}[-/]\d{2}[T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?|\[\d{2}:\d{2}:\d{2}\]/g;
            let match;
            while ((match = timestampPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-timestamp',
                    priority: 5
                });
            }

            const bracketTimestampPattern = /\[\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\]/g;
            while ((match = bracketTimestampPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-timestamp',
                    priority: 5
                });
            }

            const levelPattern = /\[(ERROR|ERRO|ERR|FATAL|CRITICAL|CRIT|WARN|WARNING|INFO|DEBUG|TRACE|PANIC)\]/gi;
            while ((match = levelPattern.exec(processedLine)) !== null) {
                const level = match[1].toUpperCase();
                let className = 'log-level';
                if (['ERROR', 'ERRO', 'ERR', 'FATAL', 'CRITICAL', 'CRIT', 'PANIC'].includes(level)) {
                    className += ' log-level-error';
                } else if (['WARN', 'WARNING'].includes(level)) {
                    className += ' log-level-warn';
                } else if (level === 'INFO') {
                    className += ' log-level-info';
                } else if (['DEBUG', 'TRACE'].includes(level)) {
                    className += ' log-level-debug';
                }
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className,
                    priority: 8
                });
            }

            const methodPattern = /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)\b/g;
            while ((match = methodPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-http-method',
                    priority: 6
                });
            }

            const urlPattern = /(https?:\/\/[^\s<>"']+)/g;
            while ((match = urlPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-path',
                    priority: 4
                });
            }

            const ipPattern = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;
            while ((match = ipPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-ip',
                    priority: 7
                });
            }

            const successPattern = /\b(success|successful|succeeded|completed|ok|done|passed)\b/gi;
            while ((match = successPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-keyword-success',
                    priority: 3
                });
            }

            const errorPattern = /\b(failed|failure|error|exception|panic|fatal|critical|aborted|denied|refused|timeout|invalid)\b/gi;
            while ((match = errorPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-keyword-error',
                    priority: 3
                });
            }

            const headersPattern = /\b(x-[a-z0-9-]+|authorization|content-type|user-agent)\b/gi;
            while ((match = headersPattern.exec(processedLine)) !== null) {
                highlights.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    className: 'log-header-key',
                    priority: 2
                });
            }

            highlights.sort((a, b) => {
                if (a.start === b.start) {
                    return b.priority - a.priority;
                }
                return a.start - b.start;
            });

            let cursor = 0;
            let result = '';

            highlights.forEach((highlight) => {
                if (highlight.start < cursor) {
                    return;
                }

                result += this.escapeHtml(processedLine.slice(cursor, highlight.start));
                result += `<span class="${highlight.className}">${this.escapeHtml(processedLine.slice(highlight.start, highlight.end))}</span>`;
                cursor = highlight.end;
            });

            result += this.escapeHtml(processedLine.slice(cursor));

            return `<span class="log-line">${result}</span>`;
        }).join('');
    },

    detectHttpStatus(line) {
        if (!line) return null;

        const patterns = [
            /\|\s*([1-5]\d{2})\s*\|/,
            /\b([1-5]\d{2})\s*-/,
            /\b(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)\s+\S+\s+([1-5]\d{2})\b/,
            /\b(?:status|code|http)[:\s]+([1-5]\d{2})\b/i,
            /\b([1-5]\d{2})\s+(?:OK|Created|Accepted|No Content|Moved|Found|Bad Request|Unauthorized|Forbidden|Not Found|Method Not Allowed|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b/i
        ];

        for (const pattern of patterns) {
            const match = line.match(pattern);
            if (match) {
                const code = parseInt(match[1], 10);
                if (Number.isNaN(code)) {
                    continue;
                }

                if (code >= 500) {
                    return { code, bucket: '5xx', match: match[1] };
                }
                if (code >= 400) {
                    return { code, bucket: '4xx', match: match[1] };
                }
                if (code >= 300) {
                    return { code, bucket: '3xx', match: match[1] };
                }
                if (code >= 200) {
                    return { code, bucket: '2xx', match: match[1] };
                }
                if (code >= 100) {
                    return { code, bucket: '1xx', match: match[1] };
                }
            }
        }

        return null;
    },

    async openErrorLogsModal() {
        const modalBody = document.getElementById('modal-body');
        if (!modalBody) return;

        modalBody.innerHTML = `
            <h3>${i18n.t('logs.error_logs_modal_title')}</h3>
            <div class="provider-item">
                <div class="item-content">
                    <p class="form-hint">${i18n.t('logs.error_logs_description')}</p>
                    <div class="loading-placeholder">${i18n.t('common.loading')}</div>
                </div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.close')}</button>
            </div>
        `;
        this.showModal();

        try {
            const response = await this.makeRequest('/request-error-logs', {
                method: 'GET'
            });
            const files = Array.isArray(response?.files) ? response.files.slice() : [];
            if (files.length > 1) {
                files.sort((a, b) => (b.modified || 0) - (a.modified || 0));
            }
            modalBody.innerHTML = this.buildErrorLogsModal(files);
            this.showModal();
            this.bindErrorLogDownloadButtons();
        } catch (error) {
            console.error('加载错误日志列表失败:', error);
            modalBody.innerHTML = `
                <h3>${i18n.t('logs.error_logs_modal_title')}</h3>
                <div class="provider-item">
                    <div class="item-content">
                        <div class="error-state">
                            <i class="fas fa-exclamation-triangle"></i>
                            <p>${i18n.t('logs.error_logs_load_error')}</p>
                            <p>${this.escapeHtml(error.message || '')}</p>
                        </div>
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.close')}</button>
                </div>
            `;
            this.showNotification(`${i18n.t('logs.error_logs_load_error')}: ${error.message}`, 'error');
        }
    },

    buildErrorLogsModal(files) {
        const listHtml = Array.isArray(files) && files.length > 0
            ? files.map(file => this.buildErrorLogCard(file)).join('')
            : `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <h3>${i18n.t('logs.error_logs_empty')}</h3>
                    <p>${i18n.t('logs.error_logs_description')}</p>
                </div>
            `;

        return `
            <h3>${i18n.t('logs.error_logs_modal_title')}</h3>
            <p class="form-hint">${i18n.t('logs.error_logs_description')}</p>
            <div class="provider-list">
                ${listHtml}
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="manager.closeModal()">${i18n.t('common.close')}</button>
            </div>
        `;
    },

    buildErrorLogCard(file) {
        const name = file?.name || '';
        const size = typeof file?.size === 'number' ? this.formatFileSize(file.size) : '-';
        const modified = file?.modified ? this.formatErrorLogTime(file.modified) : '-';
        return `
            <div class="provider-item">
                <div class="item-content">
                    <div class="item-title">${this.escapeHtml(name)}</div>
                    <div class="item-subtitle">${i18n.t('logs.error_logs_size')}: ${this.escapeHtml(size)}</div>
                    <div class="item-subtitle">${i18n.t('logs.error_logs_modified')}: ${this.escapeHtml(modified)}</div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary error-log-download-btn" data-log-name="${this.escapeHtml(name)}">
                        <i class="fas fa-download"></i> ${i18n.t('logs.error_logs_download')}
                    </button>
                </div>
            </div>
        `;
    },

    bindErrorLogDownloadButtons() {
        const modalBody = document.getElementById('modal-body');
        if (!modalBody) return;
        const buttons = modalBody.querySelectorAll('.error-log-download-btn');
        buttons.forEach(button => {
            button.onclick = () => {
                const filename = button.getAttribute('data-log-name');
                if (filename) {
                    this.downloadErrorLog(filename);
                }
            };
        });
    },

    formatErrorLogTime(timestamp) {
        const numeric = Number(timestamp);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return '-';
        }
        const date = new Date(numeric * 1000);
        if (Number.isNaN(date.getTime())) {
            return '-';
        }
        const locale = i18n?.currentLanguage || undefined;
        return date.toLocaleString(locale);
    },

    async downloadErrorLog(filename) {
        if (!filename) return;
        try {
            const response = await this.apiClient.requestRaw(`/request-error-logs/${encodeURIComponent(filename)}`, {
                method: 'GET'
            });

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}`;
                try {
                    const errorData = await response.json();
                    if (errorData && errorData.error) {
                        errorMessage = errorData.error;
                    }
                } catch (parseError) {
                    // ignore JSON parse error and use default message
                }
                throw new Error(errorMessage);
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
            this.showNotification(i18n.t('logs.error_log_download_success'), 'success');
        } catch (error) {
            console.error('下载错误日志失败:', error);
            this.showNotification(`${i18n.t('notification.download_failed')}: ${error.message}`, 'error');
        }
    },

    async downloadLogs() {
        try {
            const response = await this.makeRequest('/logs', {
                method: 'GET'
            });

            if (response && response.lines && response.lines.length > 0) {
                const logsText = response.lines.join('\n');
                const blob = new Blob([logsText], { type: 'text/plain' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `cli-proxy-api-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.log`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                this.showNotification(i18n.t('logs.download_success'), 'success');
            } else {
                this.showNotification(i18n.t('logs.empty_title'), 'info');
            }
        } catch (error) {
            console.error('下载日志失败:', error);
            this.showNotification(`${i18n.t('notification.download_failed')}: ${error.message}`, 'error');
        }
    },

    async clearLogs() {
        if (!confirm(i18n.t('logs.clear_confirm'))) {
            return;
        }

        try {
            const response = await this.makeRequest('/logs', {
                method: 'DELETE'
            });

            if (response && response.status === 'ok') {
                const removedCount = response.removed || 0;
                const message = `${i18n.t('logs.clear_success')} (${i18n.t('logs.removed')}: ${removedCount} ${i18n.t('logs.lines')})`;
                this.showNotification(message, 'success');
            } else {
                this.showNotification(i18n.t('logs.clear_success'), 'success');
            }

            this.latestLogTimestamp = null;
            await this.refreshLogs(false);
        } catch (error) {
            console.error('清空日志失败:', error);
            this.showNotification(`${i18n.t('notification.delete_failed')}: ${error.message}`, 'error');
        }
    },

    toggleLogsAutoRefresh(enabled) {
        if (enabled) {
            if (this.logsRefreshTimer) {
                clearInterval(this.logsRefreshTimer);
            }
            this.logsRefreshTimer = setInterval(() => {
                const logsSection = document.getElementById('logs');
                if (logsSection && logsSection.classList.contains('active')) {
                    this.refreshLogs(true);
                }
            }, 5000);
            this.showNotification(i18n.t('logs.auto_refresh_enabled'), 'success');
        } else {
            if (this.logsRefreshTimer) {
                clearInterval(this.logsRefreshTimer);
                this.logsRefreshTimer = null;
            }
            this.showNotification(i18n.t('logs.auto_refresh_disabled'), 'info');
        }
    },

    registerLogsListeners() {
        if (!this.events || typeof this.events.on !== 'function') {
            return;
        }
        this.events.on('connection:status-changed', (event) => {
            const detail = event?.detail || {};
            if (detail.isConnected) {
                // 仅在日志页激活时刷新，避免非日志页面触发请求
                const logsSection = document.getElementById('logs');
                if (logsSection && logsSection.classList.contains('active')) {
                    this.refreshLogs(false);
                }
            } else {
                this.latestLogTimestamp = null;
            }
        });
        this.events.on('navigation:section-activated', (event) => {
            const detail = event?.detail || {};
            if (detail.sectionId === 'logs' && this.isConnected) {
                this.refreshLogs(false);
            }
        });
    }
};
