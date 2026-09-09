import { memo, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useNotificationStore } from '@/stores';
import { copyToClipboard } from '@/utils/clipboard';
import { makeClientId } from '@/types/visualConfig';
import { generateSecureApiKey } from '@/utils/apiKey';
import { maskApiKey } from '@/utils/format';
import { isValidApiKeyCharset } from '@/utils/validation';
import { apiKeysApi } from '@/services/api/apiKeys';
import { ApiKeyStrengthMeter } from './ApiKeyStrengthMeter';
import styles from './Blocks.module.scss';

export const ApiKeysCardEditor = memo(function ApiKeysCardEditor({
  value,
  prefixes,
  disabled,
  onChange,
}: {
  value: string;
  prefixes: Record<string, string[]>;
  disabled?: boolean;
  onChange: (nextValue: string, prefixes: Record<string, string[]>) => void;
}) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const apiKeys = useMemo(
    () =>
      value
        .split('\n')
        .map((key) => key.trim())
        .filter(Boolean),
    [value]
  );
  const [apiKeyIds, setApiKeyIds] = useState(() => apiKeys.map(() => makeClientId()));
  const renderApiKeyIds = useMemo(() => {
    if (apiKeyIds.length === apiKeys.length) return apiKeyIds;
    if (apiKeyIds.length > apiKeys.length) return apiKeyIds.slice(0, apiKeys.length);
    return [
      ...apiKeyIds,
      ...Array.from({ length: apiKeys.length - apiKeyIds.length }, () => makeClientId()),
    ];
  }, [apiKeyIds, apiKeys.length]);

  const apiKeyInputId = useId();
  const apiKeyHintId = `${apiKeyInputId}-hint`;
  const apiKeyErrorId = `${apiKeyInputId}-error`;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingApiKeyId, setEditingApiKeyId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [formError, setFormError] = useState('');
  const [selectedPrefixes, setSelectedPrefixes] = useState<string[]>([]);
  const [prefixOptions, setPrefixOptions] = useState<string[]>([]);
  const [prefixLoading, setPrefixLoading] = useState(false);
  const [prefixError, setPrefixError] = useState(false);
  const [prefixSearch, setPrefixSearch] = useState('');

  useEffect(() => {
    if (!modalOpen) return;
    let active = true;
    apiKeysApi
      .prefixOptions()
      .then((options) => {
        if (active) setPrefixOptions(options);
      })
      .catch(() => {
        if (active) setPrefixError(true);
      })
      .finally(() => {
        if (active) setPrefixLoading(false);
      });
    return () => {
      active = false;
    };
  }, [modalOpen]);

  const preparePrefixes = (selected: string[]) => {
    setSelectedPrefixes([...selected]);
    setPrefixOptions([]);
    setPrefixLoading(true);
    setPrefixError(false);
    setPrefixSearch('');
  };

  const openAddModal = () => {
    setEditingApiKeyId(null);
    preparePrefixes([]);
    setInputValue('');
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (apiKeyId: string) => {
    const editingIndex = renderApiKeyIds.findIndex((id) => id === apiKeyId);
    setEditingApiKeyId(apiKeyId);
    preparePrefixes(
      Object.prototype.hasOwnProperty.call(prefixes, apiKeys[editingIndex])
        ? prefixes[apiKeys[editingIndex]]
        : []
    );
    setInputValue(apiKeys[editingIndex] ?? '');
    setFormError('');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setInputValue('');
    setEditingApiKeyId(null);
    setFormError('');
  };

  const updateApiKeys = (nextKeys: string[], nextPrefixes = prefixes) => {
    onChange(nextKeys.join('\n'), nextPrefixes);
  };

  const handleDelete = (apiKeyId: string) => {
    const index = renderApiKeyIds.findIndex((id) => id === apiKeyId);
    if (index < 0) return;
    setApiKeyIds(renderApiKeyIds.filter((id) => id !== apiKeyId));
    const nextPrefixes = { ...prefixes };
    delete nextPrefixes[apiKeys[index]];
    updateApiKeys(
      apiKeys.filter((_, i) => i !== index),
      nextPrefixes
    );
  };

  const handleSave = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setFormError(t('config_management.visual.api_keys.error_empty'));
      return;
    }
    if (!isValidApiKeyCharset(trimmed)) {
      setFormError(t('config_management.visual.api_keys.error_invalid'));
      return;
    }

    const editingIndex = editingApiKeyId
      ? renderApiKeyIds.findIndex((id) => id === editingApiKeyId)
      : -1;
    const nextKeys =
      editingApiKeyId === null
        ? [...apiKeys, trimmed]
        : apiKeys.map((key, idx) => (idx === editingIndex ? trimmed : key));
    if (apiKeys.some((key, index) => key === trimmed && index !== editingIndex)) {
      setFormError(t('config_management.visual.api_keys.error_duplicate'));
      return;
    }
    const nextPrefixes = { ...prefixes };
    if (editingIndex >= 0) delete nextPrefixes[apiKeys[editingIndex]];
    if (selectedPrefixes.length > 0)
      Object.defineProperty(nextPrefixes, trimmed, {
        value: [...selectedPrefixes],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    else delete nextPrefixes[trimmed];
    if (editingApiKeyId === null) {
      setApiKeyIds([...renderApiKeyIds, makeClientId()]);
    }
    updateApiKeys(nextKeys, nextPrefixes);
    closeModal();
  };

  const handleCopy = async (apiKey: string) => {
    const copied = await copyToClipboard(apiKey);
    showNotification(
      t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
      copied ? 'success' : 'error'
    );
  };

  const handleGenerate = () => {
    setInputValue(generateSecureApiKey());
    setFormError('');
  };

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      <div className={styles.blockHeaderRow}>
        <label style={{ margin: 0 }}>{t('config_management.visual.api_keys.label')}</label>
        <Button size="sm" onClick={openAddModal} disabled={disabled}>
          {t('config_management.visual.api_keys.add')}
        </Button>
      </div>

      {apiKeys.length === 0 ? (
        <div className={styles.emptyState}>{t('config_management.visual.api_keys.empty')}</div>
      ) : (
        <div className="item-list" style={{ marginTop: 4 }}>
          {apiKeys.map((key, index) => (
            <div key={renderApiKeyIds[index] ?? `${key}-${index}`} className="item-row">
              <div className="item-meta">
                <div className="pill">#{index + 1}</div>
                <div className="item-title">
                  {t('config_management.visual.api_keys.input_label')}
                </div>
                <div className="item-subtitle">{maskApiKey(String(key || ''))}</div>
                <div className="item-subtitle" style={{ overflowWrap: 'anywhere' }}>
                  {Object.prototype.hasOwnProperty.call(prefixes, key) && prefixes[key]?.length
                    ? prefixes[key].join(', ')
                    : t('config_management.visual.api_keys.all_prefixes')}
                </div>
              </div>
              <div className="item-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleCopy(key)}
                  disabled={disabled}
                >
                  {t('common.copy')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openEditModal(renderApiKeyIds[index] ?? '')}
                  disabled={disabled}
                >
                  {t('config_management.visual.common.edit')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleDelete(renderApiKeyIds[index] ?? '')}
                  disabled={disabled}
                >
                  {t('config_management.visual.common.delete')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="hint">{t('config_management.visual.api_keys.hint')}</div>

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={
          editingApiKeyId !== null
            ? t('config_management.visual.api_keys.edit_title')
            : t('config_management.visual.api_keys.add_title')
        }
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={disabled}>
              {t('config_management.visual.common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={disabled || prefixLoading || prefixError}>
              {editingApiKeyId !== null
                ? t('config_management.visual.common.update')
                : t('config_management.visual.common.add')}
            </Button>
          </>
        }
      >
        <div className="form-group">
          <label htmlFor={apiKeyInputId}>
            {t('config_management.visual.api_keys.input_label')}
          </label>
          <div className={styles.apiKeyModalInputRow}>
            <input
              id={apiKeyInputId}
              className="input"
              placeholder={t('config_management.visual.api_keys.input_placeholder')}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              disabled={disabled}
              aria-describedby={formError ? `${apiKeyErrorId} ${apiKeyHintId}` : apiKeyHintId}
              aria-invalid={Boolean(formError)}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleGenerate}
              disabled={disabled}
            >
              {t('config_management.visual.api_keys.generate')}
            </Button>
          </div>
          <ApiKeyStrengthMeter value={inputValue} />
          <div id={apiKeyHintId} className="hint">
            {t('config_management.visual.api_keys.input_hint')}
          </div>
          {formError && (
            <div id={apiKeyErrorId} className="error-box">
              {formError}
            </div>
          )}
        </div>
        <fieldset
          className={styles.prefixFieldset}
          disabled={disabled || prefixLoading || prefixError}
        >
          <legend>{t('config_management.visual.api_keys.allowed_prefixes')}</legend>
          <div className="hint">
            {selectedPrefixes.length === 0
              ? t('config_management.visual.api_keys.all_prefixes')
              : t('config_management.visual.api_keys.selected_prefixes', {
                  count: selectedPrefixes.length,
                })}
          </div>
          <input
            className="input"
            type="search"
            value={prefixSearch}
            onChange={(event) => setPrefixSearch(event.target.value)}
            aria-label={t('config_management.visual.api_keys.search_prefixes')}
            placeholder={t('config_management.visual.api_keys.search_prefixes')}
          />
          {prefixLoading && <div role="status">{t('common.loading')}</div>}
          {prefixError && (
            <div role="alert" className="error-box">
              {t('config_management.visual.api_keys.prefix_load_error')}
            </div>
          )}
          <div className={styles.prefixOptions}>
            {[...new Set([...prefixOptions, ...selectedPrefixes])]
              .sort()
              .filter((prefix) => prefix.toLowerCase().includes(prefixSearch.toLowerCase()))
              .map((prefix) => (
                <label key={prefix} className={styles.prefixOption}>
                  <input
                    type="checkbox"
                    checked={selectedPrefixes.includes(prefix)}
                    onChange={(event) =>
                      setSelectedPrefixes((current) =>
                        event.target.checked
                          ? [...current, prefix]
                          : current.filter((item) => item !== prefix)
                      )
                    }
                  />
                  <span>{prefix}</span>
                </label>
              ))}
          </div>
          {!prefixLoading &&
            !prefixError &&
            prefixOptions.length === 0 &&
            selectedPrefixes.length === 0 && (
              <div className="hint">{t('config_management.visual.api_keys.no_prefixes')}</div>
            )}
        </fieldset>
      </Modal>
    </div>
  );
});
