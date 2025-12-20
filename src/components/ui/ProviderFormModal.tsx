import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { HeaderInputList } from './HeaderInputList';
import { ModelInputList, modelsToEntries, entriesToModels } from './ModelInputList';
import { headersToEntries, buildHeaderObject, type HeaderEntry } from '@/utils/headers';
import type { GeminiKeyConfig, ProviderKeyConfig } from '@/types';

type ProviderType = 'gemini' | 'codex' | 'claude';

interface ProviderFormModalProps {
  open: boolean;
  onClose: () => void;
  type: ProviderType;
  isEdit: boolean;
  initialData?: GeminiKeyConfig | ProviderKeyConfig;
  onSave: (data: GeminiKeyConfig | ProviderKeyConfig) => Promise<void>;
  saving?: boolean;
}

interface FormState {
  apiKey: string;
  baseUrl: string;
  proxyUrl: string;
  headers: HeaderEntry[];
  modelEntries: { name: string; alias: string }[];
  excludedText: string;
}

const parseExcludedModels = (text: string): string[] =>
  text.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);

const excludedModelsToText = (models?: string[]) =>
  Array.isArray(models) ? models.join('\n') : '';

export function ProviderFormModal({
  open,
  onClose,
  type,
  isEdit,
  initialData,
  onSave,
  saving = false,
}: ProviderFormModalProps) {
  const { t } = useTranslation();
  
  const [form, setForm] = useState<FormState>({
    apiKey: '',
    baseUrl: '',
    proxyUrl: '',
    headers: [{ key: '', value: '' }],
    modelEntries: [{ name: '', alias: '' }],
    excludedText: '',
  });

  useEffect(() => {
    if (open && initialData) {
      const providerData = initialData as ProviderKeyConfig;
      setForm({
        apiKey: initialData.apiKey || '',
        baseUrl: initialData.baseUrl || '',
        proxyUrl: providerData.proxyUrl || '',
        headers: headersToEntries(initialData.headers),
        modelEntries: modelsToEntries(providerData.models),
        excludedText: excludedModelsToText(initialData.excludedModels),
      });
    } else if (open) {
      setForm({
        apiKey: '',
        baseUrl: '',
        proxyUrl: '',
        headers: [{ key: '', value: '' }],
        modelEntries: [{ name: '', alias: '' }],
        excludedText: '',
      });
    }
  }, [open, initialData]);

  const handleSave = async () => {
    const payload: any = {
      apiKey: form.apiKey.trim(),
      baseUrl: form.baseUrl.trim() || undefined,
      proxyUrl: form.proxyUrl.trim() || undefined,
      headers: buildHeaderObject(form.headers),
      models: entriesToModels(form.modelEntries),
      excludedModels: parseExcludedModels(form.excludedText),
    };

    await onSave(payload);
  };

  const getTitle = () => {
    const key = isEdit 
      ? `ai_providers.${type}_edit_modal_title` 
      : `ai_providers.${type}_add_modal_title`;
    return t(key as any);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={getTitle()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} loading={saving}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Input
        label={t('common.api_key')}
        placeholder={t(`ai_providers.${type}_add_modal_key_placeholder` as any) || ''}
        value={form.apiKey}
        onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
        disabled={saving}
      />
      
      <Input
        label={`Base URL (${t('common.optional')})`}
        placeholder={t(`ai_providers.${type}_base_url_placeholder` as any) || ''}
        value={form.baseUrl}
        onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
        disabled={saving}
      />

      <Input
        label={`Proxy URL (${t('common.optional')})`}
        value={form.proxyUrl}
        onChange={(e) => setForm((prev) => ({ ...prev, proxyUrl: e.target.value }))}
        disabled={saving}
      />

      <div className="space-y-1.5">
        <label className="text-xs font-medium">{t('common.custom_headers_label')}</label>
        <HeaderInputList
          entries={form.headers}
          onChange={(entries) => setForm((prev) => ({ ...prev, headers: entries }))}
          addLabel={t('common.custom_headers_add')}
          keyPlaceholder={t('common.custom_headers_key_placeholder')}
          valuePlaceholder={t('common.custom_headers_value_placeholder')}
          disabled={saving}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">{t('ai_providers.claude_models_label')}</label>
        <ModelInputList
          entries={form.modelEntries}
          onChange={(entries) => setForm((prev) => ({ ...prev, modelEntries: entries }))}
          addLabel={t('ai_providers.claude_models_add_btn')}
          namePlaceholder={t('common.model_name_placeholder')}
          aliasPlaceholder={t('common.model_alias_placeholder')}
          disabled={saving}
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium">{t('ai_providers.excluded_models_label')}</label>
        <textarea
          className="dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-none border bg-transparent px-2.5 py-1.5 text-xs transition-colors placeholder:text-muted-foreground outline-none focus-visible:ring-1 resize-none"
          placeholder={t('ai_providers.excluded_models_placeholder')}
          value={form.excludedText}
          onChange={(e) => setForm((prev) => ({ ...prev, excludedText: e.target.value }))}
          rows={3}
          disabled={saving}
        />
        <p className="text-xs text-muted-foreground">{t('ai_providers.excluded_models_hint')}</p>
      </div>
    </Modal>
  );
}
