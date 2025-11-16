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
        this.updateChartLineSelectors(usage);

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
        this.updateChartLineSelectors(null);

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

export function updateChartLineSelectors(usage) {
    const modelNames = this.getModelNamesFromUsage(usage);
    const selectors = this.chartLineSelectIds
        .map(id => document.getElementById(id))
        .filter(Boolean);

    if (!selectors.length) {
        this.chartLineSelections = ['none', 'none', 'none'];
        return;
    }

    const optionsFragment = () => {
        const fragment = document.createDocumentFragment();
        const hiddenOption = document.createElement('option');
        hiddenOption.value = 'none';
        hiddenOption.textContent = i18n.t('usage_stats.chart_line_hidden');
        fragment.appendChild(hiddenOption);
        modelNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            fragment.appendChild(option);
        });
        return fragment;
    };

    const hasModels = modelNames.length > 0;
    selectors.forEach(select => {
        select.innerHTML = '';
        select.appendChild(optionsFragment());
        select.disabled = !hasModels;
    });

    if (!hasModels) {
        this.chartLineSelections = ['none', 'none', 'none'];
        selectors.forEach(select => {
            select.value = 'none';
        });
        return;
    }

    const nextSelections = Array.isArray(this.chartLineSelections)
        ? [...this.chartLineSelections]
        : ['none', 'none', 'none'];

    const validNames = new Set(modelNames);
    let hasActiveSelection = false;
    for (let i = 0; i < nextSelections.length; i++) {
        const selection = nextSelections[i];
        if (selection && selection !== 'none' && !validNames.has(selection)) {
            nextSelections[i] = 'none';
        }
        if (nextSelections[i] !== 'none') {
            hasActiveSelection = true;
        }
    }

    if (!hasActiveSelection) {
        modelNames.slice(0, nextSelections.length).forEach((name, index) => {
            nextSelections[index] = name;
        });
    }

    this.chartLineSelections = nextSelections;
    selectors.forEach((select, index) => {
        const value = this.chartLineSelections[index] || 'none';
        select.value = value;
    });
}

export function handleChartLineSelectionChange(index, value) {
    if (!Array.isArray(this.chartLineSelections)) {
        this.chartLineSelections = ['none', 'none', 'none'];
    }
    if (index < 0 || index >= this.chartLineSelections.length) {
        return;
    }
    const normalized = value || 'none';
    if (this.chartLineSelections[index] === normalized) {
        return;
    }
    this.chartLineSelections[index] = normalized;
    this.refreshChartsForSelections();
}

