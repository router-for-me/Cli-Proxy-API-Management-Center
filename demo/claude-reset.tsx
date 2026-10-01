// Install the transport before importing any application module (including apiClient).
import axios from 'axios';
import { installDemoTransport, demoFiles } from './claude-reset-mocks';

axios.defaults.adapter = installDemoTransport();

async function start() {
  const [
    { useAuthStore },
    { useThemeStore },
    { useLanguageStore },
    { useQuotaStore },
    { CLAUDE_CONFIG },
    { default: i18n },
  ] = await Promise.all([
    import('@/stores/useAuthStore'),
    import('@/stores/useThemeStore'),
    import('@/stores/useLanguageStore'),
    import('@/stores/useQuotaStore'),
    import('@/features/quota/providers/claude/data'),
    import('@/i18n'),
  ]);
  useAuthStore.setState({
    isAuthenticated: true,
    connectionStatus: 'connected',
    apiBase: 'http://demo.invalid',
    managementKey: '',
    rememberPassword: false,
    serverVersion: 'v8.0.0-demo',
    supportsPlugin: false,
  });
  useLanguageStore.getState().setLanguage('zh-CN');
  useThemeStore.getState().setTheme('light');
  // Populate the original quota cache through the same parser and mock transport
  // used by the page's refresh actions, rather than replacing any UI component.
  for (const file of demoFiles) {
    const data = await CLAUDE_CONFIG.fetchQuota(file, i18n.t);
    useQuotaStore.getState().setClaudeQuota((previous) => ({
      ...previous,
      [file.name]: CLAUDE_CONFIG.buildSuccessState(data),
    }));
  }
  if (!location.hash) location.hash = '/quota';
  await import('@/main');
}

void start();
