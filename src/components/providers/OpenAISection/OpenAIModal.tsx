import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { HeaderInputList } from '@/components/ui/HeaderInputList';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ModelInputList, modelsToEntries } from '@/components/ui/ModelInputList';
import { useNotificationStore } from '@/stores';
import type { OpenAIProviderConfig, ApiKeyEntry } from '@/types';
import { headersToEntries } from '@/utils/headers';
import type { ModelInfo } from '@/utils/models';
import { buildApiKeyEntry } from '../utils';
import type { ModelEntry, OpenAIFormState, ProviderModalProps } from '../types';
import { OpenAIDiscoveryModal } from './OpenAIDiscoveryModal';

interface OpenAIModalProps extends ProviderModalProps<OpenAIProviderConfig, OpenAIFormState> {
  isSaving: boolean;
}

const buildEmptyForm = (): OpenAIFormState => ({
  name: '',
  prefix: '',
  baseUrl: '',
  headers: [],
  apiKeyEntries: [buildApiKeyEntry()],
  modelEntries: [{ name: '', alias: '' }],
});

export function OpenAIModal({
  isOpen,
  editIndex,
  initialData,
  onClose,
  onSave,
  isSaving,
}: OpenAIModalProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [form, setForm] = useState<OpenAIFormState>(buildEmptyForm);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setDiscoveryOpen(false);
      return;
    }

    if (initialData) {
      const modelEntries = modelsToEntries(initialData.models);
      setForm({
        name: initialData.name,
        prefix: initialData.prefix ?? '',
        baseUrl: initialData.baseUrl,
        headers: headersToEntries(initialData.headers),
        modelEntries,
        apiKeyEntries: initialData.apiKeyEntries?.length
          ? initialData.apiKeyEntries
          : [buildApiKeyEntry()],
      });
    } else {
      setForm(buildEmptyForm());
    }

    setDiscoveryOpen(false);
  }, [initialData, isOpen]);

  const renderKeyEntries = (entries: ApiKeyEntry[]) => {
    const list = entries.length ? entries : [buildApiKeyEntry()];
    const updateEntry = (idx: number, field: keyof ApiKeyEntry, value: string) => {
      const next = list.map((entry, i) => (i === idx ? { ...entry, [field]: value } : entry));
      setForm((prev) => ({ ...prev, apiKeyEntries: next }));
    };

    const removeEntry = (idx: number) => {
      const next = list.filter((_, i) => i !== idx);
      setForm((prev) => ({
        ...prev,
        apiKeyEntries: next.length ? next : [buildApiKeyEntry()],
      }));
    };

    const addEntry = () => {
      setForm((prev) => ({ ...prev, apiKeyEntries: [...list, buildApiKeyEntry()] }));
    };

    return (
      <div className="stack">
        {list.map((entry, index) => (
          <div key={index} className="item-row">
            <div className="item-meta">
              <Input
                label={`${t('common.api_key')} #${index + 1}`}
                value={entry.apiKey}
                onChange={(e) => updateEntry(index, 'apiKey', e.target.value)}
              />
              <Input
                label={t('common.proxy_url')}
                value={entry.proxyUrl ?? ''}
                onChange={(e) => updateEntry(index, 'proxyUrl', e.target.value)}
              />
            </div>
            <div className="item-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeEntry(index)}
                disabled={list.length <= 1 || isSaving}
              >
                {t('common.delete')}
              </Button>
            </div>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={addEntry} disabled={isSaving}>
          {t('ai_providers.openai_keys_add_btn')}
        </Button>
      </div>
    );
  };

  const openOpenaiModelDiscovery = () => {
    const baseUrl = form.baseUrl.trim();
    if (!baseUrl) {
      showNotification(t('ai_providers.openai_models_fetch_invalid_url'), 'error');
      return;
    }
    setDiscoveryOpen(true);
  };

  const applyOpenaiModelDiscoverySelection = (selectedModels: ModelInfo[]) => {
    if (!selectedModels.length) {
      setDiscoveryOpen(false);
      return;
    }

    const mergedMap = new Map<string, ModelEntry>();
    form.modelEntries.forEach((entry) => {
      const name = entry.name.trim();
      if (!name) return;
      mergedMap.set(name, { name, alias: entry.alias?.trim() || '' });
    });

    let addedCount = 0;
    selectedModels.forEach((model) => {
      const name = model.name.trim();
      if (!name || mergedMap.has(name)) return;
      mergedMap.set(name, { name, alias: model.alias ?? '' });
      addedCount += 1;
    });

    const mergedEntries = Array.from(mergedMap.values());
    setForm((prev) => ({
      ...prev,
      modelEntries: mergedEntries.length ? mergedEntries : [{ name: '', alias: '' }],
    }));

    setDiscoveryOpen(false);
    if (addedCount > 0) {
      showNotification(t('ai_providers.openai_models_fetch_added', { count: addedCount }), 'success');
    }
  };

  return (
    <>
      <Modal
        open={isOpen}
        onClose={onClose}
        title={
          editIndex !== null
            ? t('ai_providers.openai_edit_modal_title')
            : t('ai_providers.openai_add_modal_title')
        }
        footer={
          <>
            <Button variant="secondary" onClick={onClose} disabled={isSaving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => void onSave(form, editIndex)} loading={isSaving}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <Input
          label={t('ai_providers.openai_add_modal_name_label')}
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
        />
        <Input
          label={t('ai_providers.prefix_label')}
          placeholder={t('ai_providers.prefix_placeholder')}
          value={form.prefix ?? ''}
          onChange={(e) => setForm((prev) => ({ ...prev, prefix: e.target.value }))}
          hint={t('ai_providers.prefix_hint')}
        />
        <Input
          label={t('ai_providers.openai_add_modal_url_label')}
          value={form.baseUrl}
          onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
        />

        <HeaderInputList
          entries={form.headers}
          onChange={(entries) => setForm((prev) => ({ ...prev, headers: entries }))}
          addLabel={t('common.custom_headers_add')}
          keyPlaceholder={t('common.custom_headers_key_placeholder')}
          valuePlaceholder={t('common.custom_headers_value_placeholder')}
        />

        <div className="form-group">
          <label>
            {editIndex !== null
              ? t('ai_providers.openai_edit_modal_models_label')
              : t('ai_providers.openai_add_modal_models_label')}
          </label>
          <div className="hint">{t('ai_providers.openai_models_hint')}</div>
          <ModelInputList
            entries={form.modelEntries}
            onChange={(entries) => setForm((prev) => ({ ...prev, modelEntries: entries }))}
            addLabel={t('ai_providers.openai_models_add_btn')}
            namePlaceholder={t('common.model_name_placeholder')}
            aliasPlaceholder={t('common.model_alias_placeholder')}
            disabled={isSaving}
          />
          <Button variant="secondary" size="sm" onClick={openOpenaiModelDiscovery} disabled={isSaving}>
            {t('ai_providers.openai_models_fetch_button')}
          </Button>
        </div>

        <div className="form-group">
          <label>{t('ai_providers.openai_add_modal_keys_label')}</label>
          {renderKeyEntries(form.apiKeyEntries)}
        </div>
      </Modal>

      <OpenAIDiscoveryModal
        isOpen={discoveryOpen}
        baseUrl={form.baseUrl}
        headers={form.headers}
        apiKeyEntries={form.apiKeyEntries}
        onClose={() => setDiscoveryOpen(false)}
        onApply={applyOpenaiModelDiscoverySelection}
      />
    </>
  );
}