export function refreshChartsForSelections() {
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

export function getActiveChartLineSelections() {
    if (!Array.isArray(this.chartLineSelections)) {
        this.chartLineSelections = ['none', 'none', 'none'];
    }
    return this.chartLineSelections
        .map((value, index) => ({ model: value, index }))
        .filter(item => item.model && item.model !== 'none');
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

export function createHourlyBucketMeta() {
    const hourMs = 60 * 60 * 1000;
    const now = new Date();
    const currentHour = new Date(now);
    currentHour.setMinutes(0, 0, 0);

    const earliestBucket = new Date(currentHour);
    earliestBucket.setHours(earliestBucket.getHours() - 23);
    const earliestTime = earliestBucket.getTime();
    const labels = [];
    for (let i = 0; i < 24; i++) {
        const bucketStart = earliestTime + i * hourMs;
        labels.push(this.formatHourLabel(new Date(bucketStart)));
    }

    return {
        labels,
        earliestTime,
        bucketSize: hourMs,
        lastBucketTime: earliestTime + (labels.length - 1) * hourMs
    };
}

export function buildHourlySeriesByModel(metric = 'requests') {
    const meta = this.createHourlyBucketMeta();
    const details = this.collectUsageDetails();
    const dataByModel = new Map();
    let hasData = false;

    if (!details.length) {
        return { labels: meta.labels, dataByModel, hasData };
    }

    details.forEach(detail => {
        const timestamp = Date.parse(detail.timestamp);
        if (Number.isNaN(timestamp)) {
            return;
        }

        const normalized = new Date(timestamp);
        normalized.setMinutes(0, 0, 0);
        const bucketStart = normalized.getTime();
        if (bucketStart < meta.earliestTime || bucketStart > meta.lastBucketTime) {
            return;
        }

        const bucketIndex = Math.floor((bucketStart - meta.earliestTime) / meta.bucketSize);
        if (bucketIndex < 0 || bucketIndex >= meta.labels.length) {
            return;
        }

        const modelName = detail.__modelName || 'Unknown';
        if (!dataByModel.has(modelName)) {
            dataByModel.set(modelName, new Array(meta.labels.length).fill(0));
        }

        const bucketValues = dataByModel.get(modelName);
        if (metric === 'tokens') {
            bucketValues[bucketIndex] += this.extractTotalTokens(detail);
        } else {
            bucketValues[bucketIndex] += 1;
        }
        hasData = true;
    });

    return { labels: meta.labels, dataByModel, hasData };
}

export function buildDailySeriesByModel(metric = 'requests') {
    const details = this.collectUsageDetails();
    const valuesByModel = new Map();
    const labelsSet = new Set();
    let hasData = false;

    if (!details.length) {
        return { labels: [], dataByModel: new Map(), hasData };
    }

    details.forEach(detail => {
        const timestamp = Date.parse(detail.timestamp);
        if (Number.isNaN(timestamp)) {
            return;
        }
        const dayLabel = this.formatDayLabel(new Date(timestamp));
        if (!dayLabel) {
            return;
        }

        const modelName = detail.__modelName || 'Unknown';
        if (!valuesByModel.has(modelName)) {
            valuesByModel.set(modelName, new Map());
        }
        const modelDayMap = valuesByModel.get(modelName);
        const increment = metric === 'tokens' ? this.extractTotalTokens(detail) : 1;
        modelDayMap.set(dayLabel, (modelDayMap.get(dayLabel) || 0) + increment);
        labelsSet.add(dayLabel);
        hasData = true;
    });

    const labels = Array.from(labelsSet).sort();
    const dataByModel = new Map();
    valuesByModel.forEach((dayMap, modelName) => {
        const series = labels.map(label => dayMap.get(label) || 0);
        dataByModel.set(modelName, series);
    });

    return { labels, dataByModel, hasData };
}

export function buildChartDataForMetric(period = 'day', metric = 'requests') {
    const baseSeries = period === 'hour'
        ? this.buildHourlySeriesByModel(metric)
        : this.buildDailySeriesByModel(metric);

    const labels = baseSeries?.labels || [];
    const dataByModel = baseSeries?.dataByModel || new Map();
    const activeSelections = this.getActiveChartLineSelections();
    const datasets = activeSelections.map(selection => {
        const values = dataByModel.get(selection.model) || new Array(labels.length).fill(0);
        const style = this.chartLineStyles[selection.index] || this.chartLineStyles[0];
        return {
            label: selection.model,
            data: values,
            borderColor: style.borderColor,
            backgroundColor: style.backgroundColor,
            fill: false,
            tension: 0.35,
            pointBackgroundColor: style.borderColor,
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            pointRadius: values.some(v => v > 0) ? 4 : 3
        };
    });

    return { labels, datasets };
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
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'start',
                    labels: {
                        usePointStyle: true
                    }
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
                    tension: 0.35,
                    borderWidth: 2
                },
                point: {
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
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'start',
                    labels: {
                        usePointStyle: true
                    }
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
                    tension: 0.35,
                    borderWidth: 2
                },
                point: {
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
        return { labels: [], datasets: [] };
    }
    return this.buildChartDataForMetric(period, 'requests');
}

// 获取Token图表数据
export function getTokensChartData(period) {
    if (!this.currentUsageData) {
        return { labels: [], datasets: [] };
    }
    return this.buildChartDataForMetric(period, 'tokens');
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
    updateChartLineSelectors,
    handleChartLineSelectionChange,
    refreshChartsForSelections,
    getActiveChartLineSelections,
    collectUsageDetailsFromUsage,
    collectUsageDetails,
    createHourlyBucketMeta,
    buildHourlySeriesByModel,
    buildDailySeriesByModel,
    buildChartDataForMetric,
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
