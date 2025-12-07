/**
 * 常量配置文件
 * 集中管理应用中的所有常量，避免魔法数字和硬编码字符串
 */

// ============================================================
// 时间相关常量（毫秒）
// ============================================================

/**
 * 配置缓存过期时间（30秒）
 * 用于减少服务器压力，避免频繁请求配置数据
 */
export const CACHE_EXPIRY_MS = 30 * 1000;

/**
 * 通知显示持续时间（3秒）
 * 成功/错误/信息提示框的自动消失时间
 */
export const NOTIFICATION_DURATION_MS = 3 * 1000;

/**
 * 状态更新定时器间隔（1秒）
 * 连接状态和系统信息的更新频率
 */
export const STATUS_UPDATE_INTERVAL_MS = 1 * 1000;

/**
 * 日志刷新延迟（500毫秒）
 * 日志自动刷新的去抖延迟
 */
export const LOG_REFRESH_DELAY_MS = 500;

/**
 * OAuth 状态轮询间隔（2秒）
 * 检查 OAuth 认证完成状态的轮询频率
 */
export const OAUTH_POLL_INTERVAL_MS = 2 * 1000;

/**
 * OAuth 最大轮询时间（5分钟）
 * 超过此时间后停止轮询，认为授权超时
 */
export const OAUTH_MAX_POLL_DURATION_MS = 5 * 60 * 1000;

// ============================================================
// 数据限制常量
// ============================================================

/**
 * 最大日志显示行数
 * 限制内存占用，避免大量日志导致页面卡顿
 */
export const MAX_LOG_LINES = 2000;

/**
 * 日志接口获取数量上限
 * 限制后端返回的日志行数，避免一次拉取过多数据
 */
export const LOG_FETCH_LIMIT = 2500;

/**
 * 认证文件列表默认每页显示数量
 */
export const DEFAULT_AUTH_FILES_PAGE_SIZE = 9;

/**
 * 认证文件每页最小显示数量
 */
export const MIN_AUTH_FILES_PAGE_SIZE = 3;

/**
 * 认证文件每页最大显示数量
 */
export const MAX_AUTH_FILES_PAGE_SIZE = 60;

/**
 * 使用统计图表最大数据点数
 * 超过此数量将进行聚合，提高渲染性能
 */
export const MAX_CHART_DATA_POINTS = 100;

// ============================================================
// 网络相关常量
// ============================================================

/**
 * 默认 API 服务器端口
 */
export const DEFAULT_API_PORT = 8317;

/**
 * 默认 API 基础路径
 */
export const DEFAULT_API_BASE = `http://localhost:${DEFAULT_API_PORT}`;

/**
 * 管理 API 路径前缀
 */
export const MANAGEMENT_API_PREFIX = '/v0/management';

/**
 * 请求超时时间（30秒）
 */
export const REQUEST_TIMEOUT_MS = 30 * 1000;

// ============================================================
// OAuth 相关常量
// ============================================================

/**
 * OAuth 卡片元素 ID 列表
 * 用于根据主机环境隐藏/显示不同的 OAuth 选项
 * 注意: iflow-oauth-card 不在此列表中,因为它包含Cookie登录功能,该功能可在远程使用
 */
export const OAUTH_CARD_IDS = [
    'codex-oauth-card',
    'anthropic-oauth-card',
    'antigravity-oauth-card',
    'gemini-cli-oauth-card',
    'qwen-oauth-card'
];

/**
 * OAuth 提供商名称映射
 */
export const OAUTH_PROVIDERS = {
    CODEX: 'codex',
    ANTHROPIC: 'anthropic',
    ANTIGRAVITY: 'antigravity',
    GEMINI_CLI: 'gemini-cli',
    QWEN: 'qwen',
    IFLOW: 'iflow'
};

// ============================================================
// 本地存储键名
// ============================================================

/**
 * 本地存储键名前缀
 */
export const STORAGE_PREFIX = 'cliProxyApi_';

/**
 * 存储 API 基础地址的键名
 */
export const STORAGE_KEY_API_BASE = `${STORAGE_PREFIX}apiBase`;

/**
 * 存储管理密钥的键名
 */
export const STORAGE_KEY_MANAGEMENT_KEY = `${STORAGE_PREFIX}managementKey`;

/**
 * 存储主题偏好的键名
 */
export const STORAGE_KEY_THEME = `${STORAGE_PREFIX}theme`;

/**
 * 存储语言偏好的键名
 */
export const STORAGE_KEY_LANGUAGE = `${STORAGE_PREFIX}language`;

/**
 * 存储认证文件页大小的键名
 */
export const STORAGE_KEY_AUTH_FILES_PAGE_SIZE = `${STORAGE_PREFIX}authFilesPageSize`;

// ============================================================
// UI 相关常量
// ============================================================

/**
 * 主题选项
 */
export const THEMES = {
    LIGHT: 'light',
    DARK: 'dark'
};

/**
 * 支持的语言
 */
export const LANGUAGES = {
    ZH_CN: 'zh-CN',
    EN_US: 'en-US'
};

/**
 * 通知类型
 */
export const NOTIFICATION_TYPES = {
    SUCCESS: 'success',
    ERROR: 'error',
    INFO: 'info',
    WARNING: 'warning'
};

/**
 * 模态框尺寸
 */
export const MODAL_SIZES = {
    SMALL: 'small',
    MEDIUM: 'medium',
    LARGE: 'large'
};

// ============================================================
// 正则表达式常量
// ============================================================

/**
 * URL 验证正则
 */
export const URL_PATTERN = /^https?:\/\/.+/;

/**
 * Email 验证正则
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 端口号验证正则（1-65535）
 */
export const PORT_PATTERN = /^([1-9][0-9]{0,3}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$/;

// ============================================================
// 文件类型常量
// ============================================================

/**
 * 支持的认证文件类型
 */
export const AUTH_FILE_TYPES = {
    JSON: 'application/json',
    YAML: 'application/x-yaml'
};

/**
 * 认证文件最大大小（10MB）
 */
export const MAX_AUTH_FILE_SIZE = 10 * 1024 * 1024;

// ============================================================
// API 端点常量
// ============================================================

/**
 * 常用 API 端点路径
 */
export const API_ENDPOINTS = {
    CONFIG: '/config',
    DEBUG: '/debug',
    API_KEYS: '/api-keys',
    PROVIDERS: '/providers',
    AUTH_FILES: '/auth-files',
    LOGS: '/logs',
    USAGE_STATS: '/usage-stats',
    CONNECTION: '/connection',
    CODEX_API_KEY: '/codex-api-key',
    ANTHROPIC_API_KEY: '/anthropic-api-key',
    GEMINI_API_KEY: '/gemini-api-key',
    OPENAI_API_KEY: '/openai-api-key'
};

// ============================================================
// 错误消息常量
// ============================================================

/**
 * 通用错误消息
 */
export const ERROR_MESSAGES = {
    NETWORK_ERROR: '网络连接失败，请检查服务器状态',
    TIMEOUT: '请求超时，请稍后重试',
    UNAUTHORIZED: '未授权，请检查管理密钥',
    NOT_FOUND: '资源不存在',
    SERVER_ERROR: '服务器错误，请联系管理员',
    INVALID_INPUT: '输入数据无效',
    OPERATION_FAILED: '操作失败，请稍后重试'
};
