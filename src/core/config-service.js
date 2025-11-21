// 配置缓存服务：负责分段/全量读取配置与缓存控制，不涉及任何 DOM
export class ConfigService {
    constructor({ apiClient, cacheExpiry }) {
        this.apiClient = apiClient;
        this.cacheExpiry = cacheExpiry;
        this.cache = {};
        this.cacheTimestamps = {};
    }

    isCacheValid(section = null) {
        if (section) {
            if (!(section in this.cache) || !(section in this.cacheTimestamps)) {
                return false;
            }
            return (Date.now() - this.cacheTimestamps[section]) < this.cacheExpiry;
        }
        if (!this.cache['__full__'] || !this.cacheTimestamps['__full__']) {
            return false;
        }
        return (Date.now() - this.cacheTimestamps['__full__']) < this.cacheExpiry;
    }

    clearCache(section = null) {
        if (section) {
            delete this.cache[section];
            delete this.cacheTimestamps[section];
            if (this.cache['__full__']) {
                delete this.cache['__full__'][section];
            }
            return;
        }
        Object.keys(this.cache).forEach(key => delete this.cache[key]);
        Object.keys(this.cacheTimestamps).forEach(key => delete this.cacheTimestamps[key]);
    }

    async getConfig(section = null, forceRefresh = false) {
        const now = Date.now();

        if (section && !forceRefresh && this.isCacheValid(section)) {
            return this.cache[section];
        }

        if (!section && !forceRefresh && this.isCacheValid()) {
            return this.cache['__full__'];
        }

        const config = await this.apiClient.request('/config');

        if (section) {
            this.cache[section] = config[section];
            this.cacheTimestamps[section] = now;
            if (this.cache['__full__']) {
                this.cache['__full__'][section] = config[section];
            } else {
                this.cache['__full__'] = config;
                this.cacheTimestamps['__full__'] = now;
            }
            return config[section];
        }

        this.cache['__full__'] = config;
        this.cacheTimestamps['__full__'] = now;
        Object.keys(config).forEach(key => {
            this.cache[key] = config[key];
            this.cacheTimestamps[key] = now;
        });

        return config;
    }
}
