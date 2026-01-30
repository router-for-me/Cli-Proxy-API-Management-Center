import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { apiKeysApi, apiKeyNamesApi } from '@/services/api';
import { maskApiKey, getApiKeyDisplayName } from '@/utils/format';
import { isValidApiKeyCharset } from '@/utils/validation';
import styles from './ApiKeysPage.module.scss';

export function ApiKeysPage() {
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);

  const config = useConfigStore((state) => state.config);
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  const updateConfigValue = useConfigStore((state) => state.updateConfigValue);
  const clearCache = useConfigStore((state) => state.clearCache);

  const [apiKeys, setApiKeys] = useState<string[]>([]);
  const [apiKeyNames, setApiKeyNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [keyNameValue, setKeyNameValue] = useState('');
  const [saving, setSaving] = useState(false);

  const disableControls = useMemo(() => connectionStatus !== 'connected', [connectionStatus]);

  const loadApiKeys = useCallback(
    async (force = false) => {
      setLoading(true);
      setError('');
      try {
        const result = (await fetchConfig('api-keys', force)) as string[] | undefined;
        const list = Array.isArray(result) ? result : [];
        setApiKeys(list);

        // Load key names directly (has localStorage fallback)
        const names = await apiKeyNamesApi.get();
        setApiKeyNames(names);
      } catch (err: any) {
        setError(err?.message || t('notification.refresh_failed'));
      } finally {
        setLoading(false);
      }
    },
    [fetchConfig, t]
  );

  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

  useEffect(() => {
    if (Array.isArray(config?.apiKeys)) {
      setApiKeys(config.apiKeys);
    }
    // Note: apiKeyNames is loaded from apiKeyNamesApi.get() which has localStorage fallback
    // Don't override from config as it may be empty when backend doesn't support it
  }, [config?.apiKeys]);

  const openAddModal = () => {
    setEditingIndex(null);
    setInputValue('');
    setKeyNameValue('');
    setModalOpen(true);
  };

  const openEditModal = (index: number) => {
    const key = apiKeys[index] ?? '';
    setEditingIndex(index);
    setInputValue(key);
    setKeyNameValue(apiKeyNames[key] ?? '');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setInputValue('');
    setKeyNameValue('');
    setEditingIndex(null);
  };

  const handleSave = async () => {
    const trimmedKey = inputValue.trim();
    const trimmedName = keyNameValue.trim();

    if (!trimmedKey) {
      showNotification(`${t('notification.please_enter')} ${t('notification.api_key')}`, 'error');
      return;
    }
    if (!isValidApiKeyCharset(trimmedKey)) {
      showNotification(t('notification.api_key_invalid_chars'), 'error');
      return;
    }

    const isEdit = editingIndex !== null;
    const oldKey = isEdit ? apiKeys[editingIndex] : null;
    const nextKeys = isEdit
      ? apiKeys.map((key, idx) => (idx === editingIndex ? trimmedKey : key))
      : [...apiKeys, trimmedKey];

    setSaving(true);
    try {
      if (isEdit && editingIndex !== null) {
        await apiKeysApi.update(editingIndex, trimmedKey);
        showNotification(t('notification.api_key_updated'), 'success');
      } else {
        await apiKeysApi.replace(nextKeys);
        showNotification(t('notification.api_key_added'), 'success');
      }

      // Update key names (don't block main operation if this fails)
      const newNames = { ...apiKeyNames };
      if (isEdit && oldKey && oldKey !== trimmedKey) {
        delete newNames[oldKey];
      }
      if (trimmedName) {
        newNames[trimmedKey] = trimmedName;
      } else {
        delete newNames[trimmedKey];
      }

      // Save key names - silently ignore errors
      try {
        await apiKeyNamesApi.update(newNames);
      } catch {
        // Ignore - localStorage fallback already saved
      }

      setApiKeys(nextKeys);
      setApiKeyNames(newNames);
      updateConfigValue('api-keys', nextKeys);
      updateConfigValue('api-key-names', newNames);
      clearCache('api-keys');
      clearCache('api-key-names');
      closeModal();
    } catch (err: any) {
      showNotification(`${t('notification.update_failed')}: ${err?.message || ''}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (index: number) => {
    const apiKeyToDelete = apiKeys[index];
    if (!apiKeyToDelete) {
      showNotification(t('notification.delete_failed'), 'error');
      return;
    }

    showConfirmation({
      title: t('common.delete'),
      message: t('api_keys.delete_confirm'),
      variant: 'danger',
      onConfirm: async () => {
        const latestKeys = useConfigStore.getState().config?.apiKeys;
        const currentKeys = Array.isArray(latestKeys) ? latestKeys : [];
        const deleteIndex =
          currentKeys[index] === apiKeyToDelete
            ? index
            : currentKeys.findIndex((key) => key === apiKeyToDelete);

        if (deleteIndex < 0) {
          showNotification(t('notification.delete_failed'), 'error');
          return;
        }

        try {
          await apiKeysApi.delete(deleteIndex);
          const nextKeys = currentKeys.filter((_, idx) => idx !== deleteIndex);

          // Remove key name - silently ignore errors
          const newNames = { ...apiKeyNames };
          delete newNames[apiKeyToDelete];
          try {
            await apiKeyNamesApi.update(newNames);
          } catch {
            // Ignore - localStorage fallback already saved
          }

          setApiKeys(nextKeys);
          setApiKeyNames(newNames);
          updateConfigValue('api-keys', nextKeys);
          updateConfigValue('api-key-names', newNames);
          clearCache('api-keys');
          clearCache('api-key-names');
          showNotification(t('notification.api_key_deleted'), 'success');
        } catch (err: any) {
          showNotification(`${t('notification.delete_failed')}: ${err?.message || ''}`, 'error');
        }
      }
    });
  };

  const actionButtons = (
    <div style={{ display: 'flex', gap: 8 }}>
      <Button variant="secondary" size="sm" onClick={() => loadApiKeys(true)} disabled={loading}>
        {t('common.refresh')}
      </Button>
      <Button size="sm" onClick={openAddModal} disabled={disableControls}>
        {t('api_keys.add_button')}
      </Button>
    </div>
  );

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('api_keys.title')}</h1>

      <Card title={t('api_keys.proxy_auth_title')} extra={actionButtons}>
        {error && <div className="error-box">{error}</div>}

        {loading ? (
          <div className="flex-center" style={{ padding: '24px 0' }}>
            <LoadingSpinner size={28} />
          </div>
        ) : apiKeys.length === 0 ? (
          <EmptyState
            title={t('api_keys.empty_title')}
            description={t('api_keys.empty_desc')}
            action={
              <Button onClick={openAddModal} disabled={disableControls}>
                {t('api_keys.add_button')}
              </Button>
            }
          />
        ) : (
          <div className="item-list">
            {apiKeys.map((key, index) => {
              const displayName = getApiKeyDisplayName(key, apiKeyNames);
              const hasCustomName = apiKeyNames[key] && apiKeyNames[key].trim();
              return (
                <div key={index} className="item-row">
                  <div className="item-meta">
                    <div className="pill">#{index + 1}</div>
                    <div className="item-title">
                      {hasCustomName ? displayName : t('api_keys.item_title')}
                    </div>
                    <div className="item-subtitle">
                      {hasCustomName ? maskApiKey(String(key || '')) : displayName}
                    </div>
                  </div>
                  <div className="item-actions">
                    <Button variant="secondary" size="sm" onClick={() => openEditModal(index)} disabled={disableControls}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(index)}
                      disabled={disableControls}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Modal
          open={modalOpen}
          onClose={closeModal}
          title={editingIndex !== null ? t('api_keys.edit_modal_title') : t('api_keys.add_modal_title')}
          footer={
            <>
              <Button variant="secondary" onClick={closeModal} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSave} loading={saving}>
                {editingIndex !== null ? t('common.update') : t('common.add')}
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Input
              label={t('api_keys.key_name_label')}
              placeholder={t('api_keys.key_name_placeholder')}
              value={keyNameValue}
              onChange={(e) => setKeyNameValue(e.target.value)}
              disabled={saving}
            />
            <Input
              label={
                editingIndex !== null ? t('api_keys.edit_modal_key_label') : t('api_keys.add_modal_key_label')
              }
              placeholder={
                editingIndex !== null
                  ? t('api_keys.edit_modal_key_label')
                  : t('api_keys.add_modal_key_placeholder')
              }
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              disabled={saving}
            />
          </div>
        </Modal>
      </Card>
    </div>
  );
}
