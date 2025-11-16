// 获取API密钥的统计信息
export async function getKeyStats() {
    try {
        const response = await this.makeRequest('/usage');
        const usage = response?.usage || null;
        
        if (!usage) {
            return {};
        }

        const sourceStats = {};
        const apis = usage.apis || {};

        Object.values(apis).forEach(apiEntry => {
            const models = apiEntry.models || {};

            Object.values(models).forEach(modelEntry => {
                const details = modelEntry.details || [];

                details.forEach(detail => {
                    const source = detail.source;
                    if (!source) return;
                    
                    if (!sourceStats[source]) {
                        sourceStats[source] = {
                            success: 0,
                            failure: 0
                        };
                    }

                    const isFailed = detail.failed === true;
                    if (isFailed) {
                        sourceStats[source].failure += 1;
                    } else {
                        sourceStats[source].success += 1;
                    }
                });
            });
        });

        return sourceStats;
    } catch (error) {
        console.error('获取统计信息失败:', error);
        return {};
    }
}

// 加载使用统计
export async function loadUsageStats(usageData = null) {
    try {
        let usage = usageData;
        // 如果没有传入usage数据，则调用API获取
        if (!usage) {
            const response = await this.makeRequest('/usage');
            usage = response?.usage || null;
        }
        this.currentUsageData = usage;

        if (!usage) {
            throw new Error('usage payload missing');
        }

        // 更新概览卡片
        this.updateUsageOverview(usage);
        this.updateModelFilterOptions(usage);

        // 读取当前图表周期
        const requestsHourActive = document.getElementById('requests-hour-btn')?.classList.contains('active');
        const tokensHourActive = document.getElementById('tokens-hour-btn')?.classList.contains('active');
        const requestsPeriod = requestsHourActive ? 'hour' : 'day';
        const tokensPeriod = tokensHourActive ? 'hour' : 'day';

        // 初始化图表（使用当前周期）
        this.initializeRequestsChart(requestsPeriod);
        this.initializeTokensChart(tokensPeriod);

        // 更新API详细统计表格
        this.updateApiStatsTable(usage);

    } catch (error) {
        console.error('加载使用统计失败:', error);
        this.currentUsageData = null;
        this.updateModelFilterOptions(null);

        // 清空概览数据
        ['total-requests', 'success-requests', 'failed-requests', 'total-tokens'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '-';
        });

        // 清空图表
        if (this.requestsChart) {
            this.requestsChart.destroy();
            this.requestsChart = null;
        }
        if (this.tokensChart) {
            this.tokensChart.destroy();
            this.tokensChart = null;
        }

        const tableElement = document.getElementById('api-stats-table');
        if (tableElement) {
            tableElement.innerHTML = `<div class="no-data-message">${i18n.t('usage_stats.loading_error')}: ${error.message}</div>`;
        }
    }
}

// 更新使用统计概览
export function updateUsageOverview(data) {
    const safeData = data || {};
    document.getElementById('total-requests').textContent = safeData.total_requests ?? 0;
    document.getElementById('success-requests').textContent = safeData.success_count ?? 0;
    document.getElementById('failed-requests').textContent = safeData.failure_count ?? 0;
    document.getElementById('total-tokens').textContent = safeData.total_tokens ?? 0;
}

