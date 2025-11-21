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
            if (incremental && this.latestLogTimestamp) {
                url += `?after=${this.latestLogTimestamp}`;
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
                    logsContent.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p data-i18n="logs.empty_title">' +
                        i18n.t('logs.empty_title') + '</p><p data-i18n="logs.empty_desc">' +
                        i18n.t('logs.empty_desc') + '</p></div>';
                    this.latestLogTimestamp = null;
                }
            } else if (!incremental) {
                logsContent.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p data-i18n="logs.empty_title">' +
                    i18n.t('logs.empty_title') + '</p><p data-i18n="logs.empty_desc">' +
                    i18n.t('logs.empty_desc') + '</p></div>';
                this.latestLogTimestamp = null;
            }
        } catch (error) {
            console.error('加载日志失败:', error);
            if (!incremental) {
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

        if (!lines || lines.length === 0) {
            this.displayedLogLines = [];
            logsContent.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p data-i18n="logs.empty_title">' +
                i18n.t('logs.empty_title') + '</p><p data-i18n="logs.empty_desc">' +
                i18n.t('logs.empty_desc') + '</p></div>';
            return;
        }

        const filteredLines = lines.filter(line => !line.includes('/v0/management/'));
        let displayedLines = filteredLines;
        if (filteredLines.length > this.maxDisplayLogLines) {
            const linesToRemove = filteredLines.length - this.maxDisplayLogLines;
            displayedLines = filteredLines.slice(linesToRemove);
        }

        this.displayedLogLines = displayedLines.slice();

        const displayedLineCount = this.displayedLogLines.length;
        logsContent.innerHTML = `
            <div class="logs-info">
                <span><i class="fas fa-list-ol"></i> ${displayedLineCount} ${i18n.t('logs.lines')}</span>
            </div>
            <pre class="logs-text">${this.buildLogsHtml(this.displayedLogLines)}</pre>
        `;

        if (scrollToBottom) {
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

        this.displayedLogLines = this.displayedLogLines.concat(filteredNewLines);
        if (this.displayedLogLines.length > this.maxDisplayLogLines) {
            this.displayedLogLines = this.displayedLogLines.slice(this.displayedLogLines.length - this.maxDisplayLogLines);
        }

        logsTextElement.innerHTML = this.buildLogsHtml(this.displayedLogLines);

        if (logsInfoElement) {
            const displayedLines = this.displayedLogLines.length;
            logsInfoElement.innerHTML = `<span><i class="fas fa-list-ol"></i> ${displayedLines} ${i18n.t('logs.lines')}</span>`;
        }

        if (isAtBottom) {
            logsTextElement.scrollTop = logsTextElement.scrollHeight;
        }
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
