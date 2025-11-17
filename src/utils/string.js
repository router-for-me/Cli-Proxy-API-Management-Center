/**
 * 字符串工具函数模块
 * 提供字符串处理、格式化、掩码等功能
 */

/**
 * 遮蔽 API 密钥显示，保护敏感信息
 * @param {*} key - API 密钥
 * @returns {string} 遮蔽后的密钥字符串
 *
 * @example
 * maskApiKey('sk-1234567890abcdef')
 * // 返回: 'sk-1...cdef'
 */
export function maskApiKey(key) {
    if (key === null || key === undefined) {
        return '';
    }
    const normalizedKey = typeof key === 'string' ? key : String(key);
    if (normalizedKey.length > 8) {
        return normalizedKey.substring(0, 4) + '...' + normalizedKey.substring(normalizedKey.length - 4);
    } else if (normalizedKey.length > 4) {
        return normalizedKey.substring(0, 2) + '...' + normalizedKey.substring(normalizedKey.length - 2);
    } else if (normalizedKey.length > 2) {
        return normalizedKey.substring(0, 1) + '...' + normalizedKey.substring(normalizedKey.length - 1);
    }
    return normalizedKey;
}

/**
 * 截断字符串到指定长度，超出部分用省略号代替
 * @param {string} str - 原字符串
 * @param {number} maxLength - 最大长度
 * @param {string} suffix - 后缀（默认 '...'）
 * @returns {string} 截断后的字符串
 *
 * @example
 * truncateString('This is a very long string', 10)
 * // 返回: 'This is...'
 */
export function truncateString(str, maxLength, suffix = '...') {
    if (!str || str.length <= maxLength) return str || '';
    return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @param {number} decimals - 小数位数（默认 2）
 * @returns {string} 格式化后的大小字符串
 *
 * @example
 * formatFileSize(1536)
 * // 返回: '1.50 KB'
 */
export function formatFileSize(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    if (!bytes || isNaN(bytes)) return '';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * 首字母大写
 * @param {string} str - 原字符串
 * @returns {string} 首字母大写后的字符串
 */
export function capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * 生成随机字符串
 * @param {number} length - 字符串长度
 * @param {string} charset - 字符集（默认字母数字）
 * @returns {string} 随机字符串
 */
export function randomString(length = 8, charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
}

/**
 * 检查字符串是否为空或仅包含空白字符
 * @param {string} str - 待检查的字符串
 * @returns {boolean} 是否为空
 */
export function isBlank(str) {
    return !str || /^\s*$/.test(str);
}

/**
 * 将字符串转换为 kebab-case
 * @param {string} str - 原字符串
 * @returns {string} kebab-case 字符串
 *
 * @example
 * toKebabCase('helloWorld')
 * // 返回: 'hello-world'
 */
export function toKebabCase(str) {
    if (!str) return '';
    return str
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/[\s_]+/g, '-')
        .toLowerCase();
}