export function getModelNamesFromUsage(usage) {
    if (!usage) {
        return [];
    }
    const apis = usage.apis || {};
    const names = new Set();
    Object.values(apis).forEach(apiEntry => {
        const models = apiEntry.models || {};
        Object.keys(models).forEach(modelName => {
            if (modelName) {
                names.add(modelName);
            }
        });
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export function updateModelFilterOptions(usage) {
    const select = document.getElementById('model-filter-select');
    if (!select) {
        return;
    }

    const modelNames = this.getModelNamesFromUsage(usage);
    const previousSelection = this.currentModelFilter || 'all';
    const fragment = document.createDocumentFragment();

    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = i18n.t('usage_stats.model_filter_all');
    fragment.appendChild(allOption);

    modelNames.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        fragment.appendChild(option);
    });

    select.innerHTML = '';
    select.appendChild(fragment);

    let nextSelection = previousSelection;
    if (nextSelection !== 'all' && !modelNames.includes(nextSelection)) {
        nextSelection = 'all';
    }
    this.currentModelFilter = nextSelection;
    select.value = nextSelection;
    select.disabled = modelNames.length === 0;
}

export function handleModelFilterChange(value) {
    const normalized = value || 'all';
    if (this.currentModelFilter === normalized) {
        return;
    }
    this.currentModelFilter = normalized;
    this.refreshChartsForModelFilter();
}

export function refreshChartsForModelFilter() {
    if (!this.currentUsageData) {
        return;
    }
    const requestsHourActive = document.getElementById('requests-hour-btn')?.classList.contains('active');
    const tokensHourActive = document.getElementById('tokens-hour-btn')?.classList.contains('active');
    const requestsPeriod = requestsHourActive ? 'hour' : 'day';
    const tokensPeriod = tokensHourActive ? 'hour' : 'day';

    if (this.requestsChart) {
        this.requestsChart.data = this.getRequestsChartData(requestsPeriod);
        this.requestsChart.update();
    } else {
        this.initializeRequestsChart(requestsPeriod);
    }

    if (this.tokensChart) {
        this.tokensChart.data = this.getTokensChartData(tokensPeriod);
        this.tokensChart.update();
    } else {
        this.initializeTokensChart(tokensPeriod);
    }
}

// 收集所有请求明细，供图表等复用
export function collectUsageDetailsFromUsage(usage) {
    if (!usage) {
        return [];
    }
    const apis = usage.apis || {};
    const details = [];
    Object.values(apis).forEach(apiEntry => {
        const models = apiEntry.models || {};
        Object.entries(models).forEach(([modelName, modelEntry]) => {
            const modelDetails = Array.isArray(modelEntry.details) ? modelEntry.details : [];
            modelDetails.forEach(detail => {
                if (detail && detail.timestamp) {
                    details.push({
                        ...detail,
                        __modelName: modelName
                    });
                }
            });
        });
    });
    return details;
}

export function collectUsageDetails() {
    return this.collectUsageDetailsFromUsage(this.currentUsageData);
}

// 构建最近24小时的统计序列
export function buildRecentHourlySeries(metric = 'requests') {
    const details = this.collectUsageDetails();
    if (!details.length) {
        return null;
    }

    const modelFilter = this.currentModelFilter || 'all';
    const hourMs = 60 * 60 * 1000;
    const now = new Date();
    const currentHour = new Date(now);
    currentHour.setMinutes(0, 0, 0);

    const earliestBucket = new Date(currentHour);
    earliestBucket.setHours(earliestBucket.getHours() - 23);
    const earliestTime = earliestBucket.getTime();
    const labels = [];
    const values = new Array(24).fill(0);

    for (let i = 0; i < 24; i++) {
        const bucketStart = earliestTime + i * hourMs;
        labels.push(this.formatHourLabel(new Date(bucketStart)));
    }

    const latestBucketStart = earliestTime + (values.length - 1) * hourMs;
    let hasMatch = false;

    details.forEach(detail => {
        if (modelFilter !== 'all' && detail.__modelName !== modelFilter) {
            return;
        }
        const timestamp = Date.parse(detail.timestamp);
        if (Number.isNaN(timestamp)) {
            return;
        }

        const normalized = new Date(timestamp);
        normalized.setMinutes(0, 0, 0);
        const bucketStart = normalized.getTime();
        if (bucketStart < earliestTime || bucketStart > latestBucketStart) {
            return;
        }

        const bucketIndex = Math.floor((bucketStart - earliestTime) / hourMs);
        if (bucketIndex < 0 || bucketIndex >= values.length) {
            return;
        }

        if (metric === 'tokens') {
            values[bucketIndex] += this.extractTotalTokens(detail);
        } else {
            values[bucketIndex] += 1;
        }
        hasMatch = true;
    });

    if (!hasMatch) {
        return modelFilter === 'all' ? null : { labels, values };
    }

    return { labels, values };
}

export function buildDailySeries(metric = 'requests') {
    const details = this.collectUsageDetails();
    if (!details.length) {
        return null;
    }

    const modelFilter = this.currentModelFilter || 'all';
    const dayBuckets = {};
    let hasMatch = false;

    details.forEach(detail => {
        if (modelFilter !== 'all' && detail.__modelName !== modelFilter) {
            return;
        }
        const timestamp = Date.parse(detail.timestamp);
        if (Number.isNaN(timestamp)) {
            return;
        }
        const dayLabel = this.formatDayLabel(new Date(timestamp));
        if (!dayLabel) {
            return;
        }

        if (!dayBuckets[dayLabel]) {
            dayBuckets[dayLabel] = 0;
        }
        if (metric === 'tokens') {
            dayBuckets[dayLabel] += this.extractTotalTokens(detail);
        } else {
            dayBuckets[dayLabel] += 1;
        }
        hasMatch = true;
    });

    if (!hasMatch) {
        return modelFilter === 'all' ? null : { labels: [], values: [] };
    }

    const labels = Object.keys(dayBuckets).sort();
    const values = labels.map(label => dayBuckets[label] || 0);
    return { labels, values };
}

// 统一格式化小时标签
export function formatHourLabel(date) {
    if (!(date instanceof Date)) {
        return '';
    }
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hour = date.getHours().toString().padStart(2, '0');
    return `${month}-${day} ${hour}:00`;
}

export function formatDayLabel(date) {
    if (!(date instanceof Date)) {
        return '';
    }
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function extractTotalTokens(detail) {
    const tokens = detail?.tokens || {};
    if (typeof tokens.total_tokens === 'number') {
        return tokens.total_tokens;
    }
    const tokenKeys = ['input_tokens', 'output_tokens', 'reasoning_tokens', 'cached_tokens'];
    return tokenKeys.reduce((sum, key) => {
        const value = tokens[key];
        return sum + (typeof value === 'number' ? value : 0);
    }, 0);
}

// 初始化图表
export function initializeCharts() {
    const requestsHourActive = document.getElementById('requests-hour-btn')?.classList.contains('active');
    const tokensHourActive = document.getElementById('tokens-hour-btn')?.classList.contains('active');
    this.initializeRequestsChart(requestsHourActive ? 'hour' : 'day');
    this.initializeTokensChart(tokensHourActive ? 'hour' : 'day');
}

// 初始化请求趋势图表
export function initializeRequestsChart(period = 'day') {
    const ctx = document.getElementById('requests-chart');
    if (!ctx) return;

    // 销毁现有图表
    if (this.requestsChart) {
        this.requestsChart.destroy();
    }

    const data = this.getRequestsChartData(period);

    this.requestsChart = new Chart(ctx, {
        type: 'line',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: i18n.t(period === 'hour' ? 'usage_stats.by_hour' : 'usage_stats.by_day')
                    }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: i18n.t('usage_stats.requests_count')
                    }
                }
            },
            elements: {
                line: {
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.4
                },
                point: {
                    backgroundColor: '#3b82f6',
                    borderColor: '#ffffff',
                    borderWidth: 2,
                    radius: 4
                }
            }
        }
    });
}

