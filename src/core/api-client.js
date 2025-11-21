// API 客户端：负责规范化基础地址、构造完整 URL、发送请求并回传版本信息
export class ApiClient {
    constructor({ apiBase = '', managementKey = '', onVersionUpdate = null } = {}) {
        this.apiBase = '';
        this.apiUrl = '';
        this.managementKey = managementKey || '';
        this.onVersionUpdate = onVersionUpdate;
        this.setApiBase(apiBase);
    }

    buildHeaders(options = {}) {
        const customHeaders = options.headers || {};
        const headers = {
            'Authorization': `Bearer ${this.managementKey}`,
            ...customHeaders
        };
        const hasContentType = Object.keys(headers).some(key => key.toLowerCase() === 'content-type');
        const body = options.body;
        const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
        if (!hasContentType && !isFormData) {
            headers['Content-Type'] = 'application/json';
        }
        return headers;
    }

    normalizeBase(input) {
        let base = (input || '').trim();
        if (!base) return '';
        base = base.replace(/\/?v0\/management\/?$/i, '');
        base = base.replace(/\/+$/i, '');
        if (!/^https?:\/\//i.test(base)) {
            base = 'http://' + base;
        }
        return base;
    }

    computeApiUrl(base) {
        const normalized = this.normalizeBase(base);
        if (!normalized) return '';
        return normalized.replace(/\/$/, '') + '/v0/management';
    }

    setApiBase(newBase) {
        this.apiBase = this.normalizeBase(newBase);
        this.apiUrl = this.computeApiUrl(this.apiBase);
        return this.apiUrl;
    }

    setManagementKey(key) {
        this.managementKey = key || '';
    }

    async request(endpoint, options = {}) {
        const url = `${this.apiUrl}${endpoint}`;
        const headers = this.buildHeaders(options);

        const response = await fetch(url, {
            ...options,
            headers
        });

        if (typeof this.onVersionUpdate === 'function') {
            this.onVersionUpdate(response.headers);
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        return await response.json();
    }

    // 返回原始 Response，供下载/自定义解析使用
    async requestRaw(endpoint, options = {}) {
        const url = `${this.apiUrl}${endpoint}`;
        const headers = this.buildHeaders(options);
        const response = await fetch(url, {
            ...options,
            headers
        });
        if (typeof this.onVersionUpdate === 'function') {
            this.onVersionUpdate(response.headers);
        }
        return response;
    }
}
