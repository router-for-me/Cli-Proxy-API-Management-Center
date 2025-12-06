const DEFAULT_MODEL_PRICE_STORAGE_KEY = 'cli-proxy-model-prices-v2';
const LEGACY_MODEL_PRICE_STORAGE_KEY = 'cli-proxy-model-prices';
const TOKENS_PER_PRICE_UNIT = 1_000_000;
const DEFAULT_CHART_LINE_COUNT = 3;
const MIN_CHART_LINE_COUNT = 1;
const ALL_MODELS_VALUE = 'all';

export function maskUsageSensitiveValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    const raw = typeof value === 'string' ? value : String(value);
    if (!raw) {
        return '';
    }
    const maskFn = (this && typeof this.maskApiKey === 'function') ? this.maskApiKey : (v) => v;
    let masked = raw;

    const queryRegex = /([?&])(api[-_]?key|key|token|access_token|authorization)=([^&#\s]+)/ig;
    masked = masked.replace(queryRegex, (full, prefix, keyName, valuePart) => `${prefix}${keyName}=${maskFn(valuePart)}`);

    const headerRegex = /(api[-_]?key|key|token|access[-_]?token|authorization)\s*([:=])\s*([A-Za-z0-9._-]+)/ig;
    masked = masked.replace(headerRegex, (full, keyName, separator, valuePart) => `${keyName}${separator}${maskFn(valuePart)}`);

    const keyLikeRegex = /(sk-[A-Za-z0-9]{6,}|AI[a-zA-Z0-9_-]{6,}|AIza[0-9A-Za-z-_]{8,}|hf_[A-Za-z0-9]{6,}|pk_[A-Za-z0-9]{6,}|rk_[A-Za-z0-9]{6,})/g;
    masked = masked.replace(keyLikeRegex, match => maskFn(match));

    if (masked === raw) {
        const trimmed = raw.trim();
        if (trimmed && !/\s/.test(trimmed)) {
            const looksLikeKey = /^sk-/i.test(trimmed)
                || /^AI/i.test(trimmed)
                || /^AIza/i.test(trimmed)
                || /^hf_/i.test(trimmed)
                || /^pk_/i.test(trimmed)
                || /^rk_/i.test(trimmed)
                || (!/[\\/]/.test(trimmed) && (/\d/.test(trimmed) || trimmed.length >= 10))
                || trimmed.length >= 24;
            if (looksLikeKey) {
                return maskFn(trimmed);
            }
        }
    }

    return masked;
}

// 获取API密钥的统计信息
export async function getKeyStats(usageData = null) {
    try {
        let usage = usageData;
        if (!usage) {
            const response = await this.makeRequest('/usage');
            usage = response?.usage || null;
        }

        if (!usage) {
            return { bySource: {}, byAuthIndex: {} };
        }

        const sourceStats = {};
        const authIndexStats = {};
        const ensureBucket = (bucket, key) => {
            if (!bucket[key]) {
                bucket[key] = { success: 0, failure: 0 };
            }
            return bucket[key];
        };
        const normalizeAuthIndex = (value) => {
            if (typeof value === 'number' && Number.isFinite(value)) {
                return value.toString();
            }
            if (typeof value === 'string') {
                const trimmed = value.trim();
                return trimmed ? trimmed : null;
            }
            return null;
        };
        const apis = usage.apis || {};

        Object.values(apis).forEach(apiEntry => {
            const models = apiEntry.models || {};

            Object.values(models).forEach(modelEntry => {
                const details = modelEntry.details || [];

                details.forEach(detail => {
                    const source = this.maskUsageSensitiveValue
                        ? this.maskUsageSensitiveValue(detail.source)
                        : detail.source;
                    const authIndexKey = normalizeAuthIndex(detail?.auth_index);
                    const isFailed = detail.failed === true;

                    if (source) {
                        const bucket = ensureBucket(sourceStats, source);
                        if (isFailed) {
                            bucket.failure += 1;
                        } else {
                            bucket.success += 1;
                        }
                    }

                    if (authIndexKey) {
                        const bucket = ensureBucket(authIndexStats, authIndexKey);
                        if (isFailed) {
                            bucket.failure += 1;
                        } else {
                            bucket.success += 1;
                        }
                    }
                });
            });
        });

        return {
            bySource: sourceStats,
            byAuthIndex: authIndexStats
        };
    } catch (error) {
        console.error('获取统计信息失败:', error);
        return { bySource: {}, byAuthIndex: {} };
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
        this.ensureModelPriceState();

        if (!usage) {
            throw new Error('usage payload missing');
        }

        // 更新概览卡片
        this.updateUsageOverview(usage);
        this.renderOverviewSparklines(usage);
        this.updateChartLineSelectors(usage);
        this.renderModelPriceOptions(usage);
        this.renderSavedModelPrices();

        // 读取当前图表周期
        const requestsHourActive = document.getElementById('requests-hour-btn')?.classList.contains('active');
        const tokensHourActive = document.getElementById('tokens-hour-btn')?.classList.contains('active');
        const costHourActive = document.getElementById('cost-hour-btn')?.classList.contains('active');
        const requestsPeriod = requestsHourActive ? 'hour' : 'day';
        const tokensPeriod = tokensHourActive ? 'hour' : 'day';
        const costPeriod = costHourActive ? 'hour' : 'day';

        // 初始化图表（使用当前周期）
        this.initializeRequestsChart(requestsPeriod);
        this.initializeTokensChart(tokensPeriod);
        this.updateCostSummaryAndChart(usage, costPeriod);

        // 更新API详细统计表格
        this.updateApiStatsTable(usage);

    } catch (error) {
        console.error('加载使用统计失败:', error);
        this.currentUsageData = null;
        this.updateChartLineSelectors(null);
        this.ensureModelPriceState();
        this.renderModelPriceOptions(null);
        this.renderSavedModelPrices();
        this.updateCostSummaryAndChart(null);
        this.destroySparklineCharts();

        // 清空概览数据
        ['total-requests', 'success-requests', 'failed-requests', 'total-tokens', 'cached-tokens', 'reasoning-tokens', 'rpm-30m', 'tpm-30m'].forEach(id => {
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
    const totalTokensValue = safeData.total_tokens ?? 0;
    document.getElementById('total-tokens').textContent = this.formatTokensInMillions(totalTokensValue);

    const tokenBreakdown = this.calculateTokenBreakdown(safeData);
    const cachedEl = document.getElementById('cached-tokens');
    const reasoningEl = document.getElementById('reasoning-tokens');
    if (cachedEl) {
        cachedEl.textContent = this.formatTokensInMillions(tokenBreakdown.cachedTokens);
    }
    if (reasoningEl) {
        reasoningEl.textContent = this.formatTokensInMillions(tokenBreakdown.reasoningTokens);
    }

    const recentRate = this.calculateRecentPerMinuteRates(30, safeData);
    document.getElementById('rpm-30m').textContent = this.formatPerMinuteValue(recentRate.rpm);
    document.getElementById('tpm-30m').textContent = this.formatPerMinuteValue(recentRate.tpm);
}

export function formatTokensInMillions(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return '0.00M';
    }
    return `${(num / 1_000_000).toFixed(2)}M`;
}

export function formatPerMinuteValue(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return '0.00';
    }
    const abs = Math.abs(num);
    if (abs >= 1000) {
        return Math.round(num).toLocaleString();
    }
    if (abs >= 100) {
        return num.toFixed(0);
    }
    if (abs >= 10) {
        return num.toFixed(1);
    }
    return num.toFixed(2);
}

export function formatCompactNumber(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return '0';
    }
    const abs = Math.abs(num);
    if (abs >= 1_000_000) {
        return `${(num / 1_000_000).toFixed(1)}M`;
    }
    if (abs >= 1_000) {
        return `${(num / 1_000).toFixed(1)}K`;
    }
    return abs >= 1 ? num.toFixed(0) : num.toFixed(2);
}

export function formatCompactNumber(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return '0';
    }
    const abs = Math.abs(num);
    if (abs >= 1_000_000) {
        return `${(num / 1_000_000).toFixed(1)}M`;
    }
    if (abs >= 1_000) {
        return `${(num / 1_000).toFixed(1)}K`;
    }
    return abs >= 1 ? num.toFixed(0) : num.toFixed(2);
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

export function getChartLineMaxCount() {
    const idCount = Array.isArray(this.chartLineSelectIds) ? this.chartLineSelectIds.length : 0;
    const configuredMax = Number(this.chartLineMaxCount);
    const fallback = idCount || DEFAULT_CHART_LINE_COUNT;
    const resolvedMax = Number.isFinite(configuredMax) ? configuredMax : fallback;
    if (idCount > 0) {
        return Math.max(MIN_CHART_LINE_COUNT, Math.min(resolvedMax, idCount));
    }
    return Math.max(MIN_CHART_LINE_COUNT, resolvedMax);
}

export function getVisibleChartLineCount() {
    const maxCount = this.getChartLineMaxCount();
    const stored = Number(this.chartLineVisibleCount);
    const base = Number.isFinite(stored)
        ? stored
        : (Array.isArray(this.chartLineSelections) ? this.chartLineSelections.length : DEFAULT_CHART_LINE_COUNT);
    const resolved = Math.min(Math.max(base, MIN_CHART_LINE_COUNT), maxCount);
    this.chartLineVisibleCount = resolved;
    return resolved;
}

export function ensureChartLineSelectionLength(targetLength = null) {
    const maxCount = this.getChartLineMaxCount();
    const desiredLength = Math.min(
        Math.max(targetLength ?? this.getVisibleChartLineCount(), MIN_CHART_LINE_COUNT),
        maxCount
    );

    if (!Array.isArray(this.chartLineSelections)) {
        this.chartLineSelections = Array(desiredLength).fill('none');
        return this.chartLineSelections;
    }

    const trimmed = this.chartLineSelections.slice(0, maxCount);
    if (trimmed.length < desiredLength) {
        this.chartLineSelections = [...trimmed, ...Array(desiredLength - trimmed.length).fill('none')];
    } else if (trimmed.length > desiredLength) {
        this.chartLineSelections = trimmed.slice(0, desiredLength);
    } else {
        this.chartLineSelections = trimmed;
    }
    return this.chartLineSelections;
}

export function updateChartLineControlsUI() {
    const maxCount = this.getChartLineMaxCount();
    const visibleCount = this.getVisibleChartLineCount();
    const counter = document.getElementById('chart-line-count');
    if (counter) {
        counter.textContent = `${visibleCount}/${maxCount}`;
    }
    const addBtn = document.getElementById('add-chart-line');
    if (addBtn) {
        addBtn.disabled = visibleCount >= maxCount;
    }
    const deleteButtons = document.querySelectorAll('.chart-line-delete');
    if (deleteButtons.length) {
        deleteButtons.forEach(button => {
            const group = button.closest('.chart-line-group');
            const index = Number.parseInt(button.getAttribute('data-line-index'), 10);
            const isVisible = group
                ? !group.classList.contains('chart-line-hidden')
                : (Number.isFinite(index) ? index < visibleCount : true);
            button.disabled = visibleCount <= MIN_CHART_LINE_COUNT || !isVisible;
        });
    }
}

export function setChartLineVisibleCount(count) {
    const maxCount = this.getChartLineMaxCount();
    const nextCount = Math.min(Math.max(count, MIN_CHART_LINE_COUNT), maxCount);
    const current = this.getVisibleChartLineCount();
    if (nextCount === current) {
        this.updateChartLineControlsUI();
        return;
    }
    this.chartLineVisibleCount = nextCount;
    this.ensureChartLineSelectionLength(nextCount);
    this.updateChartLineSelectors(this.currentUsageData);
    this.refreshChartsForSelections();
}

export function changeChartLineCount(delta = 0) {
    const current = this.getVisibleChartLineCount();
    this.setChartLineVisibleCount(current + delta);
}

export function removeChartLine(index) {
    const visibleCount = this.getVisibleChartLineCount();
    const normalizedIndex = Number.parseInt(index, 10);
    if (!Number.isFinite(normalizedIndex) || normalizedIndex < 0 || normalizedIndex >= visibleCount) {
        return;
    }
    if (visibleCount <= MIN_CHART_LINE_COUNT) {
        return;
    }
    const nextSelections = this.ensureChartLineSelectionLength(visibleCount).slice(0, visibleCount);
    nextSelections.splice(normalizedIndex, 1);
    this.chartLineSelections = nextSelections;
    this.chartLineVisibleCount = Math.max(MIN_CHART_LINE_COUNT, visibleCount - 1);
    this.updateChartLineSelectors(this.currentUsageData);
    this.refreshChartsForSelections();
}

export function updateChartLineSelectors(usage) {
    const modelNames = this.getModelNamesFromUsage(usage);
    const selectors = this.chartLineSelectIds
        .map(id => document.getElementById(id))
        .filter(Boolean);

    const availableCount = selectors.length || this.getChartLineMaxCount();
    const visibleCount = Math.min(this.getVisibleChartLineCount(), availableCount);
    this.chartLineVisibleCount = visibleCount;
    this.ensureChartLineSelectionLength(visibleCount);
    const wasInitialized = this.chartLineSelectionsInitialized === true;

    if (!selectors.length) {
        this.chartLineSelections = Array(visibleCount).fill('none');
        this.chartLineSelectionsInitialized = false;
        this.updateChartLineControlsUI();
        return;
    }

    const optionsFragment = () => {
        const fragment = document.createDocumentFragment();
        const allOption = document.createElement('option');
        allOption.value = ALL_MODELS_VALUE;
        allOption.textContent = i18n.t('usage_stats.chart_line_all');
        fragment.appendChild(allOption);
        modelNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            fragment.appendChild(option);
        });
        return fragment;
    };

    const hasModels = modelNames.length > 0;
    selectors.forEach((select, index) => {
        const group = select.closest('.chart-line-group');
        const isVisible = index < visibleCount;
        if (group) {
            group.classList.toggle('chart-line-hidden', !isVisible);
        }
        const deleteBtn = group ? group.querySelector('.chart-line-delete') : null;
        select.innerHTML = '';
        select.appendChild(optionsFragment());
        select.disabled = !isVisible;
        if (deleteBtn) {
            deleteBtn.disabled = !isVisible || visibleCount <= MIN_CHART_LINE_COUNT;
        }
        if (!isVisible) {
            select.value = ALL_MODELS_VALUE;
        }
    });

    if (!hasModels) {
        this.chartLineSelections = Array(visibleCount).fill(ALL_MODELS_VALUE);
        this.chartLineSelectionsInitialized = false;
        selectors.forEach((select, index) => {
            const group = select.closest('.chart-line-group');
            if (group) {
                group.classList.toggle('chart-line-hidden', index >= visibleCount);
            }
            select.value = ALL_MODELS_VALUE;
        });
        this.updateChartLineControlsUI();
        return;
    }

    const nextSelections = this.ensureChartLineSelectionLength(visibleCount).slice(0, visibleCount);

    const validNames = new Set([...modelNames, ALL_MODELS_VALUE]);
    let hasActiveSelection = false;
    for (let i = 0; i < nextSelections.length; i++) {
        const selection = nextSelections[i];
        if (selection && selection !== 'none' && !validNames.has(selection)) {
            nextSelections[i] = ALL_MODELS_VALUE;
        }
        if (nextSelections[i] && nextSelections[i] !== 'none') {
            hasActiveSelection = true;
        }
    }

    const allSelectionsAreAll = nextSelections.length > 0 && nextSelections.every(value => value === ALL_MODELS_VALUE);

    if (!hasActiveSelection || (!wasInitialized && allSelectionsAreAll)) {
        modelNames.slice(0, nextSelections.length).forEach((name, index) => {
            nextSelections[index] = name;
        });
    }

    for (let i = 0; i < nextSelections.length; i++) {
        if (!nextSelections[i] || nextSelections[i] === 'none') {
            nextSelections[i] = modelNames[i % Math.max(modelNames.length, 1)] || ALL_MODELS_VALUE;
        }
    }

    this.chartLineSelections = nextSelections;
    selectors.forEach((select, index) => {
        const value = this.chartLineSelections[index] || ALL_MODELS_VALUE;
        select.value = index < visibleCount ? value : ALL_MODELS_VALUE;
    });
    this.chartLineSelectionsInitialized = hasModels;
    this.updateChartLineControlsUI();
}