// 初始化Token使用趋势图表
export function initializeTokensChart(period = 'day') {
    const ctx = document.getElementById('tokens-chart');
    if (!ctx) return;

    // 销毁现有图表
    if (this.tokensChart) {
        this.tokensChart.destroy();
    }

    const data = this.getTokensChartData(period);

    this.tokensChart = new Chart(ctx, {
        type: 'line',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    title: {
                        display: true,
                        text: i18n.t(period === 'hour' ? 'usage_stats.by_hour' : 'usage_stats.by_day')
                    }
                },
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: i18n.t('usage_stats.tokens_count')
                    }
                }
            },
            elements: {
                line: {
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.4
                },
                point: {
                    backgroundColor: '#10b981',
                    borderColor: '#ffffff',
                    borderWidth: 2,
                    radius: 4
                }
            }
        }
    });
}

// 获取请求图表数据
export function getRequestsChartData(period) {
    if (!this.currentUsageData) {
        return { labels: [], datasets: [{ data: [] }] };
    }

    let dataSource, labels, values;

    if (period === 'hour') {
        const hourlySeries = this.buildRecentHourlySeries('requests');
        if (hourlySeries) {
            labels = hourlySeries.labels;
            values = hourlySeries.values;
        } else {
            dataSource = this.currentUsageData.requests_by_hour || {};
            labels = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
            values = labels.map(hour => dataSource[hour] || 0);
        }
    } else {
        const dailySeries = this.buildDailySeries('requests');
        if (dailySeries) {
            labels = dailySeries.labels;
            values = dailySeries.values;
        } else {
            dataSource = this.currentUsageData.requests_by_day || {};
            labels = Object.keys(dataSource).sort();
            values = labels.map(day => dataSource[day] || 0);
        }
    }

    return {
        labels: labels,
        datasets: [{
            data: values
        }]
    };
}

// 获取Token图表数据
export function getTokensChartData(period) {
    if (!this.currentUsageData) {
        return { labels: [], datasets: [{ data: [] }] };
    }

    let dataSource, labels, values;

    if (period === 'hour') {
        const hourlySeries = this.buildRecentHourlySeries('tokens');
        if (hourlySeries) {
            labels = hourlySeries.labels;
            values = hourlySeries.values;
        } else {
            dataSource = this.currentUsageData.tokens_by_hour || {};
            labels = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));
            values = labels.map(hour => dataSource[hour] || 0);
        }
    } else {
        const dailySeries = this.buildDailySeries('tokens');
        if (dailySeries) {
            labels = dailySeries.labels;
            values = dailySeries.values;
        } else {
            dataSource = this.currentUsageData.tokens_by_day || {};
            labels = Object.keys(dataSource).sort();
            values = labels.map(day => dataSource[day] || 0);
        }
    }

    return {
        labels: labels,
        datasets: [{
            data: values
        }]
    };
}

