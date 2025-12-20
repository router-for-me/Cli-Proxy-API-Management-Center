import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { IconRefreshCw, IconPlus } from '@/components/ui/icons';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { apiKeysApi } from '@/services/api';
import { maskApiKey } from '@/utils/format';

export function ApiKeysPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);

  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  const disableControls = useMemo(() => connectionStatus !== 'connected', [connectionStatus]);

  const loadApiKeys = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    try {
      const result = (await fetchConfig('api-keys', force)) as string[] | undefined;
      setApiKeys(Array.isArray(result) ? result : []);
    } catch (err: any) {
      setError(err?.message || t('notification.refresh_failed'));
    } finally {
      setLoading(false);
    }
  }, [fetchConfig, t]);

  useEffect(() => { loadApiKeys(); }, [loadApiKeys]);
  useEffect(() => { if (Array.isArray(config?.apiKeys)) setApiKeys(config.apiKeys); }, [config?.apiKeys]);

  const openAddModal = () => { setEditingIndex(null); setInputValue(''); setModalOpen(true); };
  const openEditModal = (index: number) => { setEditingIndex(index); setInputValue(apiKeys[index] ?? ''); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setInputValue(''); setEditingIndex(null); };

  const handleSave = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) { showNotification(`${t('notification.please_enter')} ${t('notification.api_key')}`, 'error'); return; }
    const isEdit = editingIndex !== null;
    const nextKeys = isEdit ? apiKeys.map((key, idx) => (idx === editingIndex ? trimmed : key)) : [...apiKeys, trimmed];
    setSaving(true);
    try {
      if (isEdit && editingIndex !== null) {
        await apiKeysApi.update(editingIndex, trimmed);
        showNotification(t('notification.api_key_updated'), 'success');
      } else {
        await apiKeysApi.replace(nextKeys);
        showNotification(t('notification.api_key_added'), 'success');
      }
      setApiKeys(nextKeys);
      updateConfigValue('api-keys', nextKeys);
      clearCache('api-keys');
      closeModal();
    } catch (err: any) {
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (index: number) => {
    if (!window.confirm(t('api_keys.delete_confirm'))) return;
    setDeletingIndex(index);
    try {
      await apiKeysApi.delete(index);
      const nextKeys = apiKeys.filter((_, idx) => idx !== index);
      setApiKeys(nextKeys);
      updateConfigValue('api-keys', nextKeys);
      clearCache('api-keys');
      showNotification(t('notification.api_key_deleted'), 'success');
    } catch (err: any) {
      showNotification(`${t('notification.delete_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setDeletingIndex(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <div className="flex gap-1">
          <Button variant="secondary" size="sm" onClick={() => loadApiKeys(true)} disabled={loading} title={t('common.refresh')}><IconRefreshCw size={16} /></Button>
          <Button size="sm" onClick={openAddModal} disabled={disableControls} title={t('api_keys.add_button')}><IconPlus size={16} /></Button>
        </div>
      </div>

      {error && <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-sm">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-12"><LoadingSpinner size={28} /></div>
      ) : apiKeys.length === 0 ? (
        <Card>
          <EmptyState
            title={t('api_keys.empty_title')}
            description={t('api_keys.empty_desc')}
          />
        </Card>
      ) : (
        <div className="grid gap-3">
          {apiKeys.map((key, index) => (
            <Card key={index} className="!p-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="bg-primary text-primary-foreground text-xs w-6 h-6 flex items-center justify-center rounded font-medium">{index + 1}</span>
                  <code className="text-sm text-muted-foreground font-mono truncate">{maskApiKey(String(key || ''))}</code>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="secondary" size="sm" onClick={() => openEditModal(index)} disabled={disableControls}>{t('common.edit')}</Button>
                  <Button variant="danger" size="sm" onClick={() => handleDelete(index)} disabled={disableControls || deletingIndex === index} loading={deletingIndex === index}>{t('common.delete')}</Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editingIndex !== null ? t('api_keys.edit_modal_title') : t('api_keys.add_modal_title')}
        footer={
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={closeModal} disabled={saving}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} loading={saving}>{editingIndex !== null ? t('common.update') : t('common.add')}</Button>
          </div>
        }
      >
        <Input
          label={editingIndex !== null ? t('api_keys.edit_modal_key_label') : t('api_keys.add_modal_key_label')}
          placeholder={editingIndex !== null ? t('api_keys.edit_modal_key_label') : t('api_keys.add_modal_key_placeholder')}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={saving}
        />
      </Modal>
    </div>
  );
}
