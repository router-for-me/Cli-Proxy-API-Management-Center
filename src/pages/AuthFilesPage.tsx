import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuthStore, useNotificationStore } from '@/stores';
import { authFilesApi } from '@/services/api';
import { apiClient } from '@/services/api/client';
import type { AuthFileItem } from '@/types';
import { formatFileSize } from '@/utils/format';

interface ExcludedFormState {
  provider: string;
  modelsText: string;
}

export function AuthFilesPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [excluded, setExcluded] = useState<Record<string, string[]>>({});
  const [excludedModalOpen, setExcludedModalOpen] = useState(false);
  const [excludedForm, setExcludedForm] = useState<ExcludedFormState>({ provider: '', modelsText: '' });
  const [savingExcluded, setSavingExcluded] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const disableControls = connectionStatus !== 'connected';

  const formatModified = (item: AuthFileItem): string => {
    const raw = (item as any).modtime ?? item.modified;
    if (!raw) return t('auth_files.file_modified');
    const asNumber = Number(raw);
    const date =
      Number.isFinite(asNumber) && !Number.isNaN(asNumber)
        ? new Date(asNumber < 1e12 ? asNumber * 1000 : asNumber)
        : new Date(String(raw));
    return Number.isNaN(date.getTime()) ? t('auth_files.file_modified') : date.toLocaleString();
  };

  const loadFiles = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: any) {
      setError(err?.message || t('notification.refresh_failed'));
    } finally {
      setLoading(false);
    }
  };

  const loadExcluded = async () => {
    try {
      const res = await authFilesApi.getOauthExcludedModels();
      setExcluded(res || {});
    } catch (err) {
      // ignore silently
    }
  };

  useEffect(() => {
    loadFiles();
    loadExcluded();
  }, []);

  const filtered = useMemo(() => {
    return files.filter((item) => {
      const matchType = filter === 'all' || item.type === filter;
      const term = search.trim().toLowerCase();
      const matchSearch =
        !term ||
        item.name.toLowerCase().includes(term) ||
        (item.type || '').toString().toLowerCase().includes(term) ||
        (item.provider || '').toString().toLowerCase().includes(term);
      return matchType && matchSearch;
    });
  }, [files, filter, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  const totalSize = useMemo(() => files.reduce((sum, item) => sum + (item.size || 0), 0), [files]);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await authFilesApi.upload(file);
      showNotification(t('auth_files.upload_success'), 'success');
      await loadFiles();
    } catch (err: any) {
      showNotification(`${t('notification.upload_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm(t('auth_files.delete_confirm'))) return;
    setDeleting(name);
    try {
      await authFilesApi.deleteFile(name);
      showNotification(t('auth_files.delete_success'), 'success');
      setFiles((prev) => prev.filter((item) => item.name !== name));
    } catch (err: any) {
      showNotification(`${t('notification.delete_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setDeleting(null);
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm(t('auth_files.delete_all_confirm'))) return;
    try {
      await authFilesApi.deleteAll();
      showNotification(t('auth_files.delete_all_success'), 'success');
      setFiles([]);
    } catch (err: any) {
      showNotification(`${t('notification.delete_failed')}: ${err?.message || ''}`, 'error');
    }
  };

  const handleDownload = async (name: string) => {
    try {
      const response = await apiClient.getRaw(`/auth-files/download?name=${encodeURIComponent(name)}`, {
        responseType: 'blob'
      });
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      window.URL.revokeObjectURL(url);
      showNotification(t('auth_files.download_success'), 'success');
    } catch (err: any) {
      showNotification(`${t('notification.download_failed')}: ${err?.message || ''}`, 'error');
    }
  };

  const openExcludedModal = (provider?: string) => {
    const models = provider ? excluded[provider] : [];
    setExcludedForm({
      provider: provider || '',
      modelsText: Array.isArray(models) ? models.join('\n') : ''
    });
    setExcludedModalOpen(true);
  };

  const saveExcludedModels = async () => {
    const provider = excludedForm.provider.trim();
    if (!provider) {
      showNotification(t('oauth_excluded.provider_required'), 'error');
      return;
    }
    const models = excludedForm.modelsText
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    setSavingExcluded(true);
    try {
      if (models.length) {
        await authFilesApi.saveOauthExcludedModels(provider, models);
      } else {
        await authFilesApi.deleteOauthExcludedEntry(provider);
      }
      await loadExcluded();
      showNotification(t('oauth_excluded.save_success'), 'success');
      setExcludedModalOpen(false);
    } catch (err: any) {
      showNotification(`${t('oauth_excluded.save_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setSavingExcluded(false);
    }
  };

  const deleteExcluded = async (provider: string) => {
    if (!window.confirm(t('oauth_excluded.delete_confirm', { provider }))) return;
    try {
      await authFilesApi.deleteOauthExcludedEntry(provider);
      await loadExcluded();
      showNotification(t('oauth_excluded.delete_success'), 'success');
    } catch (err: any) {
      showNotification(`${t('oauth_excluded.delete_failed')}: ${err?.message || ''}`, 'error');
    }
  };

  const typeOptions: { value: string; label: string }[] = [
    { value: 'all', label: t('auth_files.filter_all') },
    { value: 'qwen', label: t('auth_files.filter_qwen') },
    { value: 'gemini', label: t('auth_files.filter_gemini') },
    { value: 'gemini-cli', label: t('auth_files.filter_gemini-cli') },
    { value: 'aistudio', label: t('auth_files.filter_aistudio') },
    { value: 'claude', label: t('auth_files.filter_claude') },
    { value: 'codex', label: t('auth_files.filter_codex') },
    { value: 'antigravity', label: t('auth_files.filter_antigravity') },
    { value: 'iflow', label: t('auth_files.filter_iflow') },
    { value: 'vertex', label: t('auth_files.filter_vertex') },
    { value: 'empty', label: t('auth_files.filter_empty') },
    { value: 'unknown', label: t('auth_files.filter_unknown') }
  ];

  return (
    <div className="stack">
      <Card
        title={t('auth_files.title')}
        extra={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" size="sm" onClick={loadFiles} disabled={loading}>
              {t('common.refresh')}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleDeleteAll} disabled={disableControls || loading}>
              {t('auth_files.delete_all_button')}
            </Button>
            <Button size="sm" onClick={handleUploadClick} disabled={disableControls || uploading}>
              {t('auth_files.upload_button')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
        }
      >
        {error && <div className="error-box">{error}</div>}

        <div className="filters">
          <div className="filter-item">
            <label>{t('auth_files.search_label')}</label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('auth_files.search_placeholder')}
            />
          </div>
          <div className="filter-item">
            <label>{t('auth_files.page_size_label')}</label>
            <input
              className="input"
              type="number"
              min={1}
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value) || 10)}
            />
          </div>
          <div className="filter-item">
            <label>{t('common.info')}</label>
            <div className="pill">
              {files.length} {t('auth_files.files_count')} · {formatFileSize(totalSize)}
            </div>
          </div>
          <div className="filter-item">
            <label>{t('auth_files.filter_all')}</label>
            <select className="input" value={filter} onChange={(e) => setFilter(e.target.value)}>
              {typeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="hint">{t('common.loading')}</div>
        ) : pageItems.length === 0 ? (
          <EmptyState title={t('auth_files.search_empty_title')} description={t('auth_files.search_empty_desc')} />
        ) : (
          <div className="table">
            <div className="table-header">
              <div>{t('auth_files.title_section')}</div>
              <div>{t('auth_files.file_size')}</div>
              <div>{t('auth_files.file_modified')}</div>
              <div>Actions</div>
            </div>
            {pageItems.map((item) => (
              <div key={item.name} className="table-row">
                <div className="cell">
                  <div className="item-title">{item.name}</div>
                  <div className="item-subtitle">
                    {item.type || t('auth_files.type_unknown')} {item.provider ? `· ${item.provider}` : ''}
                  </div>
                </div>
                <div className="cell">{item.size ? formatFileSize(item.size) : '-'}</div>
                <div className="cell">
                  {formatModified(item)}
                </div>
                <div className="cell">
                  <div className="item-actions">
                    <Button variant="secondary" size="sm" onClick={() => handleDownload(item.name)} disabled={disableControls}>
                      {t('auth_files.download_button')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(item.name)}
                      loading={deleting === item.name}
                      disabled={disableControls}
                    >
                      {t('auth_files.delete_button')}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pagination">
          <Button variant="secondary" size="sm" onClick={() => setPage(Math.max(1, currentPage - 1))}>
            {t('auth_files.pagination_prev')}
          </Button>
          <div className="pill">
            {t('auth_files.pagination_info', {
              current: currentPage,
              total: totalPages,
              count: filtered.length
            })}
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
          >
            {t('auth_files.pagination_next')}
          </Button>
        </div>
      </Card>

      <Card
        title={t('oauth_excluded.title')}
        extra={
          <Button size="sm" onClick={() => openExcludedModal()} disabled={disableControls}>
            {t('oauth_excluded.add')}
          </Button>
        }
      >
        {Object.keys(excluded).length === 0 ? (
          <EmptyState title={t('oauth_excluded.list_empty_all')} />
        ) : (
          <div className="item-list">
            {Object.entries(excluded).map(([provider, models]) => (
              <div key={provider} className="item-row">
                <div className="item-meta">
                  <div className="item-title">{provider}</div>
                  <div className="item-subtitle">
                    {models?.length
                      ? t('oauth_excluded.model_count', { count: models.length })
                      : t('oauth_excluded.no_models')}
                  </div>
                </div>
                <div className="item-actions">
                  <Button variant="secondary" size="sm" onClick={() => openExcludedModal(provider)}>
                    {t('common.edit')}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => deleteExcluded(provider)}>
                    {t('oauth_excluded.delete')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={excludedModalOpen}
        onClose={() => setExcludedModalOpen(false)}
        title={t('oauth_excluded.add_title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setExcludedModalOpen(false)} disabled={savingExcluded}>
              {t('common.cancel')}
            </Button>
            <Button onClick={saveExcludedModels} loading={savingExcluded}>
              {t('oauth_excluded.save')}
            </Button>
          </>
        }
      >
        <Input
          label={t('oauth_excluded.provider_label')}
          placeholder={t('oauth_excluded.provider_placeholder')}
          value={excludedForm.provider}
          onChange={(e) => setExcludedForm((prev) => ({ ...prev, provider: e.target.value }))}
        />
        <div className="form-group">
          <label>{t('oauth_excluded.models_label')}</label>
          <textarea
            className="input"
            rows={4}
            placeholder={t('oauth_excluded.models_placeholder')}
            value={excludedForm.modelsText}
            onChange={(e) => setExcludedForm((prev) => ({ ...prev, modelsText: e.target.value }))}
          />
          <div className="hint">{t('oauth_excluded.models_hint')}</div>
        </div>
      </Modal>
    </div>
  );
}
