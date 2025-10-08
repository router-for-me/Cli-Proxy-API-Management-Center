// 国际化语言包
const i18n = {
    // 语言配置
    currentLanguage: 'zh-CN',
    fallbackLanguage: 'zh-CN',

    // 语言包
    translations: {
        'zh-CN': {
            // 通用
            'common.login': '登录',
            'common.logout': '登出',
            'common.cancel': '取消',
            'common.confirm': '确认',
            'common.save': '保存',
            'common.delete': '删除',
            'common.edit': '编辑',
            'common.add': '添加',
            'common.update': '更新',
            'common.refresh': '刷新',
            'common.close': '关闭',
            'common.success': '成功',
            'common.error': '错误',
            'common.info': '信息',
            'common.warning': '警告',
            'common.loading': '加载中...',
            'common.connecting': '连接中...',
            'common.connected': '已连接',
            'common.disconnected': '未连接',
            'common.connecting_status': '连接中',
            'common.connected_status': '已连接',
            'common.disconnected_status': '未连接',
            'common.yes': '是',
            'common.no': '否',
            'common.optional': '可选',
            'common.required': '必填',
            'common.api_key': '密钥',
            'common.base_url': '地址',
            'common.proxy_url': '代理',
            'common.alias': '别名',

            // 页面标题
            'title.main': 'CLI Proxy API Management Center',
            'title.login': 'CLI Proxy API Management Center',

            // 自动登录
            'auto_login.title': '正在自动登录...',
            'auto_login.message': '正在使用本地保存的连接信息尝试连接服务器',

            // 登录页面
            'login.subtitle': '请输入连接信息以访问管理界面',
            'login.connection_title': '连接地址',
            'login.connection_current': '当前地址',
            'login.connection_auto_hint': '系统将自动使用当前访问地址进行连接',
            'login.custom_connection_label': '自定义连接地址:',
            'login.custom_connection_placeholder': '例如: https://example.com:8317',
            'login.custom_connection_hint': '默认使用当前访问地址，若需要可手动输入其他地址。',
            'login.use_current_address': '使用当前地址',
            'login.management_key_label': '管理密钥:',
            'login.management_key_placeholder': '请输入管理密钥',
            'login.connect_button': '连接',
            'login.submit_button': '登录',
            'login.submitting': '连接中...',
            'login.error_title': '登录失败',
            'login.error_required': '请填写完整的连接信息',
            'login.error_invalid': '连接失败，请检查地址和密钥',

            // 头部导航
            'header.check_connection': '检查连接',
            'header.refresh_all': '刷新全部',
            'header.logout': '登出',

            // 连接信息
            'connection.title': '连接信息',
            'connection.server_address': '服务器地址:',
            'connection.management_key': '管理密钥:',
            'connection.status': '连接状态:',

            // 侧边栏导航
            'nav.basic_settings': '基础设置',
            'nav.api_keys': 'API 密钥',
            'nav.ai_providers': 'AI 提供商',
            'nav.auth_files': '认证文件',
            'nav.usage_stats': '使用统计',
            'nav.system_info': '系统信息',

            // 基础设置
            'basic_settings.title': '基础设置',
            'basic_settings.debug_title': '调试模式',
            'basic_settings.debug_enable': '启用调试模式',
            'basic_settings.proxy_title': '代理设置',
            'basic_settings.proxy_url_label': '代理 URL:',
            'basic_settings.proxy_url_placeholder': '例如: socks5://user:pass@127.0.0.1:1080/',
            'basic_settings.proxy_update': '更新',
            'basic_settings.proxy_clear': '清空',
            'basic_settings.retry_title': '请求重试',
            'basic_settings.retry_count_label': '重试次数:',
            'basic_settings.retry_update': '更新',
            'basic_settings.quota_title': '配额超出行为',
            'basic_settings.quota_switch_project': '自动切换项目',
            'basic_settings.quota_switch_preview': '切换到预览模型',

            // API 密钥管理
            'api_keys.title': 'API 密钥管理',
            'api_keys.proxy_auth_title': '代理服务认证密钥',
            'api_keys.add_button': '添加密钥',
            'api_keys.empty_title': '暂无API密钥',
            'api_keys.empty_desc': '点击上方按钮添加第一个密钥',
            'api_keys.item_title': 'API密钥',
            'api_keys.add_modal_title': '添加API密钥',
            'api_keys.add_modal_key_label': 'API密钥:',
            'api_keys.add_modal_key_placeholder': '请输入API密钥',
            'api_keys.edit_modal_title': '编辑API密钥',
            'api_keys.edit_modal_key_label': 'API密钥:',
            'api_keys.delete_confirm': '确定要删除这个API密钥吗？',

            // AI 提供商
            'ai_providers.title': 'AI 提供商配置',
            'ai_providers.gemini_title': 'Gemini API 密钥',
            'ai_providers.gemini_add_button': '添加密钥',
            'ai_providers.gemini_empty_title': '暂无Gemini密钥',
            'ai_providers.gemini_empty_desc': '点击上方按钮添加第一个密钥',
            'ai_providers.gemini_item_title': 'Gemini密钥',
            'ai_providers.gemini_add_modal_title': '添加Gemini API密钥',
            'ai_providers.gemini_add_modal_key_label': 'API密钥:',
            'ai_providers.gemini_add_modal_key_placeholder': '请输入Gemini API密钥',
            'ai_providers.gemini_edit_modal_title': '编辑Gemini API密钥',
            'ai_providers.gemini_edit_modal_key_label': 'API密钥:',
            'ai_providers.gemini_delete_confirm': '确定要删除这个Gemini密钥吗？',

            'ai_providers.codex_title': 'Codex API 配置',
            'ai_providers.codex_add_button': '添加配置',
            'ai_providers.codex_empty_title': '暂无Codex配置',
            'ai_providers.codex_empty_desc': '点击上方按钮添加第一个配置',
            'ai_providers.codex_item_title': 'Codex配置',
            'ai_providers.codex_add_modal_title': '添加Codex API配置',
            'ai_providers.codex_add_modal_key_label': 'API密钥:',
            'ai_providers.codex_add_modal_key_placeholder': '请输入Codex API密钥',
            'ai_providers.codex_add_modal_url_label': 'Base URL (可选):',
            'ai_providers.codex_add_modal_url_placeholder': '例如: https://api.example.com',
            'ai_providers.codex_add_modal_proxy_label': '代理 URL (可选):',
            'ai_providers.codex_add_modal_proxy_placeholder': '例如: socks5://proxy.example.com:1080',
            'ai_providers.codex_edit_modal_title': '编辑Codex API配置',
            'ai_providers.codex_edit_modal_key_label': 'API密钥:',
            'ai_providers.codex_edit_modal_url_label': 'Base URL (可选):',
            'ai_providers.codex_edit_modal_proxy_label': '代理 URL (可选):',
            'ai_providers.codex_delete_confirm': '确定要删除这个Codex配置吗？',

            'ai_providers.claude_title': 'Claude API 配置',
            'ai_providers.claude_add_button': '添加配置',
            'ai_providers.claude_empty_title': '暂无Claude配置',
            'ai_providers.claude_empty_desc': '点击上方按钮添加第一个配置',
            'ai_providers.claude_item_title': 'Claude配置',
            'ai_providers.claude_add_modal_title': '添加Claude API配置',
            'ai_providers.claude_add_modal_key_label': 'API密钥:',
            'ai_providers.claude_add_modal_key_placeholder': '请输入Claude API密钥',
            'ai_providers.claude_add_modal_url_label': 'Base URL (可选):',
            'ai_providers.claude_add_modal_url_placeholder': '例如: https://api.anthropic.com',
            'ai_providers.claude_add_modal_proxy_label': '代理 URL (可选):',
            'ai_providers.claude_add_modal_proxy_placeholder': '例如: socks5://proxy.example.com:1080',
            'ai_providers.claude_edit_modal_title': '编辑Claude API配置',
            'ai_providers.claude_edit_modal_key_label': 'API密钥:',
            'ai_providers.claude_edit_modal_url_label': 'Base URL (可选):',
            'ai_providers.claude_edit_modal_proxy_label': '代理 URL (可选):',
            'ai_providers.claude_delete_confirm': '确定要删除这个Claude配置吗？',

            'ai_providers.openai_title': 'OpenAI 兼容提供商',
            'ai_providers.openai_add_button': '添加提供商',
            'ai_providers.openai_empty_title': '暂无OpenAI兼容提供商',
            'ai_providers.openai_empty_desc': '点击上方按钮添加第一个提供商',
            'ai_providers.openai_add_modal_title': '添加OpenAI兼容提供商',
            'ai_providers.openai_add_modal_name_label': '提供商名称:',
            'ai_providers.openai_add_modal_name_placeholder': '例如: openrouter',
            'ai_providers.openai_add_modal_url_label': 'Base URL:',
            'ai_providers.openai_add_modal_url_placeholder': '例如: https://openrouter.ai/api/v1',
            'ai_providers.openai_add_modal_keys_label': 'API密钥 (每行一个):',
            'ai_providers.openai_add_modal_keys_placeholder': 'sk-key1\nsk-key2',
            'ai_providers.openai_add_modal_keys_proxy_label': '代理 URL (按行对应，可选):',
            'ai_providers.openai_add_modal_keys_proxy_placeholder': 'socks5://proxy.example.com:1080\n',
            'ai_providers.openai_add_modal_models_label': '模型列表 (name[, alias] 每行一个):',
            'ai_providers.openai_models_hint': '示例：gpt-4o-mini 或 moonshotai/kimi-k2:free, kimi-k2',
            'ai_providers.openai_model_name_placeholder': '模型名称，如 moonshotai/kimi-k2:free',
            'ai_providers.openai_model_alias_placeholder': '模型别名 (可选)',
            'ai_providers.openai_models_add_btn': '添加模型',
            'ai_providers.openai_edit_modal_title': '编辑OpenAI兼容提供商',
            'ai_providers.openai_edit_modal_name_label': '提供商名称:',
            'ai_providers.openai_edit_modal_url_label': 'Base URL:',
            'ai_providers.openai_edit_modal_keys_label': 'API密钥 (每行一个):',
            'ai_providers.openai_edit_modal_keys_proxy_label': '代理 URL (按行对应，可选):',
            'ai_providers.openai_edit_modal_models_label': '模型列表 (name[, alias] 每行一个):',
            'ai_providers.openai_delete_confirm': '确定要删除这个OpenAI提供商吗？',
            'ai_providers.openai_keys_count': '密钥数量',
            'ai_providers.openai_models_count': '模型数量',


            // 认证文件管理
            'auth_files.title': '认证文件管理',
            'auth_files.title_section': '认证文件',
            'auth_files.description': '这里管理 Qwen 和 Gemini 的认证配置文件。上传 JSON 格式的认证文件以启用相应的 AI 服务。',
            'auth_files.upload_button': '上传文件',
            'auth_files.delete_all_button': '删除全部',
            'auth_files.empty_title': '暂无认证文件',
            'auth_files.empty_desc': '点击上方按钮上传第一个文件',
            'auth_files.file_size': '大小',
            'auth_files.file_modified': '修改时间',
            'auth_files.download_button': '下载',
            'auth_files.delete_button': '删除',
            'auth_files.delete_confirm': '确定要删除文件',
            'auth_files.delete_all_confirm': '确定要删除所有认证文件吗？此操作不可恢复！',
            'auth_files.upload_error_json': '只能上传JSON文件',
            'auth_files.upload_success': '文件上传成功',
            'auth_files.download_success': '文件下载成功',
            'auth_files.delete_success': '文件删除成功',
            'auth_files.delete_all_success': '成功删除',
            'auth_files.files_count': '个文件',

            // Gemini Web Token
            'auth_login.gemini_web_title': 'Gemini Web Token',
            'auth_login.gemini_web_button': '保存 Gemini Web Token',
            'auth_login.gemini_web_hint': '从浏览器开发者工具中获取 Gemini 网页版的 Cookie 值，用于直接认证访问 Gemini。',
            'auth_login.secure_1psid_label': '__Secure-1PSID Cookie:',
            'auth_login.secure_1psid_placeholder': '输入 __Secure-1PSID cookie 值',
            'auth_login.secure_1psidts_label': '__Secure-1PSIDTS Cookie:',
            'auth_login.secure_1psidts_placeholder': '输入 __Secure-1PSIDTS cookie 值',
            'auth_login.gemini_web_label_label': '标签 (可选):',
            'auth_login.gemini_web_label_placeholder': '输入标签名称 (可选)',
            'auth_login.gemini_web_saved': 'Gemini Web Token 保存成功',

            // Codex OAuth
            'auth_login.codex_oauth_title': 'Codex OAuth',
            'auth_login.codex_oauth_button': '开始 Codex 登录',
            'auth_login.codex_oauth_hint': '通过 OAuth 流程登录 Codex 服务，自动获取并保存认证文件。',
            'auth_login.codex_oauth_url_label': '授权链接:',
            'auth_login.codex_open_link': '打开链接',
            'auth_login.codex_copy_link': '复制链接',
            'auth_login.codex_oauth_status_waiting': '等待认证中...',
            'auth_login.codex_oauth_status_success': '认证成功！',
            'auth_login.codex_oauth_status_error': '认证失败:',
            'auth_login.codex_oauth_start_error': '启动 Codex OAuth 失败:',
            'auth_login.codex_oauth_polling_error': '检查认证状态失败:',

            // Anthropic OAuth
            'auth_login.anthropic_oauth_title': 'Anthropic OAuth',
            'auth_login.anthropic_oauth_button': '开始 Anthropic 登录',
            'auth_login.anthropic_oauth_hint': '通过 OAuth 流程登录 Anthropic (Claude) 服务，自动获取并保存认证文件。',
            'auth_login.anthropic_oauth_url_label': '授权链接:',
            'auth_login.anthropic_open_link': '打开链接',
            'auth_login.anthropic_copy_link': '复制链接',
            'auth_login.anthropic_oauth_status_waiting': '等待认证中...',
            'auth_login.anthropic_oauth_status_success': '认证成功！',
            'auth_login.anthropic_oauth_status_error': '认证失败:',
            'auth_login.anthropic_oauth_start_error': '启动 Anthropic OAuth 失败:',
            'auth_login.anthropic_oauth_polling_error': '检查认证状态失败:',

            // Gemini CLI OAuth
            'auth_login.gemini_cli_oauth_title': 'Gemini CLI OAuth',
            'auth_login.gemini_cli_oauth_button': '开始 Gemini CLI 登录',
            'auth_login.gemini_cli_oauth_hint': '通过 OAuth 流程登录 Google Gemini CLI 服务，自动获取并保存认证文件。',
            'auth_login.gemini_cli_project_id_label': 'Google Cloud 项目 ID (可选):',
            'auth_login.gemini_cli_project_id_placeholder': '输入 Google Cloud 项目 ID (可选)',
            'auth_login.gemini_cli_project_id_hint': '如果指定了项目 ID，将使用该项目的认证信息。',
            'auth_login.gemini_cli_oauth_url_label': '授权链接:',
            'auth_login.gemini_cli_open_link': '打开链接',
            'auth_login.gemini_cli_copy_link': '复制链接',
            'auth_login.gemini_cli_oauth_status_waiting': '等待认证中...',
            'auth_login.gemini_cli_oauth_status_success': '认证成功！',
            'auth_login.gemini_cli_oauth_status_error': '认证失败:',
            'auth_login.gemini_cli_oauth_start_error': '启动 Gemini CLI OAuth 失败:',
            'auth_login.gemini_cli_oauth_polling_error': '检查认证状态失败:',

            // Qwen OAuth
            'auth_login.qwen_oauth_title': 'Qwen OAuth',
            'auth_login.qwen_oauth_button': '开始 Qwen 登录',
            'auth_login.qwen_oauth_hint': '通过设备授权流程登录 Qwen 服务，自动获取并保存认证文件。',
            'auth_login.qwen_oauth_url_label': '授权链接:',
            'auth_login.qwen_open_link': '打开链接',
            'auth_login.qwen_copy_link': '复制链接',
            'auth_login.qwen_oauth_status_waiting': '等待认证中...',
            'auth_login.qwen_oauth_status_success': '认证成功！',
            'auth_login.qwen_oauth_status_error': '认证失败:',
            'auth_login.qwen_oauth_start_error': '启动 Qwen OAuth 失败:',
            'auth_login.qwen_oauth_polling_error': '检查认证状态失败:',

            // iFlow OAuth
            'auth_login.iflow_oauth_title': 'iFlow OAuth',
            'auth_login.iflow_oauth_button': '开始 iFlow 登录',
            'auth_login.iflow_oauth_hint': '通过 OAuth 流程登录 iFlow 服务，自动获取并保存认证文件。',
            'auth_login.iflow_oauth_url_label': '授权链接:',
            'auth_login.iflow_open_link': '打开链接',
            'auth_login.iflow_copy_link': '复制链接',
            'auth_login.iflow_oauth_status_waiting': '等待认证中...',
            'auth_login.iflow_oauth_status_success': '认证成功！',
            'auth_login.iflow_oauth_status_error': '认证失败:',
            'auth_login.iflow_oauth_start_error': '启动 iFlow OAuth 失败:',
            'auth_login.iflow_oauth_polling_error': '检查认证状态失败:',

            // 使用统计
            'usage_stats.title': '使用统计',
            'usage_stats.total_requests': '总请求数',
            'usage_stats.success_requests': '成功请求',
            'usage_stats.failed_requests': '失败请求',
            'usage_stats.total_tokens': '总Token数',
            'usage_stats.requests_trend': '请求趋势',
            'usage_stats.tokens_trend': 'Token 使用趋势',
            'usage_stats.api_details': 'API 详细统计',
            'usage_stats.by_hour': '按小时',
            'usage_stats.by_day': '按天',
            'usage_stats.refresh': '刷新',
            'usage_stats.no_data': '暂无数据',
            'usage_stats.loading_error': '加载失败',
            'usage_stats.api_endpoint': 'API端点',
            'usage_stats.requests_count': '请求次数',
            'usage_stats.tokens_count': 'Token数量',
            'usage_stats.models': '模型统计',
            'usage_stats.success_rate': '成功率',

            // 系统信息
            'system_info.title': '系统信息',
            'system_info.connection_status_title': '连接状态',
            'system_info.api_status_label': 'API 状态:',
            'system_info.config_status_label': '配置状态:',
            'system_info.last_update_label': '最后更新:',
            'system_info.cache_data': '缓存数据',
            'system_info.real_time_data': '实时数据',
            'system_info.not_loaded': '未加载',
            'system_info.seconds_ago': '秒前',

            // 通知消息
            'notification.debug_updated': '调试设置已更新',
            'notification.proxy_updated': '代理设置已更新',
            'notification.proxy_cleared': '代理设置已清空',
            'notification.retry_updated': '重试设置已更新',
            'notification.quota_switch_project_updated': '项目切换设置已更新',
            'notification.quota_switch_preview_updated': '预览模型切换设置已更新',
            'notification.api_key_added': 'API密钥添加成功',
            'notification.api_key_updated': 'API密钥更新成功',
            'notification.api_key_deleted': 'API密钥删除成功',
            'notification.gemini_key_added': 'Gemini密钥添加成功',
            'notification.gemini_key_updated': 'Gemini密钥更新成功',
            'notification.gemini_key_deleted': 'Gemini密钥删除成功',
            'notification.codex_config_added': 'Codex配置添加成功',
            'notification.codex_config_updated': 'Codex配置更新成功',
            'notification.codex_config_deleted': 'Codex配置删除成功',
            'notification.claude_config_added': 'Claude配置添加成功',
            'notification.claude_config_updated': 'Claude配置更新成功',
            'notification.claude_config_deleted': 'Claude配置删除成功',
            'notification.field_required': '必填字段不能为空',
            'notification.openai_provider_required': '请填写提供商名称和Base URL',
            'notification.openai_provider_added': 'OpenAI提供商添加成功',
            'notification.openai_provider_updated': 'OpenAI提供商更新成功',
            'notification.openai_provider_deleted': 'OpenAI提供商删除成功',
            'notification.openai_model_name_required': '请填写模型名称',
            'notification.data_refreshed': '数据刷新成功',
            'notification.connection_required': '请先建立连接',
            'notification.refresh_failed': '刷新失败',
            'notification.update_failed': '更新失败',
            'notification.add_failed': '添加失败',
            'notification.delete_failed': '删除失败',
            'notification.upload_failed': '上传失败',
            'notification.download_failed': '下载失败',
            'notification.login_failed': '登录失败',
            'notification.please_enter': '请输入',
            'notification.please_fill': '请填写',
            'notification.provider_name_url': '提供商名称和Base URL',
            'notification.api_key': 'API密钥',
            'notification.gemini_api_key': 'Gemini API密钥',
            'notification.codex_api_key': 'Codex API密钥',
            'notification.claude_api_key': 'Claude API密钥',

            // 语言切换
            'language.switch': '语言',
            'language.chinese': '中文',
            'language.english': 'English',

            // 主题切换
            'theme.switch': '主题',
            'theme.light': '亮色',
            'theme.dark': '暗色',
            'theme.switch_to_light': '切换到亮色模式',
            'theme.switch_to_dark': '切换到暗色模式',
            'theme.auto': '跟随系统',

            // 页脚
            'footer.version': '版本',
            'footer.author': '作者'
        },

        'en-US': {
            // Common
            'common.login': 'Login',
            'common.logout': 'Logout',
            'common.cancel': 'Cancel',
            'common.confirm': 'Confirm',
            'common.save': 'Save',
            'common.delete': 'Delete',
            'common.edit': 'Edit',
            'common.add': 'Add',
            'common.update': 'Update',
            'common.refresh': 'Refresh',
            'common.close': 'Close',
            'common.success': 'Success',
            'common.error': 'Error',
            'common.info': 'Info',
            'common.warning': 'Warning',
            'common.loading': 'Loading...',
            'common.connecting': 'Connecting...',
            'common.connected': 'Connected',
            'common.disconnected': 'Disconnected',
            'common.connecting_status': 'Connecting',
            'common.connected_status': 'Connected',
            'common.disconnected_status': 'Disconnected',
            'common.yes': 'Yes',
            'common.no': 'No',
            'common.optional': 'Optional',
            'common.required': 'Required',
            'common.api_key': 'Key',
            'common.base_url': 'Address',
            'common.proxy_url': 'Proxy',
            'common.alias': 'Alias',

            // Page titles
            'title.main': 'CLI Proxy API Management Center',
            'title.login': 'CLI Proxy API Management Center',

            // Auto login
            'auto_login.title': 'Auto Login in Progress...',
            'auto_login.message': 'Attempting to connect to server using locally saved connection information',

            // Login page
            'login.subtitle': 'Please enter connection information to access the management interface',
            'login.connection_title': 'Connection Address',
            'login.connection_current': 'Current URL',
            'login.connection_auto_hint': 'The system will automatically use the current URL for connection',
            'login.custom_connection_label': 'Custom Connection URL:',
            'login.custom_connection_placeholder': 'Eg: https://example.com:8317',
            'login.custom_connection_hint': 'By default the current URL is used. Override it here if needed.',
            'login.use_current_address': 'Use Current URL',
            'login.management_key_label': 'Management Key:',
            'login.management_key_placeholder': 'Enter the management key',
            'login.connect_button': 'Connect',
            'login.submit_button': 'Login',
            'login.submitting': 'Connecting...',
            'login.error_title': 'Login Failed',
            'login.error_required': 'Please fill in complete connection information',
            'login.error_invalid': 'Connection failed, please check address and key',

            // Header navigation
            'header.check_connection': 'Check Connection',
            'header.refresh_all': 'Refresh All',
            'header.logout': 'Logout',

            // Connection info
            'connection.title': 'Connection Information',
            'connection.server_address': 'Server Address:',
            'connection.management_key': 'Management Key:',
            'connection.status': 'Connection Status:',

            // Sidebar navigation
            'nav.basic_settings': 'Basic Settings',
            'nav.api_keys': 'API Keys',
            'nav.ai_providers': 'AI Providers',
            'nav.auth_files': 'Auth Files',
            'nav.usage_stats': 'Usage Statistics',
            'nav.system_info': 'System Info',

            // Basic settings
            'basic_settings.title': 'Basic Settings',
            'basic_settings.debug_title': 'Debug Mode',
            'basic_settings.debug_enable': 'Enable Debug Mode',
            'basic_settings.proxy_title': 'Proxy Settings',
            'basic_settings.proxy_url_label': 'Proxy URL:',
            'basic_settings.proxy_url_placeholder': 'e.g.: socks5://user:pass@127.0.0.1:1080/',
            'basic_settings.proxy_update': 'Update',
            'basic_settings.proxy_clear': 'Clear',
            'basic_settings.retry_title': 'Request Retry',
            'basic_settings.retry_count_label': 'Retry Count:',
            'basic_settings.retry_update': 'Update',
            'basic_settings.quota_title': 'Quota Exceeded Behavior',
            'basic_settings.quota_switch_project': 'Auto Switch Project',
            'basic_settings.quota_switch_preview': 'Switch to Preview Model',

            // API Keys management
            'api_keys.title': 'API Keys Management',
            'api_keys.proxy_auth_title': 'Proxy Service Authentication Keys',
            'api_keys.add_button': 'Add Key',
            'api_keys.empty_title': 'No API Keys',
            'api_keys.empty_desc': 'Click the button above to add the first key',
            'api_keys.item_title': 'API Key',
            'api_keys.add_modal_title': 'Add API Key',
            'api_keys.add_modal_key_label': 'API Key:',
            'api_keys.add_modal_key_placeholder': 'Please enter API key',
            'api_keys.edit_modal_title': 'Edit API Key',
            'api_keys.edit_modal_key_label': 'API Key:',
            'api_keys.delete_confirm': 'Are you sure you want to delete this API key?',

            // AI Providers
            'ai_providers.title': 'AI Providers Configuration',
            'ai_providers.gemini_title': 'Gemini API Keys',
            'ai_providers.gemini_add_button': 'Add Key',
            'ai_providers.gemini_empty_title': 'No Gemini Keys',
            'ai_providers.gemini_empty_desc': 'Click the button above to add the first key',
            'ai_providers.gemini_item_title': 'Gemini Key',
            'ai_providers.gemini_add_modal_title': 'Add Gemini API Key',
            'ai_providers.gemini_add_modal_key_label': 'API Key:',
            'ai_providers.gemini_add_modal_key_placeholder': 'Please enter Gemini API key',
            'ai_providers.gemini_edit_modal_title': 'Edit Gemini API Key',
            'ai_providers.gemini_edit_modal_key_label': 'API Key:',
            'ai_providers.gemini_delete_confirm': 'Are you sure you want to delete this Gemini key?',

            'ai_providers.codex_title': 'Codex API Configuration',
            'ai_providers.codex_add_button': 'Add Configuration',
            'ai_providers.codex_empty_title': 'No Codex Configuration',
            'ai_providers.codex_empty_desc': 'Click the button above to add the first configuration',
            'ai_providers.codex_item_title': 'Codex Configuration',
            'ai_providers.codex_add_modal_title': 'Add Codex API Configuration',
            'ai_providers.codex_add_modal_key_label': 'API Key:',
            'ai_providers.codex_add_modal_key_placeholder': 'Please enter Codex API key',
            'ai_providers.codex_add_modal_url_label': 'Base URL (Optional):',
            'ai_providers.codex_add_modal_url_placeholder': 'e.g.: https://api.example.com',
            'ai_providers.codex_add_modal_proxy_label': 'Proxy URL (Optional):',
            'ai_providers.codex_add_modal_proxy_placeholder': 'e.g.: socks5://proxy.example.com:1080',
            'ai_providers.codex_edit_modal_title': 'Edit Codex API Configuration',
            'ai_providers.codex_edit_modal_key_label': 'API Key:',
            'ai_providers.codex_edit_modal_url_label': 'Base URL (Optional):',
            'ai_providers.codex_edit_modal_proxy_label': 'Proxy URL (Optional):',
            'ai_providers.codex_delete_confirm': 'Are you sure you want to delete this Codex configuration?',

            'ai_providers.claude_title': 'Claude API Configuration',
            'ai_providers.claude_add_button': 'Add Configuration',
            'ai_providers.claude_empty_title': 'No Claude Configuration',
            'ai_providers.claude_empty_desc': 'Click the button above to add the first configuration',
            'ai_providers.claude_item_title': 'Claude Configuration',
            'ai_providers.claude_add_modal_title': 'Add Claude API Configuration',
            'ai_providers.claude_add_modal_key_label': 'API Key:',
            'ai_providers.claude_add_modal_key_placeholder': 'Please enter Claude API key',
            'ai_providers.claude_add_modal_url_label': 'Base URL (Optional):',
            'ai_providers.claude_add_modal_url_placeholder': 'e.g.: https://api.anthropic.com',
            'ai_providers.claude_add_modal_proxy_label': 'Proxy URL (Optional):',
            'ai_providers.claude_add_modal_proxy_placeholder': 'e.g.: socks5://proxy.example.com:1080',
            'ai_providers.claude_edit_modal_title': 'Edit Claude API Configuration',
            'ai_providers.claude_edit_modal_key_label': 'API Key:',
            'ai_providers.claude_edit_modal_url_label': 'Base URL (Optional):',
            'ai_providers.claude_edit_modal_proxy_label': 'Proxy URL (Optional):',
            'ai_providers.claude_delete_confirm': 'Are you sure you want to delete this Claude configuration?',

            'ai_providers.openai_title': 'OpenAI Compatible Providers',
            'ai_providers.openai_add_button': 'Add Provider',
            'ai_providers.openai_empty_title': 'No OpenAI Compatible Providers',
            'ai_providers.openai_empty_desc': 'Click the button above to add the first provider',
            'ai_providers.openai_add_modal_title': 'Add OpenAI Compatible Provider',
            'ai_providers.openai_add_modal_name_label': 'Provider Name:',
            'ai_providers.openai_add_modal_name_placeholder': 'e.g.: openrouter',
            'ai_providers.openai_add_modal_url_label': 'Base URL:',
            'ai_providers.openai_add_modal_url_placeholder': 'e.g.: https://openrouter.ai/api/v1',
            'ai_providers.openai_add_modal_keys_label': 'API Keys (one per line):',
            'ai_providers.openai_add_modal_keys_placeholder': 'sk-key1\nsk-key2',
            'ai_providers.openai_add_modal_keys_proxy_label': 'Proxy URL (one per line, optional):',
            'ai_providers.openai_add_modal_keys_proxy_placeholder': 'socks5://proxy.example.com:1080\n',
            'ai_providers.openai_add_modal_models_label': 'Model List (name[, alias] one per line):',
            'ai_providers.openai_models_hint': 'Example: gpt-4o-mini or moonshotai/kimi-k2:free, kimi-k2',
            'ai_providers.openai_model_name_placeholder': 'Model name, e.g. moonshotai/kimi-k2:free',
            'ai_providers.openai_model_alias_placeholder': 'Model alias (optional)',
            'ai_providers.openai_models_add_btn': 'Add Model',
            'ai_providers.openai_edit_modal_title': 'Edit OpenAI Compatible Provider',
            'ai_providers.openai_edit_modal_name_label': 'Provider Name:',
            'ai_providers.openai_edit_modal_url_label': 'Base URL:',
            'ai_providers.openai_edit_modal_keys_label': 'API Keys (one per line):',
            'ai_providers.openai_edit_modal_keys_proxy_label': 'Proxy URL (one per line, optional):',
            'ai_providers.openai_edit_modal_models_label': 'Model List (name[, alias] one per line):',
            'ai_providers.openai_delete_confirm': 'Are you sure you want to delete this OpenAI provider?',
            'ai_providers.openai_keys_count': 'Keys Count',
            'ai_providers.openai_models_count': 'Models Count',


            // Auth files management
            'auth_files.title': 'Auth Files Management',
            'auth_files.title_section': 'Auth Files',
            'auth_files.description': 'Here you can manage authentication configuration files for Qwen and Gemini. Upload JSON format authentication files to enable the corresponding AI services.',
            'auth_files.upload_button': 'Upload File',
            'auth_files.delete_all_button': 'Delete All',
            'auth_files.empty_title': 'No Auth Files',
            'auth_files.empty_desc': 'Click the button above to upload the first file',
            'auth_files.file_size': 'Size',
            'auth_files.file_modified': 'Modified',
            'auth_files.download_button': 'Download',
            'auth_files.delete_button': 'Delete',
            'auth_files.delete_confirm': 'Are you sure you want to delete file',
            'auth_files.delete_all_confirm': 'Are you sure you want to delete all auth files? This operation cannot be undone!',
            'auth_files.upload_error_json': 'Only JSON files are allowed',
            'auth_files.upload_success': 'File uploaded successfully',
            'auth_files.download_success': 'File downloaded successfully',
            'auth_files.delete_success': 'File deleted successfully',
            'auth_files.delete_all_success': 'Successfully deleted',
            'auth_files.files_count': 'files',

            // Gemini Web Token
            'auth_login.gemini_web_title': 'Gemini Web Token',
            'auth_login.gemini_web_button': 'Save Gemini Web Token',
            'auth_login.gemini_web_hint': 'Obtain the Cookie value of the Gemini web version from the browser\'s developer tools, used for direct authentication to access Gemini.',
            'auth_login.secure_1psid_label': '__Secure-1PSID Cookie:',
            'auth_login.secure_1psid_placeholder': 'Enter __Secure-1PSID cookie value',
            'auth_login.secure_1psidts_label': '__Secure-1PSIDTS Cookie:',
            'auth_login.secure_1psidts_placeholder': 'Enter __Secure-1PSIDTS cookie value',
            'auth_login.gemini_web_label_label': 'Label (Optional):',
            'auth_login.gemini_web_label_placeholder': 'Enter label name (optional)',
            'auth_login.gemini_web_saved': 'Gemini Web Token saved successfully',

            // Codex OAuth
            'auth_login.codex_oauth_title': 'Codex OAuth',
            'auth_login.codex_oauth_button': 'Start Codex Login',
            'auth_login.codex_oauth_hint': 'Login to Codex service through OAuth flow, automatically obtain and save authentication files.',
            'auth_login.codex_oauth_url_label': 'Authorization URL:',
            'auth_login.codex_open_link': 'Open Link',
            'auth_login.codex_copy_link': 'Copy Link',
            'auth_login.codex_oauth_status_waiting': 'Waiting for authentication...',
            'auth_login.codex_oauth_status_success': 'Authentication successful!',
            'auth_login.codex_oauth_status_error': 'Authentication failed:',
            'auth_login.codex_oauth_start_error': 'Failed to start Codex OAuth:',
            'auth_login.codex_oauth_polling_error': 'Failed to check authentication status:',

            // Anthropic OAuth
            'auth_login.anthropic_oauth_title': 'Anthropic OAuth',
            'auth_login.anthropic_oauth_button': 'Start Anthropic Login',
            'auth_login.anthropic_oauth_hint': 'Login to Anthropic (Claude) service through OAuth flow, automatically obtain and save authentication files.',
            'auth_login.anthropic_oauth_url_label': 'Authorization URL:',
            'auth_login.anthropic_open_link': 'Open Link',
            'auth_login.anthropic_copy_link': 'Copy Link',
            'auth_login.anthropic_oauth_status_waiting': 'Waiting for authentication...',
            'auth_login.anthropic_oauth_status_success': 'Authentication successful!',
            'auth_login.anthropic_oauth_status_error': 'Authentication failed:',
            'auth_login.anthropic_oauth_start_error': 'Failed to start Anthropic OAuth:',
            'auth_login.anthropic_oauth_polling_error': 'Failed to check authentication status:',

            // Gemini CLI OAuth
            'auth_login.gemini_cli_oauth_title': 'Gemini CLI OAuth',
            'auth_login.gemini_cli_oauth_button': 'Start Gemini CLI Login',
            'auth_login.gemini_cli_oauth_hint': 'Login to Google Gemini CLI service through OAuth flow, automatically obtain and save authentication files.',
            'auth_login.gemini_cli_project_id_label': 'Google Cloud Project ID (Optional):',
            'auth_login.gemini_cli_project_id_placeholder': 'Enter Google Cloud Project ID (optional)',
            'auth_login.gemini_cli_project_id_hint': 'If a project ID is specified, authentication information for that project will be used.',
            'auth_login.gemini_cli_oauth_url_label': 'Authorization URL:',
            'auth_login.gemini_cli_open_link': 'Open Link',
            'auth_login.gemini_cli_copy_link': 'Copy Link',
            'auth_login.gemini_cli_oauth_status_waiting': 'Waiting for authentication...',
            'auth_login.gemini_cli_oauth_status_success': 'Authentication successful!',
            'auth_login.gemini_cli_oauth_status_error': 'Authentication failed:',
            'auth_login.gemini_cli_oauth_start_error': 'Failed to start Gemini CLI OAuth:',
            'auth_login.gemini_cli_oauth_polling_error': 'Failed to check authentication status:',

            // Qwen OAuth
            'auth_login.qwen_oauth_title': 'Qwen OAuth',
            'auth_login.qwen_oauth_button': 'Start Qwen Login',
            'auth_login.qwen_oauth_hint': 'Login to Qwen service through device authorization flow, automatically obtain and save authentication files.',
            'auth_login.qwen_oauth_url_label': 'Authorization URL:',
            'auth_login.qwen_open_link': 'Open Link',
            'auth_login.qwen_copy_link': 'Copy Link',
            'auth_login.qwen_oauth_status_waiting': 'Waiting for authentication...',
            'auth_login.qwen_oauth_status_success': 'Authentication successful!',
            'auth_login.qwen_oauth_status_error': 'Authentication failed:',
            'auth_login.qwen_oauth_start_error': 'Failed to start Qwen OAuth:',
            'auth_login.qwen_oauth_polling_error': 'Failed to check authentication status:',

            // iFlow OAuth
            'auth_login.iflow_oauth_title': 'iFlow OAuth',
            'auth_login.iflow_oauth_button': 'Start iFlow Login',
            'auth_login.iflow_oauth_hint': 'Login to iFlow service through OAuth flow, automatically obtain and save authentication files.',
            'auth_login.iflow_oauth_url_label': 'Authorization URL:',
            'auth_login.iflow_open_link': 'Open Link',
            'auth_login.iflow_copy_link': 'Copy Link',
            'auth_login.iflow_oauth_status_waiting': 'Waiting for authentication...',
            'auth_login.iflow_oauth_status_success': 'Authentication successful!',
            'auth_login.iflow_oauth_status_error': 'Authentication failed:',
            'auth_login.iflow_oauth_start_error': 'Failed to start iFlow OAuth:',
            'auth_login.iflow_oauth_polling_error': 'Failed to check authentication status:',

            // Usage Statistics
            'usage_stats.title': 'Usage Statistics',
            'usage_stats.total_requests': 'Total Requests',
            'usage_stats.success_requests': 'Success Requests',
            'usage_stats.failed_requests': 'Failed Requests',
            'usage_stats.total_tokens': 'Total Tokens',
            'usage_stats.requests_trend': 'Request Trends',
            'usage_stats.tokens_trend': 'Token Usage Trends',
            'usage_stats.api_details': 'API Details',
            'usage_stats.by_hour': 'By Hour',
            'usage_stats.by_day': 'By Day',
            'usage_stats.refresh': 'Refresh',
            'usage_stats.no_data': 'No Data Available',
            'usage_stats.loading_error': 'Loading Failed',
            'usage_stats.api_endpoint': 'API Endpoint',
            'usage_stats.requests_count': 'Request Count',
            'usage_stats.tokens_count': 'Token Count',
            'usage_stats.models': 'Model Statistics',
            'usage_stats.success_rate': 'Success Rate',

            // System info
            'system_info.title': 'System Information',
            'system_info.connection_status_title': 'Connection Status',
            'system_info.api_status_label': 'API Status:',
            'system_info.config_status_label': 'Config Status:',
            'system_info.last_update_label': 'Last Update:',
            'system_info.cache_data': 'Cache Data',
            'system_info.real_time_data': 'Real-time Data',
            'system_info.not_loaded': 'Not Loaded',
            'system_info.seconds_ago': 'seconds ago',

            // Notification messages
            'notification.debug_updated': 'Debug settings updated',
            'notification.proxy_updated': 'Proxy settings updated',
            'notification.proxy_cleared': 'Proxy settings cleared',
            'notification.retry_updated': 'Retry settings updated',
            'notification.quota_switch_project_updated': 'Project switch settings updated',
            'notification.quota_switch_preview_updated': 'Preview model switch settings updated',
            'notification.api_key_added': 'API key added successfully',
            'notification.api_key_updated': 'API key updated successfully',
            'notification.api_key_deleted': 'API key deleted successfully',
            'notification.gemini_key_added': 'Gemini key added successfully',
            'notification.gemini_key_updated': 'Gemini key updated successfully',
            'notification.gemini_key_deleted': 'Gemini key deleted successfully',
            'notification.codex_config_added': 'Codex configuration added successfully',
            'notification.codex_config_updated': 'Codex configuration updated successfully',
            'notification.codex_config_deleted': 'Codex configuration deleted successfully',
            'notification.claude_config_added': 'Claude configuration added successfully',
            'notification.claude_config_updated': 'Claude configuration updated successfully',
            'notification.claude_config_deleted': 'Claude configuration deleted successfully',
            'notification.field_required': 'Required fields cannot be empty',
            'notification.openai_provider_required': 'Please fill in provider name and Base URL',
            'notification.openai_provider_added': 'OpenAI provider added successfully',
            'notification.openai_provider_updated': 'OpenAI provider updated successfully',
            'notification.openai_provider_deleted': 'OpenAI provider deleted successfully',
            'notification.openai_model_name_required': 'Model name is required',
            'notification.data_refreshed': 'Data refreshed successfully',
            'notification.connection_required': 'Please establish connection first',
            'notification.refresh_failed': 'Refresh failed',
            'notification.update_failed': 'Update failed',
            'notification.add_failed': 'Add failed',
            'notification.delete_failed': 'Delete failed',
            'notification.upload_failed': 'Upload failed',
            'notification.download_failed': 'Download failed',
            'notification.login_failed': 'Login failed',
            'notification.please_enter': 'Please enter',
            'notification.please_fill': 'Please fill',
            'notification.provider_name_url': 'provider name and Base URL',
            'notification.api_key': 'API key',
            'notification.gemini_api_key': 'Gemini API key',
            'notification.codex_api_key': 'Codex API key',
            'notification.claude_api_key': 'Claude API key',

            // Language switch
            'language.switch': 'Language',
            'language.chinese': '中文',
            'language.english': 'English',

            // Theme switch
            'theme.switch': 'Theme',
            'theme.light': 'Light',
            'theme.dark': 'Dark',
            'theme.switch_to_light': 'Switch to light mode',
            'theme.switch_to_dark': 'Switch to dark mode',
            'theme.auto': 'Follow system',

            // Footer
            'footer.version': 'Version',
            'footer.author': 'Author'
        }
    },

    // 获取翻译文本
    t(key, params = {}) {
        const translation = this.translations[this.currentLanguage]?.[key] ||
            this.translations[this.fallbackLanguage]?.[key] ||
            key;

        // 简单的参数替换
        return translation.replace(/\{(\w+)\}/g, (match, param) => {
            return params[param] || match;
        });
    },

    // 设置语言
    setLanguage(lang) {
        if (this.translations[lang]) {
            this.currentLanguage = lang;
            localStorage.setItem('preferredLanguage', lang);
            this.updatePageLanguage();
            this.updateAllTexts();
        }
    },

    // 更新页面语言属性
    updatePageLanguage() {
        document.documentElement.lang = this.currentLanguage;
    },

    // 更新所有文本
    updateAllTexts() {
        // 更新所有带有 data-i18n 属性的元素
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const text = this.t(key);

            if (element.tagName === 'INPUT' && (element.type === 'text' || element.type === 'password')) {
                element.placeholder = text;
            } else if (element.tagName === 'TITLE') {
                element.textContent = text;
            } else {
                element.textContent = text;
            }
        });

        // 更新所有带有 data-i18n-html 属性的元素（支持HTML）
        document.querySelectorAll('[data-i18n-html]').forEach(element => {
            const key = element.getAttribute('data-i18n-html');
            const html = this.t(key);
            element.innerHTML = html;
        });
    },

    // 初始化
    init() {
        // 从本地存储获取用户偏好语言
        const savedLanguage = localStorage.getItem('preferredLanguage');
        if (savedLanguage && this.translations[savedLanguage]) {
            this.currentLanguage = savedLanguage;
        } else {
            // 根据浏览器语言自动选择
            const browserLang = navigator.language || navigator.userLanguage;
            if (browserLang.startsWith('zh')) {
                this.currentLanguage = 'zh-CN';
            } else {
                this.currentLanguage = 'en-US';
            }
        }

        this.updatePageLanguage();
        this.updateAllTexts();
    }
};

// 全局函数，供HTML调用
window.t = (key, params) => i18n.t(key, params);
window.setLanguage = (lang) => i18n.setLanguage(lang);