export function handleChartLineSelectionChange(index, value) {
    const visibleCount = this.getVisibleChartLineCount();
    if (index < 0 || index >= visibleCount) {
        return;
    }
    this.ensureChartLineSelectionLength(visibleCount);
    const normalized = (value && value !== 'none') ? value : ALL_MODELS_VALUE;
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
    const visibleCount = this.getVisibleChartLineCount();
    const selections = this.ensureChartLineSelectionLength(visibleCount).slice(0, visibleCount);
    return selections
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

export function migrateLegacyModelPrices() {
    try {
        if (typeof localStorage === 'undefined') {
            return;
        }
        const storageKey = this.modelPriceStorageKey || DEFAULT_MODEL_PRICE_STORAGE_KEY;
        const hasCurrent = localStorage.getItem(storageKey);
        const legacyRaw = localStorage.getItem(LEGACY_MODEL_PRICE_STORAGE_KEY);

        if (!legacyRaw || hasCurrent) {
            return;
        }

        const parsed = JSON.parse(legacyRaw);
        if (!parsed || typeof parsed !== 'object') {
            return;
        }

        const migrated = {};
        Object.entries(parsed).forEach(([model, price]) => {
            if (!model) return;
            const prompt = Number(price?.prompt);
            const completion = Number(price?.completion);
            const hasPrompt = Number.isFinite(prompt);
            const hasCompletion = Number.isFinite(completion);
            if (!hasPrompt && !hasCompletion) {
                return;
            }
            migrated[model] = {
                prompt: hasPrompt && prompt >= 0 ? prompt * 1000 : 0,
                completion: hasCompletion && completion >= 0 ? completion * 1000 : 0
            };
        });

        if (Object.keys(migrated).length) {
            localStorage.setItem(storageKey, JSON.stringify(migrated));
        }
        localStorage.removeItem(LEGACY_MODEL_PRICE_STORAGE_KEY);
    } catch (error) {
        console.warn('迁移模型价格失败:', error);
    }
}

export function ensureModelPriceState() {
    if (this.modelPriceInitialized) {
        return;
    }
    this.modelPriceStorageKey = this.modelPriceStorageKey || DEFAULT_MODEL_PRICE_STORAGE_KEY;
    this.migrateLegacyModelPrices();
    this.modelPrices = this.loadModelPricesFromStorage();
    this.modelPriceInitialized = true;
}

export function loadModelPricesFromStorage() {
    const storageKey = this.modelPriceStorageKey || DEFAULT_MODEL_PRICE_STORAGE_KEY;
    try {
        if (typeof localStorage === 'undefined') {
            return {};
        }
        const raw = localStorage.getItem(storageKey);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return {};
        }
        const normalized = {};
        Object.entries(parsed).forEach(([model, price]) => {
            if (!model) return;
            const prompt = Number(price?.prompt);
            const completion = Number(price?.completion);
            if (!Number.isFinite(prompt) && !Number.isFinite(completion)) {
                return;
            }
            normalized[model] = {
                prompt: Number.isFinite(prompt) && prompt >= 0 ? prompt : 0,
                completion: Number.isFinite(completion) && completion >= 0 ? completion : 0
            };
        });
        return normalized;
    } catch (error) {
        console.warn('读取模型价格失败:', error);
        return {};
    }
}

