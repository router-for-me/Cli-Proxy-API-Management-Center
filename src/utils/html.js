/**
 * HTML 工具函数模块
 * 提供 HTML 字符串处理、XSS 防护等功能
 */

/**
 * HTML 转义，防止 XSS 攻击
 * @param {*} value - 需要转义的值
 * @returns {string} 转义后的字符串
 *
 * @example
 * escapeHtml('<script>alert("xss")</script>')
 * // 返回: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 */
export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * HTML 反转义
 * @param {string} html - 需要反转义的 HTML 字符串
 * @returns {string} 反转义后的字符串
 */
export function unescapeHtml(html) {
    if (!html) return '';
    const textarea = document.createElement('textarea');
    textarea.innerHTML = html;
    return textarea.value;
}

/**
 * 去除 HTML 标签，只保留文本内容
 * @param {string} html - HTML 字符串
 * @returns {string} 纯文本内容
 *
 * @example
 * stripHtmlTags('<p>Hello <strong>World</strong></p>')
 * // 返回: 'Hello World'
 */
export function stripHtmlTags(html) {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.textContent || div.innerText || '';
}

/**
 * 安全地设置元素的 HTML 内容
 * @param {HTMLElement} element - 目标元素
 * @param {string} html - HTML 内容
 * @param {boolean} escape - 是否转义（默认 true）
 */
export function setSafeHtml(element, html, escape = true) {
    if (!element) return;
    element.innerHTML = escape ? escapeHtml(html) : html;
}
