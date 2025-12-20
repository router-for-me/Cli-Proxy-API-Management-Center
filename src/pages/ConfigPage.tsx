import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { keymap } from '@codemirror/view';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconChevronDown, IconChevronUp, IconRefreshCw, IconSave, IconSearch } from '@/components/ui/icons';
import { useNotificationStore, useAuthStore, useThemeStore, useConfigStore } from '@/stores';
import { configFileApi } from '@/services/api/configFile';
import { configApi } from '@/services/api';
import type { Config } from '@/types';

type PendingKey =
  | 'debug'
  | 'proxy'
  | 'retry'
  | 'switchProject'
  | 'switchPreview'
  | 'usage'
  | 'requestLog'
  | 'loggingToFile'
  | 'wsAuth';

export function ConfigPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const theme = useThemeStore((state) => state.theme);
  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);

  // Settings state
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [proxyValue, setProxyValue] = useState('');
  const [retryValue, setRetryValue] = useState(0);
  const [pending, setPending] = useState<Record<PendingKey, boolean>>({} as Record<PendingKey, boolean>);

  // Config editor state
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [lastSearchedQuery, setLastSearchedQuery] = useState('');
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const floatingControlsRef = useRef<HTMLDivElement>(null);
  const editorWrapperRef = useRef<HTMLDivElement>(null);

  const disableControls = connectionStatus !== 'connected';

  // Settings functions
  const setPendingFlag = (key: PendingKey, value: boolean) => {
    setPending((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSetting = async (
    section: PendingKey,
    rawKey: 'debug' | 'usage-statistics-enabled' | 'request-log' | 'logging-to-file' | 'ws-auth',
    value: boolean,
    updater: (val: boolean) => Promise<any>,
    successMessage: string
  ) => {
    const previous = (() => {
      switch (rawKey) {
        case 'debug': return config?.debug ?? false;
        case 'usage-statistics-enabled': return config?.usageStatisticsEnabled ?? false;
        case 'request-log': return config?.requestLog ?? false;
        case 'logging-to-file': return config?.loggingToFile ?? false;
        case 'ws-auth': return config?.wsAuth ?? false;
        default: return false;
      }
    })();
    setPendingFlag(section, true);
    updateConfigValue(rawKey, value);
    try {
      await updater(value);
      clearCache(rawKey);
      showNotification(successMessage, 'success');
    } catch (err: any) {
      updateConfigValue(rawKey, previous);
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag(section, false);
    }
  };

  const handleProxyUpdate = async () => {
    const previous = config?.proxyUrl ?? '';
    setPendingFlag('proxy', true);
    updateConfigValue('proxy-url', proxyValue);
    try {
      await configApi.updateProxyUrl(proxyValue.trim());
      clearCache('proxy-url');
      showNotification(t('notification.proxy_updated'), 'success');
    } catch (err: any) {
      setProxyValue(previous);
      updateConfigValue('proxy-url', previous);
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag('proxy', false);
    }
  };

  const handleProxyClear = async () => {
    const previous = config?.proxyUrl ?? '';
    setPendingFlag('proxy', true);
    updateConfigValue('proxy-url', '');
    try {
      await configApi.clearProxyUrl();
      clearCache('proxy-url');
      setProxyValue('');
      showNotification(t('notification.proxy_cleared'), 'success');
    } catch (err: any) {
      setProxyValue(previous);
      updateConfigValue('proxy-url', previous);
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag('proxy', false);
    }
  };

  const handleRetryUpdate = async () => {
    const previous = config?.requestRetry ?? 0;
    const parsed = Number(retryValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      showNotification(t('login.error_invalid'), 'error');
      setRetryValue(previous);
      return;
    }
    setPendingFlag('retry', true);
    updateConfigValue('request-retry', parsed);
    try {
      await configApi.updateRequestRetry(parsed);
      clearCache('request-retry');
      showNotification(t('notification.retry_updated'), 'success');
    } catch (err: any) {
      setRetryValue(previous);
      updateConfigValue('request-retry', previous);
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setPendingFlag('retry', false);
    }
  };

  const quotaSwitchProject = config?.quotaExceeded?.switchProject ?? false;
  const quotaSwitchPreview = config?.quotaExceeded?.switchPreviewModel ?? false;

  // Load settings
  useEffect(() => {
    const loadSettings = async () => {
      setSettingsLoading(true);
      try {
        const data = (await fetchConfig()) as Config;
        setProxyValue(data?.proxyUrl ?? '');
        setRetryValue(typeof data?.requestRetry === 'number' ? data.requestRetry : 0);
      } catch {
        // ignore
      } finally {
        setSettingsLoading(false);
      }
    };
    loadSettings();
  }, [fetchConfig]);

  useEffect(() => {
    if (config) {
      setProxyValue(config.proxyUrl ?? '');
      if (typeof config.requestRetry === 'number') {
        setRetryValue(config.requestRetry);
      }
    }
  }, [config?.proxyUrl, config?.requestRetry]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await configFileApi.fetchConfigYaml();
      setContent(data);
      setDirty(false);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await configFileApi.saveConfigYaml(content);
      setDirty(false);
      showNotification(t('config_management.save_success'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.save_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = useCallback((value: string) => {
    setContent(value);
    setDirty(true);
  }, []);

  // Search functionality
  const performSearch = useCallback((query: string, direction: 'next' | 'prev' = 'next') => {
    if (!query || !editorRef.current?.view) return;

    const view = editorRef.current.view;
    const doc = view.state.doc.toString();
    const matches: number[] = [];
    const lowerQuery = query.toLowerCase();
    const lowerDoc = doc.toLowerCase();

    let pos = 0;
    while (pos < lowerDoc.length) {
      const index = lowerDoc.indexOf(lowerQuery, pos);
      if (index === -1) break;
      matches.push(index);
      pos = index + 1;
    }

    if (matches.length === 0) {
      setSearchResults({ current: 0, total: 0 });
      return;
    }

    // Find current match based on cursor position
    const selection = view.state.selection.main;
    const cursorPos = direction === 'prev' ? selection.from : selection.to;
    let currentIndex = 0;

    if (direction === 'next') {
      // Find next match after cursor
      for (let i = 0; i < matches.length; i++) {
        if (matches[i] > cursorPos) {
          currentIndex = i;
          break;
        }
        // If no match after cursor, wrap to first
        if (i === matches.length - 1) {
          currentIndex = 0;
        }
      }
    } else {
      // Find previous match before cursor
      for (let i = matches.length - 1; i >= 0; i--) {
        if (matches[i] < cursorPos) {
          currentIndex = i;
          break;
        }
        // If no match before cursor, wrap to last
        if (i === 0) {
          currentIndex = matches.length - 1;
        }
      }
    }

    const matchPos = matches[currentIndex];
    setSearchResults({ current: currentIndex + 1, total: matches.length });

    // Scroll to and select the match
    view.dispatch({
      selection: { anchor: matchPos, head: matchPos + query.length },
      scrollIntoView: true
    });
    view.focus();
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    // Do not auto-search on each keystroke. Clear previous results when query changes.
    if (!value) {
      setSearchResults({ current: 0, total: 0 });
      setLastSearchedQuery('');
    } else {
      setSearchResults({ current: 0, total: 0 });
    }
  }, []);

  const executeSearch = useCallback((direction: 'next' | 'prev' = 'next') => {
    if (!searchQuery) return;
    setLastSearchedQuery(searchQuery);
    performSearch(searchQuery, direction);
  }, [searchQuery, performSearch]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeSearch(e.shiftKey ? 'prev' : 'next');
    }
  }, [executeSearch]);

  const handlePrevMatch = useCallback(() => {
    if (!lastSearchedQuery) return;
    performSearch(lastSearchedQuery, 'prev');
  }, [lastSearchedQuery, performSearch]);

  const handleNextMatch = useCallback(() => {
    if (!lastSearchedQuery) return;
    performSearch(lastSearchedQuery, 'next');
  }, [lastSearchedQuery, performSearch]);

  // Keep floating controls from covering editor content by syncing its height to a CSS variable.
  useLayoutEffect(() => {
    const controlsEl = floatingControlsRef.current;
    const wrapperEl = editorWrapperRef.current;
    if (!controlsEl || !wrapperEl) return;

    const updatePadding = () => {
      const height = controlsEl.getBoundingClientRect().height;
      wrapperEl.style.setProperty('--floating-controls-height', `${height}px`);
    };

    updatePadding();
    window.addEventListener('resize', updatePadding);

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePadding);
    ro?.observe(controlsEl);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updatePadding);
    };
  }, []);

  // CodeMirror extensions
  const extensions = useMemo(() => [
    yaml(),
    search(),
    highlightSelectionMatches(),
    keymap.of(searchKeymap)
  ], []);



  return (
    <div className="space-y-4">

      {/* Settings Section */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t('basic_settings.title')}>
          <div className="space-y-3">
            <ToggleSwitch
              label={t('basic_settings.debug_enable')}
              checked={config?.debug ?? false}
              disabled={disableControls || pending.debug || settingsLoading}
              onChange={(value) => toggleSetting('debug', 'debug', value, configApi.updateDebug, t('notification.debug_updated'))}
            />
            <ToggleSwitch
              label={t('basic_settings.usage_statistics_enable')}
              checked={config?.usageStatisticsEnabled ?? false}
              disabled={disableControls || pending.usage || settingsLoading}
              onChange={(value) => toggleSetting('usage', 'usage-statistics-enabled', value, configApi.updateUsageStatistics, t('notification.usage_statistics_updated'))}
            />
            <ToggleSwitch
              label={t('basic_settings.request_log_enable')}
              checked={config?.requestLog ?? false}
              disabled={disableControls || pending.requestLog || settingsLoading}
              onChange={(value) => toggleSetting('requestLog', 'request-log', value, configApi.updateRequestLog, t('notification.request_log_updated'))}
            />
            <ToggleSwitch
              label={t('basic_settings.logging_to_file_enable')}
              checked={config?.loggingToFile ?? false}
              disabled={disableControls || pending.loggingToFile || settingsLoading}
              onChange={(value) => toggleSetting('loggingToFile', 'logging-to-file', value, configApi.updateLoggingToFile, t('notification.logging_to_file_updated'))}
            />
            <ToggleSwitch
              label={t('basic_settings.ws_auth_enable')}
              checked={config?.wsAuth ?? false}
              disabled={disableControls || pending.wsAuth || settingsLoading}
              onChange={(value) => toggleSetting('wsAuth', 'ws-auth', value, configApi.updateWsAuth, t('notification.ws_auth_updated'))}
            />
          </div>
        </Card>

        <Card title={t('basic_settings.quota_title')}>
          <div className="space-y-3">
            <ToggleSwitch
              label={t('basic_settings.quota_switch_project')}
              checked={quotaSwitchProject}
              disabled={disableControls || pending.switchProject || settingsLoading}
              onChange={(value) => (async () => {
                const previous = config?.quotaExceeded?.switchProject ?? false;
                const nextQuota = { ...(config?.quotaExceeded || {}), switchProject: value };
                setPendingFlag('switchProject', true);
                updateConfigValue('quota-exceeded', nextQuota);
                try {
                  await configApi.updateSwitchProject(value);
                  clearCache('quota-exceeded');
                  showNotification(t('notification.quota_switch_project_updated'), 'success');
                } catch (err: any) {
                  updateConfigValue('quota-exceeded', { ...(config?.quotaExceeded || {}), switchProject: previous });
                  showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
                } finally {
                  setPendingFlag('switchProject', false);
                }
              })()}
            />
            <ToggleSwitch
              label={t('basic_settings.quota_switch_preview')}
              checked={quotaSwitchPreview}
              disabled={disableControls || pending.switchPreview || settingsLoading}
              onChange={(value) => (async () => {
                const previous = config?.quotaExceeded?.switchPreviewModel ?? false;
                const nextQuota = { ...(config?.quotaExceeded || {}), switchPreviewModel: value };
                setPendingFlag('switchPreview', true);
                updateConfigValue('quota-exceeded', nextQuota);
                try {
                  await configApi.updateSwitchPreviewModel(value);
                  clearCache('quota-exceeded');
                  showNotification(t('notification.quota_switch_preview_updated'), 'success');
                } catch (err: any) {
                  updateConfigValue('quota-exceeded', { ...(config?.quotaExceeded || {}), switchPreviewModel: previous });
                  showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
                } finally {
                  setPendingFlag('switchPreview', false);
                }
              })()}
            />
          </div>
        </Card>

        <Card title={t('basic_settings.proxy_title')}>
          <div className="space-y-3">
            <Input
              label={t('basic_settings.proxy_url_label')}
              placeholder={t('basic_settings.proxy_url_placeholder')}
              value={proxyValue}
              onChange={(e) => setProxyValue(e.target.value)}
              disabled={disableControls || settingsLoading}
            />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleProxyClear} disabled={disableControls || pending.proxy || settingsLoading}>
                {t('basic_settings.proxy_clear')}
              </Button>
              <Button onClick={handleProxyUpdate} loading={pending.proxy} disabled={disableControls || settingsLoading}>
                {t('basic_settings.proxy_update')}
              </Button>
            </div>
          </div>
        </Card>

        <Card title={t('basic_settings.retry_title')}>
          <div className="flex items-end gap-3">
            <Input
              label={t('basic_settings.retry_count_label')}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={retryValue}
              onChange={(e) => setRetryValue(Number(e.target.value))}
              disabled={disableControls || settingsLoading}
              className="flex-1"
            />
            <Button onClick={handleRetryUpdate} loading={pending.retry} disabled={disableControls || settingsLoading}>
              {t('basic_settings.retry_update')}
            </Button>
          </div>
        </Card>
      </div>

      {/* Config Editor Section */}
      <Card title={t('config_management.editor_title')} className="flex flex-col h-[500px]">
        <div className="flex-1 flex flex-col min-h-0">
          {/* Editor */}
          {error && <div className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded mb-3">{error}</div>}
          
          {/* Search controls + Status + Actions */}
          <div className="flex items-center gap-2 mb-3" ref={floatingControlsRef}>
            <div className="w-48">
              <Input
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t('config_management.search_placeholder', {
                  defaultValue: '搜索...'
                })}
                disabled={disableControls || loading}
                rightElement={
                  <div className="flex items-center gap-1">
                    {searchQuery && lastSearchedQuery === searchQuery && (
                      <span className="text-xs text-muted-foreground">
                        {searchResults.total > 0
                          ? `${searchResults.current}/${searchResults.total}`
                          : '0'}
                      </span>
                    )}
                    <button
                      type="button"
                      className="p-0.5 hover:bg-muted rounded transition-colors disabled:opacity-50"
                      onClick={() => executeSearch('next')}
                      disabled={!searchQuery || disableControls || loading}
                      title={t('config_management.search_button', { defaultValue: '搜索' })}
                    >
                      <IconSearch size={14} />
                    </button>
                  </div>
                }
              />
            </div>
            <div className="flex">
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePrevMatch}
                disabled={!searchQuery || lastSearchedQuery !== searchQuery || searchResults.total === 0}
                title={t('config_management.search_prev', { defaultValue: '上一个' })}
              >
                <IconChevronUp size={16} />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleNextMatch}
                disabled={!searchQuery || lastSearchedQuery !== searchQuery || searchResults.total === 0}
                title={t('config_management.search_next', { defaultValue: '下一个' })}
              >
                <IconChevronDown size={16} />
              </Button>
            </div>
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={loadConfig} disabled={loading} title={t('config_management.reload')}>
                <IconRefreshCw size={16} />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleSave} loading={saving} disabled={disableControls || loading || !dirty} title={t('config_management.save')}>
                <IconSave size={16} />
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${error ? 'bg-destructive' : dirty ? 'bg-amber-500' : loading ? 'bg-blue-500 animate-pulse' : 'bg-emerald-500'}`} />
              <span className="text-xs text-muted-foreground">
                {error ? 'Error' : dirty ? 'Modified' : loading ? 'Loading' : saving ? 'Saving' : 'Ready'}
              </span>
            </div>
          </div>
          
          {/* Editor container with fixed height */}
          <div className="flex-1 min-h-0 border border-border rounded overflow-hidden" ref={editorWrapperRef}>
            <CodeMirror
              ref={editorRef}
              value={content}
              onChange={handleChange}
              extensions={extensions}
              theme={theme === 'dark' ? 'dark' : 'light'}
              editable={!disableControls && !loading}
              placeholder={t('config_management.editor_placeholder')}
              height="100%"
              style={{ height: '100%', overflow: 'auto' }}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLineGutter: true,
                highlightActiveLine: true,
                foldGutter: true,
                dropCursor: true,
                allowMultipleSelections: true,
                indentOnInput: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: false,
                rectangularSelection: true,
                crosshairCursor: false,
                highlightSelectionMatches: true,
                closeBracketsKeymap: true,
                searchKeymap: true,
                foldKeymap: true,
                completionKeymap: false,
                lintKeymap: true
              }}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}
