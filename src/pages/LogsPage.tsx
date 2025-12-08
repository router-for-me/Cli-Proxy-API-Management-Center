import { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useNotificationStore, useAuthStore } from '@/stores';
import { logsApi } from '@/services/api/logs';

interface ErrorLogItem {
  name: string;
  size?: number;
  modified?: number;
}

// 限制显示的最大日志行数，防止渲染过多导致卡死
const MAX_DISPLAY_LINES = 500;

export function LogsPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [logLines, setLogLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [errorLogs, setErrorLogs] = useState<ErrorLogItem[]>([]);
  const [loadingErrors, setLoadingErrors] = useState(false);

  // 保存最新时间戳用于增量获取
  const latestTimestampRef = useRef<number>(0);

  const disableControls = connectionStatus !== 'connected';

  const loadLogs = async (incremental = false) => {
    if (connectionStatus !== 'connected') {
      setLoading(false);
      return;
    }

    if (!incremental) {
      setLoading(true);
    }
    setError('');

    try {
      const params = incremental && latestTimestampRef.current > 0
        ? { after: latestTimestampRef.current }
        : {};
      const data = await logsApi.fetchLogs(params);

      // 更新时间戳
      if (data['latest-timestamp']) {
        latestTimestampRef.current = data['latest-timestamp'];
      }

      const newLines = Array.isArray(data.lines) ? data.lines : [];

      if (incremental && newLines.length > 0) {
        // 增量更新：追加新日志并限制总行数
        setLogLines(prev => {
          const combined = [...prev, ...newLines];
          return combined.slice(-MAX_DISPLAY_LINES);
        });
      } else if (!incremental) {
        // 全量加载：只取最后 MAX_DISPLAY_LINES 行
        setLogLines(newLines.slice(-MAX_DISPLAY_LINES));
      }
    } catch (err: any) {
      console.error('Failed to load logs:', err);
      if (!incremental) {
        setError(err?.message || t('logs.load_error'));
      }
    } finally {
      if (!incremental) {
        setLoading(false);
      }
    }
  };

  const clearLogs = async () => {
    if (!window.confirm(t('logs.clear_confirm'))) return;
    try {
      await logsApi.clearLogs();
      setLogLines([]);
      latestTimestampRef.current = 0;
      showNotification(t('logs.clear_success'), 'success');
    } catch (err: any) {
      showNotification(`${t('notification.delete_failed')}: ${err?.message || ''}`, 'error');
    }
  };

  const downloadLogs = () => {
    const text = logLines.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'logs.txt';
    a.click();
    window.URL.revokeObjectURL(url);
    showNotification(t('logs.download_success'), 'success');
  };

  const loadErrorLogs = async () => {
    if (connectionStatus !== 'connected') {
      setLoadingErrors(false);
      return;
    }

    setLoadingErrors(true);
    try {
      const res = await logsApi.fetchErrorLogs();
      // API 返回 { files: [...] }
      const files = (res as any)?.files;
      const list: ErrorLogItem[] = Array.isArray(files)
        ? files.map((f: any) => ({
            name: f.name,
            size: f.size,
            modified: f.modified
          }))
        : [];
      setErrorLogs(list);
    } catch (err: any) {
      console.error('Failed to load error logs:', err);
      // 静默失败,不影响主日志显示
      setErrorLogs([]);
    } finally {
      setLoadingErrors(false);
    }
  };

  const downloadErrorLog = async (name: string) => {
    try {
      const response = await logsApi.downloadErrorLog(name);
      const blob = new Blob([response.data], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      window.URL.revokeObjectURL(url);
      showNotification(t('logs.error_log_download_success'), 'success');
    } catch (err: any) {
      showNotification(`${t('notification.download_failed')}: ${err?.message || ''}`, 'error');
    }
  };

  useEffect(() => {
    if (connectionStatus === 'connected') {
      latestTimestampRef.current = 0;
      loadLogs(false);
      loadErrorLogs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionStatus]);

  useEffect(() => {
    if (!autoRefresh || connectionStatus !== 'connected') {
      return;
    }
    const id = window.setInterval(() => {
      loadLogs(true);
    }, 8000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, connectionStatus]);

  const logsText = logLines.join('\n');

  return (
    <div className="stack">
      <Card
        title={t('logs.title')}
        extra={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" size="sm" onClick={() => loadLogs(false)} disabled={loading}>
              {t('logs.refresh_button')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAutoRefresh((v) => !v)}>
              {t('logs.auto_refresh')}: {autoRefresh ? t('common.yes') : t('common.no')}
            </Button>
            <Button variant="secondary" size="sm" onClick={downloadLogs} disabled={logLines.length === 0}>
              {t('logs.download_button')}
            </Button>
            <Button variant="danger" size="sm" onClick={clearLogs} disabled={disableControls}>
              {t('logs.clear_button')}
            </Button>
          </div>
        }
      >
        {error && <div className="error-box">{error}</div>}
        {loading ? (
          <div className="hint">{t('logs.loading')}</div>
        ) : logsText ? (
          <pre className="log-viewer">{logsText}</pre>
        ) : (
          <EmptyState title={t('logs.empty_title')} description={t('logs.empty_desc')} />
        )}
      </Card>

      <Card
        title={t('logs.error_logs_modal_title')}
        extra={
          <Button variant="secondary" size="sm" onClick={loadErrorLogs} loading={loadingErrors}>
            {t('common.refresh')}
          </Button>
        }
      >
        {errorLogs.length === 0 ? (
          <div className="hint">{t('logs.error_logs_empty')}</div>
        ) : (
          <div className="item-list">
            {errorLogs.map((item) => (
              <div key={item.name} className="item-row">
                <div className="item-meta">
                  <div className="item-title">{item.name}</div>
                  <div className="item-subtitle">
                    {item.size ? `${(item.size / 1024).toFixed(1)} KB` : ''}{' '}
                    {item.modified ? new Date(item.modified).toLocaleString() : ''}
                  </div>
                </div>
                <div className="item-actions">
                  <Button variant="secondary" size="sm" onClick={() => downloadErrorLog(item.name)}>
                    {t('logs.error_logs_download')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
