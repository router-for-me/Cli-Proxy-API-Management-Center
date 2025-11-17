/**
 * 数组工具函数模块
 * 提供数组处理、规范化、排序等功能
 */

/**
 * 规范化 API 响应中的数组数据
 * 兼容多种服务端返回格式
 *
 * @param {*} data - API 响应数据
 * @param {string} [key] - 数组字段的键名
 * @returns {Array} 规范化后的数组
 *
 * @example
 * // 直接返回数组
 * normalizeArrayResponse([1, 2, 3])
 * // 返回: [1, 2, 3]
 *
 * // 从对象中提取数组
 * normalizeArrayResponse({ 'api-keys': ['key1', 'key2'] }, 'api-keys')
 * // 返回: ['key1', 'key2']
 *
 * // 从 items 字段提取
 * normalizeArrayResponse({ items: ['a', 'b'] })
 * // 返回: ['a', 'b']
 */
export function normalizeArrayResponse(data, key) {
    // 如果本身就是数组，直接返回
    if (Array.isArray(data)) {
        return data;
    }
    // 如果指定了 key，尝试从对象中提取
    if (key && data && Array.isArray(data[key])) {
        return data[key];
    }
    // 尝试从 items 字段提取（通用分页格式）
    if (data && Array.isArray(data.items)) {
        return data.items;
    }
    // 默认返回空数组
    return [];
}

/**
 * 数组去重
 * @param {Array} arr - 原数组
 * @param {Function} [keyFn] - 提取键的函数，用于对象数组去重
 * @returns {Array} 去重后的数组
 *
 * @example
 * uniqueArray([1, 2, 2, 3])
 * // 返回: [1, 2, 3]
 *
 * uniqueArray([{id: 1}, {id: 2}, {id: 1}], item => item.id)
 * // 返回: [{id: 1}, {id: 2}]
 */
export function uniqueArray(arr, keyFn) {
    if (!Array.isArray(arr)) return [];

    if (keyFn) {
        const seen = new Set();
        return arr.filter(item => {
            const key = keyFn(item);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    return [...new Set(arr)];
}

/**
 * 数组分组
 * @param {Array} arr - 原数组
 * @param {Function} keyFn - 提取分组键的函数
 * @returns {Object} 分组后的对象
 *
 * @example
 * groupBy([{type: 'a', val: 1}, {type: 'b', val: 2}, {type: 'a', val: 3}], item => item.type)
 * // 返回: { a: [{type: 'a', val: 1}, {type: 'a', val: 3}], b: [{type: 'b', val: 2}] }
 */
export function groupBy(arr, keyFn) {
    if (!Array.isArray(arr)) return {};

    return arr.reduce((groups, item) => {
        const key = keyFn(item);
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(item);
        return groups;
    }, {});
}

/**
 * 数组分块
 * @param {Array} arr - 原数组
 * @param {number} size - 每块大小
 * @returns {Array<Array>} 分块后的二维数组
 *
 * @example
 * chunk([1, 2, 3, 4, 5], 2)
 * // 返回: [[1, 2], [3, 4], [5]]
 */
export function chunk(arr, size) {
    if (!Array.isArray(arr) || size < 1) return [];

    const result = [];
    for (let i = 0; i < arr.length; i += size) {
        result.push(arr.slice(i, i + size));
    }
    return result;
}

/**
 * 数组排序（不改变原数组）
 * @param {Array} arr - 原数组
 * @param {Function} compareFn - 比较函数
 * @returns {Array} 排序后的新数组
 */
export function sortArray(arr, compareFn) {
    if (!Array.isArray(arr)) return [];
    return [...arr].sort(compareFn);
}

/**
 * 按字段排序对象数组
 * @param {Array} arr - 对象数组
 * @param {string} key - 排序字段
 * @param {string} order - 排序顺序 'asc' 或 'desc'
 * @returns {Array} 排序后的新数组
 *
 * @example
 * sortByKey([{age: 25}, {age: 20}, {age: 30}], 'age', 'asc')
 * // 返回: [{age: 20}, {age: 25}, {age: 30}]
 */
export function sortByKey(arr, key, order = 'asc') {
    if (!Array.isArray(arr)) return [];

    return [...arr].sort((a, b) => {
        const aVal = a[key];
        const bVal = b[key];

        if (aVal < bVal) return order === 'asc' ? -1 : 1;
        if (aVal > bVal) return order === 'asc' ? 1 : -1;
        return 0;
    });
}

/**
 * 安全地获取数组元素
 * @param {Array} arr - 数组
 * @param {number} index - 索引
 * @param {*} defaultValue - 默认值
 * @returns {*} 数组元素或默认值
 */
export function safeGet(arr, index, defaultValue = undefined) {
    if (!Array.isArray(arr) || index < 0 || index >= arr.length) {
        return defaultValue;
    }
    return arr[index];
}

/**
 * 检查数组是否为空
 * @param {*} arr - 待检查的值
 * @returns {boolean} 是否为空数组
 */
export function isEmptyArray(arr) {
    return !Array.isArray(arr) || arr.length === 0;
}