export function persistModelPrices(prices = {}) {
    const storageKey = this.modelPriceStorageKey || DEFAULT_MODEL_PRICE_STORAGE_KEY;
    this.modelPrices = prices;
    try {
        if (typeof localStorage === 'undefined') {
            return;
        }
        localStorage.setItem(storageKey, JSON.stringify(prices));
    } catch (error) {
        console.warn('保存模型价格失败:', error);
    }
}

export function renderModelPriceOptions(usage = null) {
    const select = document.getElementById('model-price-model-select');
    if (!select) return;
    const models = this.getModelNamesFromUsage(usage);
    const previousValue = select.value;
    select.innerHTML = '';

    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = i18n.t('usage_stats.model_price_select_placeholder');
    select.appendChild(placeholderOption);

    models.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });

    select.disabled = models.length === 0;
    if (models.includes(previousValue)) {
        select.value = previousValue;
    } else {
        select.value = '';
    }
    this.prefillModelPriceInputs();
}

export function renderSavedModelPrices() {
    const container = document.getElementById('model-price-list');
    if (!container) return;
    const entries = Object.entries(this.modelPrices || {});
    if (!entries.length) {
        container.innerHTML = `<div class="no-data-message">${i18n.t('usage_stats.model_price_empty')}</div>`;
        return;
    }
    const rows = entries.map(([model, price]) => {
        const prompt = Number(price?.prompt) || 0;
        const completion = Number(price?.completion) || 0;
        const safeModel = this.escapeHtml ? this.escapeHtml(model) : model;
        const editArg = JSON.stringify(model).replace(/"/g, '&quot;');
        return `
            <div class="provider-item model-price-item" onclick="manager.handleModelPriceEdit(${editArg})">
                <div class="item-content">
                    <div class="item-title">${safeModel}</div>
                    <div class="item-meta">
                        <span class="stat-badge stat-neutral">${i18n.t('usage_stats.model_price_prompt')}: $${prompt.toFixed(4)} / 1M</span>
                        <span class="stat-badge stat-neutral">${i18n.t('usage_stats.model_price_completion')}: $${completion.toFixed(4)} / 1M</span>
                    </div>
                </div>
                <div class="item-actions">
                    <button class="btn btn-secondary" onclick="event.stopPropagation(); manager.handleModelPriceEdit(${editArg});">
                        <i class="fas fa-edit"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    container.innerHTML = rows;
}

export function handleModelPriceEdit(modelName) {
    const model = (modelName || '').trim();
    const select = document.getElementById('model-price-model-select');
    const promptInput = document.getElementById('model-price-prompt');
    const completionInput = document.getElementById('model-price-completion');
    const form = document.getElementById('model-price-form');
    if (!select || !promptInput || !completionInput) {
        return;
    }

    const options = Array.from(select.options).map(opt => opt.value);
    if (model && !options.includes(model)) {
        const opt = document.createElement('option');
        opt.value = model;
        opt.textContent = model;
        select.appendChild(opt);
    }

    select.disabled = false;
    select.value = model;
    const price = this.modelPrices?.[model];
    if (price) {
        promptInput.value = Number.isFinite(price.prompt) ? price.prompt : '';
        completionInput.value = Number.isFinite(price.completion) ? price.completion : '';
    } else {
        promptInput.value = '';
        completionInput.value = '';
    }

    promptInput.focus();
    if (form && typeof form.scrollIntoView === 'function') {
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

export function prefillModelPriceInputs() {
    const select = document.getElementById('model-price-model-select');
    const promptInput = document.getElementById('model-price-prompt');
    const completionInput = document.getElementById('model-price-completion');
    if (!select || !promptInput || !completionInput) {
        return;
    }
    const model = (select.value || '').trim();
    const price = this.modelPrices?.[model];
    if (price) {
        promptInput.value = Number.isFinite(price.prompt) ? price.prompt : '';
        completionInput.value = Number.isFinite(price.completion) ? price.completion : '';
    } else {
        promptInput.value = '';
        completionInput.value = '';
    }
}

export function normalizePriceValue(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return 0;
    }
    return Number(parsed.toFixed(6));
}

export function handleModelPriceSubmit() {
    this.ensureModelPriceState();
    const select = document.getElementById('model-price-model-select');
    const promptInput = document.getElementById('model-price-prompt');
    const completionInput = document.getElementById('model-price-completion');
    if (!select || !promptInput || !completionInput) {
        return;
    }

    const model = (select.value || '').trim();
    if (!model) {
        this.showNotification(i18n.t('usage_stats.model_price_model_required'), 'warning');
        return;
    }
    const prompt = this.normalizePriceValue(promptInput.value);
    const completion = this.normalizePriceValue(completionInput.value);

    const next = { ...(this.modelPrices || {}) };
    next[model] = { prompt, completion };
    this.persistModelPrices(next);
    this.renderSavedModelPrices();
    this.updateCostSummaryAndChart(this.currentUsageData, this.getCostChartPeriod());
    this.renderOverviewSparklines(this.currentUsageData);
    this.showNotification(i18n.t('usage_stats.model_price_saved'), 'success');
}

export function handleModelPriceReset() {
    this.persistModelPrices({});
    if (typeof localStorage !== 'undefined') {
        const key = this.modelPriceStorageKey || DEFAULT_MODEL_PRICE_STORAGE_KEY;
        try {
            localStorage.removeItem(key);
            localStorage.removeItem(LEGACY_MODEL_PRICE_STORAGE_KEY);
        } catch (error) {
            console.warn('清除模型价格失败:', error);
        }
    }
    this.renderSavedModelPrices();
    this.prefillModelPriceInputs();
    this.updateCostSummaryAndChart(this.currentUsageData, this.getCostChartPeriod());
    this.renderOverviewSparklines(this.currentUsageData);
}

export function calculateTokenBreakdown(usage = null) {
    const details = this.collectUsageDetailsFromUsage(usage || this.currentUsageData);
    if (!details.length) {
        return { cachedTokens: 0, reasoningTokens: 0 };
    }

    let cachedTokens = 0;
    let reasoningTokens = 0;

    details.forEach(detail => {
        const tokens = detail?.tokens || {};
        if (typeof tokens.cached_tokens === 'number') {
            cachedTokens += tokens.cached_tokens;
        }
        if (typeof tokens.reasoning_tokens === 'number') {
            reasoningTokens += tokens.reasoning_tokens;
        }
    });

    return { cachedTokens, reasoningTokens };
}

export function calculateRecentPerMinuteRates(windowMinutes = 30, usage = null) {
    const details = this.collectUsageDetailsFromUsage(usage || this.currentUsageData);
    const effectiveWindow = Number.isFinite(windowMinutes) && windowMinutes > 0
        ? windowMinutes
        : 30;

    if (!details.length) {
        return { rpm: 0, tpm: 0, windowMinutes: effectiveWindow, requestCount: 0, tokenCount: 0 };
    }

    const now = Date.now();
    const windowStart = now - effectiveWindow * 60 * 1000;
    let requestCount = 0;
    let tokenCount = 0;

    details.forEach(detail => {
        const timestamp = Date.parse(detail.timestamp);
        if (Number.isNaN(timestamp) || timestamp < windowStart) {
            return;
        }
        requestCount += 1;
        tokenCount += this.extractTotalTokens(detail);
    });

    const denominator = effectiveWindow > 0 ? effectiveWindow : 1;
    return {
        rpm: requestCount / denominator,
        tpm: tokenCount / denominator,
        windowMinutes: effectiveWindow,
        requestCount,
        tokenCount
    };
}

export function buildRecentWindowSeries(windowMinutes = 30, usage = null, prices = null) {
    const usagePayload = usage || this.currentUsageData;
    const effectiveWindow = Number.isFinite(windowMinutes) && windowMinutes > 0
        ? Math.min(windowMinutes, 720)
        : 30;
    const bucketMs = 60 * 1000;
    const bucketCount = Math.max(1, Math.floor(effectiveWindow));
    const now = Date.now();
    const windowStart = now - bucketCount * bucketMs;
    const labels = Array.from({ length: bucketCount }, (_, index) =>
        this.formatMinuteLabel(new Date(windowStart + index * bucketMs))
    );

    const requestSeries = new Array(bucketCount).fill(0);
    const tokenSeries = new Array(bucketCount).fill(0);
    const costSeries = new Array(bucketCount).fill(0);
    const priceTable = prices || this.modelPrices || {};
    const hasPrices = Object.keys(priceTable).length > 0;

    if (!usagePayload) {
        return {
            labels,
            requests: requestSeries,
            tokens: tokenSeries,
            rpm: requestSeries,
            tpm: tokenSeries,
            cost: costSeries,
            hasPrices
        };
    }

    const details = this.collectUsageDetailsFromUsage(usagePayload);
    const calculateDetailCost = (detail) => {
        if (!hasPrices) {
            return 0;
        }
        const modelName = detail.__modelName || '';
        const price = priceTable[modelName];
        if (!price) {
            return 0;
        }
        const tokens = detail?.tokens || {};
        const promptTokens = Number(tokens.input_tokens) || 0;
        const completionTokens = Number(tokens.output_tokens) || 0;
        const promptCost = (promptTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.prompt) || 0);
        const completionCost = (completionTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.completion) || 0);
        const total = promptCost + completionCost;
        return Number.isFinite(total) && total > 0 ? total : 0;
    };

    details.forEach(detail => {
        const timestamp = Date.parse(detail.timestamp);
        if (Number.isNaN(timestamp) || timestamp < windowStart) {
            return;
        }
        const bucketIndex = Math.min(bucketCount - 1, Math.floor((timestamp - windowStart) / bucketMs));
        if (bucketIndex < 0 || bucketIndex >= bucketCount) {
            return;
        }

        requestSeries[bucketIndex] += 1;
        tokenSeries[bucketIndex] += this.extractTotalTokens(detail);
        costSeries[bucketIndex] += calculateDetailCost(detail);
    });

    return {
        labels,
        requests: requestSeries,
        tokens: tokenSeries,
        rpm: requestSeries,
        tpm: tokenSeries,
        cost: costSeries,
        hasPrices
    };
}

export function destroySparklineCharts(targetIds = null) {
    if (!this.sparklineCharts) {
        this.sparklineCharts = {};
    }
    const ids = targetIds && targetIds.length ? targetIds : Object.keys(this.sparklineCharts);
    ids.forEach(id => {
        const chart = this.sparklineCharts[id];
        if (chart && typeof chart.destroy === 'function') {
            chart.destroy();
        }
        delete this.sparklineCharts[id];

        const canvas = document.getElementById(id);
        if (canvas && typeof canvas.getContext === 'function') {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                const width = canvas.width || canvas.clientWidth || 300;
                const height = canvas.height || canvas.clientHeight || 80;
                ctx.clearRect(0, 0, width, height);
            }
        }
    });
}

export function renderOverviewSparklines(usage = null) {
    const series = this.buildRecentWindowSeries(30, usage, this.modelPrices);
    const labels = series.labels || [];
    const styleFor = (index = 0) => {
        const fallback = { borderColor: '#3b82f6', backgroundColor: 'rgba(59, 130, 246, 0.15)' };
        if (!Array.isArray(this.chartLineStyles) || !this.chartLineStyles.length) {
            return fallback;
        }
        return this.chartLineStyles[index % this.chartLineStyles.length] || fallback;
    };

    const createSparkline = ({ id, data, styleIndex, requirePrices = false }) => {
        if (requirePrices && !series.hasPrices) {
            this.destroySparklineCharts([id]);
            return;
        }
        const canvas = document.getElementById(id);
        if (!canvas) {
            return;
        }

        const style = styleFor(styleIndex);
        const values = Array.isArray(data) && data.length ? data : [0];
        const maxValue = values.reduce((max, value) => Math.max(max, Number(value) || 0), 0);
        const suggestedMax = maxValue > 0 ? maxValue * 1.2 : 1;

        this.destroySparklineCharts([id]);
        if (!this.sparklineCharts) {
            this.sparklineCharts = {};
        }

        this.sparklineCharts[id] = new Chart(canvas, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    data: values,
                    borderColor: style.borderColor,
                    backgroundColor: style.backgroundColor,
                    fill: true,
                    tension: 0.35,
                    pointRadius: 0,
                    pointHoverRadius: 3,
                    borderWidth: 2,
                    spanGaps: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: { intersect: false, mode: 'index' },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => this.formatCompactNumber(ctx.parsed.y || 0)
                        }
                    }
                },
                layout: { padding: { left: 2, right: 2, top: 6, bottom: 6 } },
                scales: {
                    x: { display: false },
                    y: {
                        display: false,
                        beginAtZero: true,
                        suggestedMin: 0,
                        suggestedMax
                    }
                },
                elements: {
                    line: { borderWidth: 2, tension: 0.35 },
                    point: { radius: 0, hitRadius: 3 }
                }
            }
        });
    };

    createSparkline({ id: 'requests-sparkline', data: series.requests, styleIndex: 0 });
    createSparkline({ id: 'tokens-sparkline', data: series.tokens, styleIndex: 1 });
    createSparkline({ id: 'rpm-sparkline', data: series.rpm, styleIndex: 2 });
    createSparkline({ id: 'tpm-sparkline', data: series.tpm, styleIndex: 3 });
    createSparkline({ id: 'cost-sparkline', data: series.cost, styleIndex: 7, requirePrices: true });
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
    let allSeriesCache = null;

    const getAllSeries = () => {
        if (allSeriesCache) {
            return allSeriesCache;
        }
        const summed = new Array(labels.length).fill(0);
        dataByModel.forEach(values => {
            values.forEach((value, idx) => {
                summed[idx] = (summed[idx] || 0) + value;
            });
        });
        allSeriesCache = summed;
        return summed;
    };

    const getSeriesForSelection = (selectionValue) => {
        if (selectionValue === ALL_MODELS_VALUE) {
            return getAllSeries();
        }
        return dataByModel.get(selectionValue) || new Array(labels.length).fill(0);
    };

    const datasets = activeSelections.map(selection => {
        const values = getSeriesForSelection(selection.model);
        const style = this.chartLineStyles[selection.index % this.chartLineStyles.length] || this.chartLineStyles[0];
        const label = selection.model === ALL_MODELS_VALUE
            ? i18n.t('usage_stats.chart_line_all')
            : selection.model;
        return {
            label,
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

export function formatMinuteLabel(date) {
    if (!(date instanceof Date)) {
        return '';
    }
    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');
    return `${hour}:${minute}`;
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

export function formatUsd(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
        return '$0.00';
    }
    const fixed = num.toFixed(2);
    const parts = Number(fixed).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    return `$${parts}`;
}

export function calculateCostData(prices = null, usage = null, period = 'day') {
    const priceTable = prices || this.modelPrices || {};
    const usagePayload = usage || this.currentUsageData;
    const entries = Object.entries(priceTable || {});
    const result = { totalCost: 0, labels: [], datasets: [] };

    if (!entries.length || !usagePayload) {
        return result;
    }

    const details = this.collectUsageDetailsFromUsage(usagePayload);
    if (!details.length) {
        return result;
    }

    const normalizedDetails = details.map(detail => {
        const modelName = detail.__modelName || 'Unknown';
        const price = priceTable[modelName];
        if (!price) {
            return null;
        }

        const tokens = detail?.tokens || {};
        const promptTokens = Number(tokens.input_tokens) || 0;
        const completionTokens = Number(tokens.output_tokens) || 0;
        const promptCost = (promptTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.prompt) || 0);
        const completionCost = (completionTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.completion) || 0);
        const detailCost = promptCost + completionCost;
        const parsedTimestamp = Date.parse(detail.timestamp);

        if (!Number.isFinite(detailCost) || detailCost <= 0 || Number.isNaN(parsedTimestamp)) {
            return null;
        }

        return { modelName, cost: detailCost, timestamp: parsedTimestamp };
    }).filter(Boolean);

    if (!normalizedDetails.length) {
        return result;
    }

    const totalCost = normalizedDetails.reduce((sum, item) => sum + item.cost, 0);

    if (period === 'hour') {
        const meta = this.createHourlyBucketMeta();
        const dataByModel = new Map();

        normalizedDetails.forEach(({ modelName, cost, timestamp }) => {
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
            if (!dataByModel.has(modelName)) {
                dataByModel.set(modelName, new Array(meta.labels.length).fill(0));
            }
            const bucketValues = dataByModel.get(modelName);
            bucketValues[bucketIndex] += cost;
        });

        const datasets = [];
        dataByModel.forEach((series, modelName) => {
            datasets.push({ label: modelName, data: series.map(value => Number(value.toFixed(4))) });
        });

        return { totalCost, labels: meta.labels, datasets };
    }

    const labelSet = new Set();
    const costByModelDay = new Map();

    normalizedDetails.forEach(({ modelName, cost, timestamp }) => {
        const dayLabel = this.formatDayLabel(new Date(timestamp));
        if (!dayLabel) {
            return;
        }

        if (!costByModelDay.has(modelName)) {
            costByModelDay.set(modelName, new Map());
        }
        const dayMap = costByModelDay.get(modelName);
        dayMap.set(dayLabel, (dayMap.get(dayLabel) || 0) + cost);
        labelSet.add(dayLabel);
    });

    const labels = Array.from(labelSet).sort();
    const datasets = [];
    costByModelDay.forEach((dayMap, modelName) => {
        const series = labels.map(label => Number((dayMap.get(label) || 0).toFixed(4)));
        datasets.push({ label: modelName, data: series });
    });

    return { totalCost, labels, datasets };
}

export function setCostChartPlaceholder(messageKey = null) {
    const placeholder = document.getElementById('cost-chart-placeholder');
    const canvas = document.getElementById('cost-chart');
    if (!placeholder || !canvas) {
        return;
    }
    if (messageKey) {
        placeholder.textContent = i18n.t(messageKey);
        placeholder.style.display = 'flex';
        canvas.style.display = 'none';
    } else {
        placeholder.style.display = 'none';
        canvas.style.display = 'block';
    }
}

export function destroyCostChart() {
    if (this.costChart) {
        this.costChart.destroy();
        this.costChart = null;
    }
}

export function initializeCostChart(costData, period = 'day') {
    const canvas = document.getElementById('cost-chart');
    if (!canvas) {
        return;
    }
    this.destroyCostChart();

    const datasets = (costData.datasets || []).map((dataset, index) => {
        const style = this.chartLineStyles[index % this.chartLineStyles.length] || this.chartLineStyles[0];
        return {
            ...dataset,
            borderColor: style.borderColor,
            backgroundColor: style.backgroundColor || 'rgba(59, 130, 246, 0.15)',
            fill: true,
            tension: 0.35,
            pointBackgroundColor: style.borderColor,
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            pointRadius: dataset.data.some(v => v > 0) ? 4 : 3
        };
    });

    this.costChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: costData.labels || [],
            datasets
        },
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
                },
                tooltip: {
                    callbacks: {
                        label: context => {
                            const label = context.dataset.label || '';
                            const value = Number(context.parsed.y) || 0;
                            return `${label}: ${this.formatUsd(value)}`;
                        }
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
                        text: i18n.t('usage_stats.cost_axis_label')
                    },
                    ticks: {
                        callback: (value) => this.formatUsd(value).replace('$', '')
                    }
                }
            },
            elements: {
                line: {
                    borderWidth: 2
                },
                point: {
                    borderWidth: 2
                }
            }
        }
    });
    this.setCostChartPlaceholder(null);
}

export function getCostChartPeriod() {
    const costHourActive = document.getElementById('cost-hour-btn')?.classList.contains('active');
    return costHourActive ? 'hour' : 'day';
}

export function updateCostSummaryAndChart(usage = null, period = null) {
    this.ensureModelPriceState();
    const totalCostEl = document.getElementById('total-cost');
    const hasPrices = Object.keys(this.modelPrices || {}).length > 0;
    const usagePayload = usage || this.currentUsageData;
    const resolvedPeriod = period || this.getCostChartPeriod();

    if (!hasPrices) {
        if (totalCostEl) {
            totalCostEl.textContent = '--';
        }
        this.destroyCostChart();
        this.setCostChartPlaceholder('usage_stats.cost_need_price');
        return;
    }

    if (!usagePayload) {
        if (totalCostEl) {
            totalCostEl.textContent = '--';
        }
        this.destroyCostChart();
        this.setCostChartPlaceholder('usage_stats.cost_need_usage');
        return;
    }

    const costData = this.calculateCostData(this.modelPrices, usagePayload, resolvedPeriod);
    if (totalCostEl) {
        totalCostEl.textContent = this.formatUsd(costData.totalCost);
    }

    if (!costData.labels.length || !costData.datasets.length) {
        this.destroyCostChart();
        this.setCostChartPlaceholder('usage_stats.cost_no_data');
        return;
    }

    this.initializeCostChart(costData, resolvedPeriod);
}

// 初始化图表
export function initializeCharts() {
    const requestsHourActive = document.getElementById('requests-hour-btn')?.classList.contains('active');
    const tokensHourActive = document.getElementById('tokens-hour-btn')?.classList.contains('active');
    const costHourActive = document.getElementById('cost-hour-btn')?.classList.contains('active');
    this.initializeRequestsChart(requestsHourActive ? 'hour' : 'day');
    this.initializeTokensChart(tokensHourActive ? 'hour' : 'day');
    this.updateCostSummaryAndChart(this.currentUsageData, costHourActive ? 'hour' : 'day');
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

export function switchCostPeriod(period) {
    if (period !== 'hour' && period !== 'day') {
        return;
    }
    const hourBtn = document.getElementById('cost-hour-btn');
    const dayBtn = document.getElementById('cost-day-btn');
    if (hourBtn && dayBtn) {
        hourBtn.classList.toggle('active', period === 'hour');
        dayBtn.classList.toggle('active', period === 'day');
    }

    this.updateCostSummaryAndChart(this.currentUsageData, period);
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

    const hasPrices = Object.keys(this.modelPrices || {}).length > 0;
    const calculateEndpointCost = (apiData) => {
        if (!hasPrices) return 0;
        let cost = 0;
        const models = apiData.models || {};
        Object.entries(models).forEach(([modelName, modelData]) => {
            const price = this.modelPrices?.[modelName];
            if (!price) return;
            const details = Array.isArray(modelData.details) ? modelData.details : [];
            details.forEach(detail => {
                const tokens = detail?.tokens || {};
                const promptTokens = Number(tokens.input_tokens) || 0;
                const completionTokens = Number(tokens.output_tokens) || 0;
                const detailCost = (promptTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.prompt) || 0)
                    + (completionTokens / TOKENS_PER_PRICE_UNIT) * (Number(price.completion) || 0);
                if (Number.isFinite(detailCost) && detailCost > 0) {
                    cost += detailCost;
                }
            });
        });
        return Number(cost.toFixed(4));
    };

    let tableHtml = `
        <table class="stats-table">
            <thead>
                <tr>
                    <th>${i18n.t('usage_stats.api_endpoint')}</th>
                    <th>${i18n.t('usage_stats.requests_count')}</th>
                    <th>${i18n.t('usage_stats.tokens_count')}</th>
                    <th>${i18n.t('usage_stats.total_cost')}</th>
                    <th>${i18n.t('usage_stats.models')}</th>
                </tr>
            </thead>
            <tbody>
    `;

    Object.entries(apis).forEach(([endpoint, apiData]) => {
        const totalRequests = apiData.total_requests || 0;
        const endpointCost = calculateEndpointCost(apiData);
        const displayEndpoint = (this.maskUsageSensitiveValue
            ? this.maskUsageSensitiveValue(endpoint)
            : (endpoint ?? '')) || '-';
        const safeEndpoint = this.escapeHtml
            ? this.escapeHtml(displayEndpoint)
            : displayEndpoint;

        // 构建模型详情
        let modelsHtml = '';
        if (apiData.models && Object.keys(apiData.models).length > 0) {
            modelsHtml = '<div class="model-details">';
            Object.entries(apiData.models).forEach(([modelName, modelData]) => {
                const safeModel = this.escapeHtml ? this.escapeHtml(modelName || '') : (modelName || '');
                const modelRequests = modelData.total_requests ?? 0;
                const modelTokens = this.formatTokensInMillions(modelData.total_tokens ?? 0);
                modelsHtml += `
                    <div class="model-item">
                        <span class="model-name">${safeModel}</span>
                        <span>${modelRequests} 请求 / ${modelTokens} tokens</span>
                    </div>
                `;
            });
            modelsHtml += '</div>';
        }

        tableHtml += `
            <tr>
                <td>${safeEndpoint}</td>
                <td>${totalRequests}</td>
                <td>${this.formatTokensInMillions(apiData.total_tokens || 0)}</td>
                <td>${hasPrices && endpointCost > 0 ? this.formatUsd(endpointCost) : '--'}</td>
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
    maskUsageSensitiveValue,
    getModelNamesFromUsage,
    getChartLineMaxCount,
    getVisibleChartLineCount,
    ensureChartLineSelectionLength,
    updateChartLineControlsUI,
    setChartLineVisibleCount,
    changeChartLineCount,
    removeChartLine,
    updateChartLineSelectors,
    handleChartLineSelectionChange,
    refreshChartsForSelections,
    getActiveChartLineSelections,
    collectUsageDetailsFromUsage,
    collectUsageDetails,
    migrateLegacyModelPrices,
    ensureModelPriceState,
    loadModelPricesFromStorage,
    persistModelPrices,
    renderModelPriceOptions,
    renderSavedModelPrices,
    handleModelPriceEdit,
    prefillModelPriceInputs,
    normalizePriceValue,
    handleModelPriceSubmit,
    handleModelPriceReset,
    calculateTokenBreakdown,
    calculateRecentPerMinuteRates,
    buildRecentWindowSeries,
    createHourlyBucketMeta,
    buildHourlySeriesByModel,
    buildDailySeriesByModel,
    buildChartDataForMetric,
    formatHourLabel,
    formatMinuteLabel,
    formatTokensInMillions,
    formatPerMinuteValue,
    formatCompactNumber,
    formatDayLabel,
    extractTotalTokens,
    formatUsd,
    calculateCostData,
    getCostChartPeriod,
    setCostChartPlaceholder,
    destroyCostChart,
    destroySparklineCharts,
    renderOverviewSparklines,
    initializeCostChart,
    updateCostSummaryAndChart,
    initializeCharts,
    initializeRequestsChart,
    initializeTokensChart,
    getRequestsChartData,
    getTokensChartData,
    switchRequestsPeriod,
    switchTokensPeriod,
    switchCostPeriod,
    updateApiStatsTable,
    registerUsageListeners
};

// 订阅全局事件，基于配置加载结果渲染使用统计
export function registerUsageListeners() {
    if (!this.events || typeof this.events.on !== 'function') {
        return;
    }
    this.events.on('data:config-loaded', (event) => {
        const detail = event?.detail || {};
        const usageData = detail.usageData || null;
        this.loadUsageStats(usageData);
    });
}
