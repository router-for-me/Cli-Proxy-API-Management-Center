import { useEffect, useState } from 'react';
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

export function LogsPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [logs, setLogs] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [intervalId, setIntervalId] = useState<number | null>(null);
  const [errorLogs, setErrorLogs] = useState<ErrorLogItem[]>([]);
  const [loadingErrors, setLoadingErrors] = useState(false);

  const disableControls = connectionStatus !== 'connected';

  const loadLogs = async () => {
    if (connectionStatus !== 'connected') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await logsApi.fetchLogs({ limit: 500 });
      const text = Array.isArray(data) ? data.join('\n') : data?.logs || data || '';
      setLogs(text);
    } catch (err: any) {
      console.error('Failed to load logs:', err);
      setError(err?.message || t('logs.load_error'));
    } finally {
      setLoading(false);
    }
  };

  const clearLogs = async () => {
    if (!window.confirm(t('logs.clear_confirm'))) return;
    try {
      await logsApi.clearLogs();
      setLogs('');
      showNotification(t('logs.clear_success'), 'success');
    } catch (err: any) {
      showNotification(`${t('notification.delete_failed')}: ${err?.message || ''}`, 'error');
    }
  };

  const downloadLogs = () => {
    const blob = new Blob([logs], { type: 'text/plain' });
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
      const list: ErrorLogItem[] = Array.isArray(res)
        ? res
        : Object.entries(res || {}).map(([name, meta]) => ({
            name,
            size: (meta as any)?.size,
            modified: (meta as any)?.modified
          }));
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
      loadLogs();
      loadErrorLogs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionStatus]);

  useEffect(() => {
    if (autoRefresh) {
      const id = window.setInterval(loadLogs, 8000);
      setIntervalId(id);
      return () => window.clearInterval(id);
    }
    if (intervalId) {
      window.clearInterval(intervalId);
      setIntervalId(null);
    }
  }, [autoRefresh]);

  return (
    <div className="stack">
      <Card
        title={t('logs.title')}
        extra={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" size="sm" onClick={loadLogs} disabled={loading}>
              {t('logs.refresh_button')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAutoRefresh((v) => !v)}>
              {t('logs.auto_refresh')}: {autoRefresh ? t('common.yes') : t('common.no')}
            </Button>
            <Button variant="secondary" size="sm" onClick={downloadLogs} disabled={!logs}>
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
        ) : logs ? (
          <pre className="log-viewer">{logs}</pre>
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
