/**
 * 错误处理器
 * 统一管理应用中的错误处理逻辑
 */

import { ERROR_MESSAGES } from '../utils/constants.js';

/**
 * 错误处理器类
 * 提供统一的错误处理接口，确保错误处理的一致性
 */
export class ErrorHandler {
    /**
     * 构造错误处理器
     * @param {Object} notificationService - 通知服务对象
     * @param {Function} notificationService.show - 显示通知的方法
     */
    constructor(notificationService) {
        this.notificationService = notificationService;
    }

    /**
     * 处理更新操作失败
     * 包括显示错误通知和执行UI回滚操作
     *
     * @param {Error} error - 错误对象
     * @param {string} context - 操作上下文（如"调试模式"、"代理设置"）
     * @param {Function} [rollbackFn] - UI回滚函数
     *
     * @example
     * try {
     *     await this.makeRequest('/debug', { method: 'PATCH', body: JSON.stringify({ enabled: true }) });
     * } catch (error) {
     *     this.errorHandler.handleUpdateError(
     *         error,
     *         '调试模式',
     *         () => document.getElementById('debug-toggle').checked = false
     *     );
     * }
     */
    handleUpdateError(error, context, rollbackFn) {
        console.error(`更新${context}失败:`, error);
        const message = `更新${context}失败: ${error.message || ERROR_MESSAGES.OPERATION_FAILED}`;
        this.notificationService.show(message, 'error');

        // 执行回滚操作
        if (typeof rollbackFn === 'function') {
            try {
                rollbackFn();
            } catch (rollbackError) {
                console.error('UI回滚操作失败:', rollbackError);
            }
        }
    }

    /**
     * 处理加载操作失败
     *
     * @param {Error} error - 错误对象
     * @param {string} context - 加载内容的上下文（如"API密钥"、"使用统计"）
     *
     * @example
     * try {
     *     const data = await this.makeRequest('/api-keys');
     *     this.renderApiKeys(data);
     * } catch (error) {
     *     this.errorHandler.handleLoadError(error, 'API密钥');
     * }
     */
    handleLoadError(error, context) {
        console.error(`加载${context}失败:`, error);
        const message = `加载${context}失败，请检查连接`;
        this.notificationService.show(message, 'error');
    }

    /**
     * 处理删除操作失败
     *
     * @param {Error} error - 错误对象
     * @param {string} context - 删除内容的上下文
     */
    handleDeleteError(error, context) {
        console.error(`删除${context}失败:`, error);
        const message = `删除${context}失败: ${error.message || ERROR_MESSAGES.OPERATION_FAILED}`;
        this.notificationService.show(message, 'error');
    }

    /**
     * 处理添加操作失败
     *
     * @param {Error} error - 错误对象
     * @param {string} context - 添加内容的上下文
     */
    handleAddError(error, context) {
        console.error(`添加${context}失败:`, error);
        const message = `添加${context}失败: ${error.message || ERROR_MESSAGES.OPERATION_FAILED}`;
        this.notificationService.show(message, 'error');
    }

    /**
     * 处理网络错误
     * 检测常见的网络问题并提供友好的错误提示
     *
     * @param {Error} error - 错误对象
     */
    handleNetworkError(error) {
        console.error('网络请求失败:', error);

        let message = ERROR_MESSAGES.NETWORK_ERROR;

        // 检测特定错误类型
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            message = ERROR_MESSAGES.NETWORK_ERROR;
        } else if (error.message && error.message.includes('timeout')) {
            message = ERROR_MESSAGES.TIMEOUT;
        } else if (error.message && error.message.includes('401')) {
            message = ERROR_MESSAGES.UNAUTHORIZED;
        } else if (error.message && error.message.includes('404')) {
            message = ERROR_MESSAGES.NOT_FOUND;
        } else if (error.message && error.message.includes('500')) {
            message = ERROR_MESSAGES.SERVER_ERROR;
        } else if (error.message) {
            message = `网络错误: ${error.message}`;
        }

        this.notificationService.show(message, 'error');
    }

    /**
     * 处理验证错误
     *
     * @param {string} fieldName - 字段名称
     * @param {string} [message] - 自定义错误消息
     */
    handleValidationError(fieldName, message) {
        const errorMessage = message || `请输入有效的${fieldName}`;
        this.notificationService.show(errorMessage, 'error');
    }

    /**
     * 处理通用错误
     * 当错误类型不明确时使用
     *
     * @param {Error} error - 错误对象
     * @param {string} [defaultMessage] - 默认错误消息
     */
    handleGenericError(error, defaultMessage) {
        console.error('操作失败:', error);
        const message = error.message || defaultMessage || ERROR_MESSAGES.OPERATION_FAILED;
        this.notificationService.show(message, 'error');
    }

    /**
     * 创建带错误处理的异步函数包装器
     * 自动捕获并处理错误
     *
     * @param {Function} asyncFn - 异步函数
     * @param {string} context - 操作上下文
     * @param {Function} [rollbackFn] - 回滚函数
     * @returns {Function} 包装后的函数
     *
     * @example
     * const safeUpdate = this.errorHandler.withErrorHandling(
     *     () => this.makeRequest('/debug', { method: 'PATCH', body: '...' }),
     *     '调试模式',
     *     () => document.getElementById('debug-toggle').checked = false
     * );
     * await safeUpdate();
     */
    withErrorHandling(asyncFn, context, rollbackFn) {
        return async (...args) => {
            try {
                return await asyncFn(...args);
            } catch (error) {
                this.handleUpdateError(error, context, rollbackFn);
                throw error; // 重新抛出以便调用者处理
            }
        };
    }

    /**
     * 创建带重试机制的错误处理包装器
     *
     * @param {Function} asyncFn - 异步函数
     * @param {number} [maxRetries=3] - 最大重试次数
     * @param {number} [retryDelay=1000] - 重试延迟（毫秒）
     * @returns {Function} 包装后的函数
     *
     * @example
     * const retryableFetch = this.errorHandler.withRetry(
     *     () => this.makeRequest('/config'),
     *     3,
     *     2000
     * );
     * const config = await retryableFetch();
     */
    withRetry(asyncFn, maxRetries = 3, retryDelay = 1000) {
        return async (...args) => {
            let lastError;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    return await asyncFn(...args);
                } catch (error) {
                    lastError = error;
                    console.warn(`尝试 ${attempt + 1}/${maxRetries} 失败:`, error);

                    if (attempt < maxRetries - 1) {
                        // 等待后重试
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                    }
                }
            }

            // 所有尝试都失败
            throw lastError;
        };
    }
}

/**
 * 创建错误处理器工厂函数
 * 便于在不同模块中创建错误处理器实例
 *
 * @param {Function} showNotification - 显示通知的函数
 * @returns {ErrorHandler} 错误处理器实例
 */
export function createErrorHandler(showNotification) {
    return new ErrorHandler({
        show: showNotification
    });
}
