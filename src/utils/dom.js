/**
 * DOM 操作工具函数模块
 * 提供高性能的 DOM 操作方法
 */

/**
 * 批量渲染列表项，使用 DocumentFragment 减少重绘
 * @param {HTMLElement} container - 容器元素
 * @param {Array} items - 数据项数组
 * @param {Function} renderItemFn - 渲染单个项目的函数，返回 HTML 字符串或 Element
 * @param {boolean} append - 是否追加模式（默认 false，清空后渲染）
 *
 * @example
 * renderList(container, files, (file) => `
 *     <div class="file-item">${file.name}</div>
 * `);
 */
export function renderList(container, items, renderItemFn, append = false) {
    if (!container) return;

    const fragment = document.createDocumentFragment();

    items.forEach((item, index) => {
        const rendered = renderItemFn(item, index);

        if (typeof rendered === 'string') {
            // HTML 字符串，创建临时容器
            const temp = document.createElement('div');
            temp.innerHTML = rendered;
            // 将所有子元素添加到 fragment
            while (temp.firstChild) {
                fragment.appendChild(temp.firstChild);
            }
        } else if (rendered instanceof HTMLElement) {
            // DOM 元素，直接添加
            fragment.appendChild(rendered);
        }
    });

    if (!append) {
        container.innerHTML = '';
    }
    container.appendChild(fragment);
}

/**
 * 创建 DOM 元素的快捷方法
 * @param {string} tag - 标签名
 * @param {Object} attrs - 属性对象
 * @param {string|Array<HTMLElement>} content - 内容（文本或子元素数组）
 * @returns {HTMLElement}
 *
 * @example
 * const div = createElement('div', { class: 'item', 'data-id': '123' }, 'Hello');
 * const ul = createElement('ul', {}, [
 *     createElement('li', {}, 'Item 1'),
 *     createElement('li', {}, 'Item 2')
 * ]);
 */
export function createElement(tag, attrs = {}, content = null) {
    const element = document.createElement(tag);

    // 设置属性
    Object.keys(attrs).forEach(key => {
        if (key === 'class') {
            element.className = attrs[key];
        } else if (key === 'style' && typeof attrs[key] === 'object') {
            Object.assign(element.style, attrs[key]);
        } else if (key.startsWith('on') && typeof attrs[key] === 'function') {
            const eventName = key.substring(2).toLowerCase();
            element.addEventListener(eventName, attrs[key]);
        } else {
            element.setAttribute(key, attrs[key]);
        }
    });

    // 设置内容
    if (content !== null && content !== undefined) {
        if (typeof content === 'string') {
            element.textContent = content;
        } else if (Array.isArray(content)) {
            content.forEach(child => {
                if (child instanceof HTMLElement) {
                    element.appendChild(child);
                }
            });
        } else if (content instanceof HTMLElement) {
            element.appendChild(content);
        }
    }

    return element;
}

/**
 * 批量更新元素属性，减少重绘
 * @param {HTMLElement} element - 目标元素
 * @param {Object} updates - 更新对象
 *
 * @example
 * batchUpdate(element, {
 *     className: 'active',
 *     style: { color: 'red', fontSize: '16px' },
 *     textContent: 'Updated'
 * });
 */
export function batchUpdate(element, updates) {
    if (!element) return;

    // 使用 requestAnimationFrame 批量更新
    requestAnimationFrame(() => {
        Object.keys(updates).forEach(key => {
            if (key === 'style' && typeof updates[key] === 'object') {
                Object.assign(element.style, updates[key]);
            } else {
                element[key] = updates[key];
            }
        });
    });
}

/**
 * 延迟渲染大列表，避免阻塞 UI
 * @param {HTMLElement} container - 容器元素
 * @param {Array} items - 数据项数组
 * @param {Function} renderItemFn - 渲染函数
 * @param {number} batchSize - 每批渲染数量
 * @returns {Promise} 完成渲染的 Promise
 *
 * @example
 * await renderListAsync(container, largeArray, renderItem, 50);
 */
export function renderListAsync(container, items, renderItemFn, batchSize = 50) {
    return new Promise((resolve) => {
        if (!container || !items.length) {
            resolve();
            return;
        }

        container.innerHTML = '';
        let index = 0;

        function renderBatch() {
            const fragment = document.createDocumentFragment();
            const end = Math.min(index + batchSize, items.length);

            for (let i = index; i < end; i++) {
                const rendered = renderItemFn(items[i], i);
                if (typeof rendered === 'string') {
                    const temp = document.createElement('div');
                    temp.innerHTML = rendered;
                    while (temp.firstChild) {
                        fragment.appendChild(temp.firstChild);
                    }
                } else if (rendered instanceof HTMLElement) {
                    fragment.appendChild(rendered);
                }
            }

            container.appendChild(fragment);
            index = end;

            if (index < items.length) {
                requestAnimationFrame(renderBatch);
            } else {
                resolve();
            }
        }

        requestAnimationFrame(renderBatch);
    });
}

/**
 * 虚拟滚动渲染（仅渲染可见区域）
 * @param {Object} config - 配置对象
 * @param {HTMLElement} config.container - 容器元素
 * @param {Array} config.items - 数据项数组
 * @param {Function} config.renderItemFn - 渲染函数
 * @param {number} config.itemHeight - 每项高度（像素）
 * @param {number} [config.overscan=5] - 额外渲染的项数（上下各）
 * @returns {Object} 包含 update 和 destroy 方法的对象
 */
export function createVirtualScroll({ container, items, renderItemFn, itemHeight, overscan = 5 }) {
    if (!container) return { update: () => {}, destroy: () => {} };

    const totalHeight = items.length * itemHeight;
    const viewportHeight = container.clientHeight;

    // 创建占位容器
    const placeholder = document.createElement('div');
    placeholder.style.height = `${totalHeight}px`;
    placeholder.style.position = 'relative';

    const content = document.createElement('div');
    content.style.position = 'absolute';
    content.style.top = '0';
    content.style.width = '100%';

    placeholder.appendChild(content);
    container.innerHTML = '';
    container.appendChild(placeholder);

    function render() {
        const scrollTop = container.scrollTop;
        const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
        const endIndex = Math.min(
            items.length,
            Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan
        );

        const fragment = document.createDocumentFragment();

        for (let i = startIndex; i < endIndex; i++) {
            const element = renderItemFn(items[i], i);
            if (typeof element === 'string') {
                const temp = document.createElement('div');
                temp.innerHTML = element;
                while (temp.firstChild) {
                    fragment.appendChild(temp.firstChild);
                }
            } else if (element instanceof HTMLElement) {
                fragment.appendChild(element);
            }
        }

        content.style.top = `${startIndex * itemHeight}px`;
        content.innerHTML = '';
        content.appendChild(fragment);
    }

    const handleScroll = () => requestAnimationFrame(render);
    container.addEventListener('scroll', handleScroll);

    // 初始渲染
    render();

    return {
        update: (newItems) => {
            items = newItems;
            placeholder.style.height = `${newItems.length * itemHeight}px`;
            render();
        },
        destroy: () => {
            container.removeEventListener('scroll', handleScroll);
        }
    };
}

/**
 * 防抖包装器（用于搜索、输入等）
 * @param {Function} fn - 要防抖的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
export function debounce(fn, delay = 300) {
    let timer;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * 节流包装器（用于滚动、resize 等）
 * @param {Function} fn - 要节流的函数
 * @param {number} limit - 限制时间（毫秒）
 * @returns {Function} 节流后的函数
 */
export function throttle(fn, limit = 100) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            fn.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}