// 切换请求图表时间周期
export function switchRequestsPeriod(period) {
    // 更新按钮状态
    document.getElementById('requests-hour-btn').classList.toggle('active', period === 'hour');
    document.getElementById('requests-day-btn').classList.toggle('active', period === 'day');

    // 更新图表数据
    if (this.requestsChart) {
        const newData = this.getRequestsChartData(period);
        this.requestsChart.data = newData;
        this.requestsChart.options.scales.x.title.text = i18n.t(period === 'hour' ? 'usage_stats.by_hour' : 'usage_stats.by_day');
        this.requestsChart.update();
    }
}

// 切换Token图表时间周期
export function switchTokensPeriod(period) {
    // 更新按钮状态
    document.getElementById('tokens-hour-btn').classList.toggle('active', period === 'hour');
    document.getElementById('tokens-day-btn').classList.toggle('active', period === 'day');

    // 更新图表数据
    if (this.tokensChart) {
        const newData = this.getTokensChartData(period);
        this.tokensChart.data = newData;
        this.tokensChart.options.scales.x.title.text = i18n.t(period === 'hour' ? 'usage_stats.by_hour' : 'usage_stats.by_day');
        this.tokensChart.update();
    }
}

// 更新API详细统计表格
export function updateApiStatsTable(data) {
    const container = document.getElementById('api-stats-table');
    if (!container) return;

    const apis = data.apis || {};

    if (Object.keys(apis).length === 0) {
        container.innerHTML = `<div class="no-data-message">${i18n.t('usage_stats.no_data')}</div>`;
        return;
    }

    let tableHtml = `
        <table class="stats-table">
            <thead>
                <tr>
                    <th>${i18n.t('usage_stats.api_endpoint')}</th>
                    <th>${i18n.t('usage_stats.requests_count')}</th>
                    <th>${i18n.t('usage_stats.tokens_count')}</th>
                    <th>${i18n.t('usage_stats.success_rate')}</th>
                    <th>${i18n.t('usage_stats.models')}</th>
                </tr>
            </thead>
            <tbody>
    `;

    Object.entries(apis).forEach(([endpoint, apiData]) => {
        const totalRequests = apiData.total_requests || 0;
        const successCount = apiData.success_count ?? null;
        const successRate = successCount !== null && totalRequests > 0
            ? Math.round((successCount / totalRequests) * 100)
            : null;

        // 构建模型详情
        let modelsHtml = '';
        if (apiData.models && Object.keys(apiData.models).length > 0) {
            modelsHtml = '<div class="model-details">';
            Object.entries(apiData.models).forEach(([modelName, modelData]) => {
                const modelRequests = modelData.total_requests ?? 0;
                const modelTokens = modelData.total_tokens ?? 0;
                modelsHtml += `
                    <div class="model-item">
                        <span class="model-name">${modelName}</span>
                        <span>${modelRequests} 请求 / ${modelTokens} tokens</span>
                    </div>
                `;
            });
            modelsHtml += '</div>';
        }

        tableHtml += `
            <tr>
                <td>${endpoint}</td>
                <td>${totalRequests}</td>
                <td>${apiData.total_tokens || 0}</td>
                <td>${successRate !== null ? successRate + '%' : '-'}</td>
                <td>${modelsHtml || '-'}</td>
            </tr>
        `;
    });

    tableHtml += '</tbody></table>';
    container.innerHTML = tableHtml;
}

export const usageModule = {
    getKeyStats,
    loadUsageStats,
    updateUsageOverview,
    getModelNamesFromUsage,
    updateModelFilterOptions,
    handleModelFilterChange,
    refreshChartsForModelFilter,
    collectUsageDetailsFromUsage,
    collectUsageDetails,
    buildRecentHourlySeries,
    buildDailySeries,
    formatHourLabel,
    formatDayLabel,
    extractTotalTokens,
    initializeCharts,
    initializeRequestsChart,
    initializeTokensChart,
    getRequestsChartData,
    getTokensChartData,
    switchRequestsPeriod,
    switchTokensPeriod,
    updateApiStatsTable
};
