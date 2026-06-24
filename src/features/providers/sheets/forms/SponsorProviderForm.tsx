import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconEye, IconEyeOff } from '@/components/ui/icons';
import {
  APIKEY_FUN_ANTHROPIC_BASE_URL,
  APIKEY_FUN_CODEX_BASE_URL,
  APIKEY_FUN_OPENAI_BASE_URL,
} from '../../sponsor';
import type {
  ProviderEntryFormInput,
  ProviderResource,
  SponsorProviderRaw,
} from '../../types';
import styles from './sharedForm.module.scss';

interface SponsorProviderFormProps {
  resource: ProviderResource | null;
  mode: 'create' | 'edit';
  mutating: boolean;
  formId: string;
  onSubmit: (input: ProviderEntryFormInput) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

const emptySponsorForm = (): ProviderEntryFormInput => ({
  apiKey: '',
  name: '',
  baseUrl: '',
  proxyUrl: '',
  prefix: '',
  disabled: false,
  disableCooling: false,
  priority: undefined,
  models: [],
  headers: [],
  excludedModelsText: '',
});

const getSponsorRaw = (resource: ProviderResource | null): SponsorProviderRaw | null => {
  if (!resource || resource.brand !== 'apikeyFun') return null;
  return resource.raw as SponsorProviderRaw;
};

const firstSponsorProxy = (raw: SponsorProviderRaw | null): string => {
  const openaiProxy = raw?.openai
    .flatMap((item) => item.config.apiKeyEntries ?? [])
    .find((entry) => entry.proxyUrl?.trim())?.proxyUrl;
  if (openaiProxy) return openaiProxy;
  const codexProxy = raw?.codex.find((item) => item.config.proxyUrl?.trim())?.config.proxyUrl;
  if (codexProxy) return codexProxy;
  return raw?.claude.find((item) => item.config.proxyUrl?.trim())?.config.proxyUrl ?? '';
};

const buildInitialForm = (
  resource: ProviderResource | null,
  mode: 'create' | 'edit'
): ProviderEntryFormInput => {
  if (mode === 'create') return emptySponsorForm();
  const raw = getSponsorRaw(resource);
  const openai = raw?.openai[0]?.config;
  const codex = raw?.codex[0]?.config;
  const claude = raw?.claude[0]?.config;
  return {
    ...emptySponsorForm(),
    proxyUrl: firstSponsorProxy(raw),
    prefix: openai?.prefix ?? codex?.prefix ?? claude?.prefix ?? '',
    disabled: resource?.disabled === true,
    disableCooling:
      openai?.disableCooling === true ||
      codex?.disableCooling === true ||
      claude?.disableCooling === true,
    priority: openai?.priority ?? codex?.priority ?? claude?.priority,
  };
};

export function SponsorProviderForm({
  resource,
  mode,
  mutating,
  formId,
  onSubmit,
  onDirtyChange,
}: SponsorProviderFormProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ProviderEntryFormInput>(() =>
    buildInitialForm(resource, mode)
  );
  const [initialFormSignature] = useState<string>(() =>
    JSON.stringify(buildInitialForm(resource, mode))
  );
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDirty = useMemo(
    () => JSON.stringify(form) !== initialFormSignature,
    [form, initialFormSignature]
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const updateField = <K extends keyof ProviderEntryFormInput>(
    key: K,
    value: ProviderEntryFormInput[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === 'create' && !form.apiKey.trim()) {
      setError(t('providersPage.form.validation.apiKeyRequired'));
      return;
    }
    try {
      setError(null);
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <form id={formId} className={styles.form} onSubmit={handleSubmit} noValidate>
      <div className={styles.sponsorProtocolGrid}>
        <div className={styles.sponsorProtocolCard}>
          <span className={styles.sponsorProtocolName}>
            {t('providersPage.sponsor.protocols.anthropic')}
          </span>
          <span className={styles.sponsorProtocolUrl}>{APIKEY_FUN_ANTHROPIC_BASE_URL}</span>
        </div>
        <div className={styles.sponsorProtocolCard}>
          <span className={styles.sponsorProtocolName}>
            {t('providersPage.sponsor.protocols.openai')}
          </span>
          <span className={styles.sponsorProtocolUrl}>{APIKEY_FUN_OPENAI_BASE_URL}</span>
        </div>
        <div className={styles.sponsorProtocolCard}>
          <span className={styles.sponsorProtocolName}>
            {t('providersPage.sponsor.protocols.codexResponses')}
          </span>
          <span className={styles.sponsorProtocolUrl}>{APIKEY_FUN_CODEX_BASE_URL}</span>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${formId}-api-key`}>
            {t('providersPage.form.apiKey')}
          </label>
          <div className={styles.passwordField}>
            <input
              id={`${formId}-api-key`}
              className={styles.passwordInput}
              type={showApiKey ? 'text' : 'password'}
              value={form.apiKey}
              onChange={(event) => updateField('apiKey', event.target.value)}
              autoComplete="new-password"
              data-1p-ignore="true"
              data-lpignore="true"
              data-bwignore="true"
              placeholder={
                mode === 'edit'
                  ? t('providersPage.form.apiKeyEditPlaceholder')
                  : t('providersPage.form.apiKeyCreatePlaceholder')
              }
              disabled={mutating}
            />
            <button
              type="button"
              className={styles.passwordToggle}
              onClick={() => setShowApiKey((value) => !value)}
              disabled={mutating}
              aria-label={
                showApiKey
                  ? t('providersPage.form.hideApiKey')
                  : t('providersPage.form.showApiKey')
              }
              title={
                showApiKey
                  ? t('providersPage.form.hideApiKey')
                  : t('providersPage.form.showApiKey')
              }
            >
              {showApiKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </button>
          </div>
          <span className={styles.labelHint}>{t('providersPage.sponsor.apiKeyHint')}</span>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${formId}-proxy`}>
            {t('providersPage.form.proxyUrl')}
          </label>
          <input
            id={`${formId}-proxy`}
            className={styles.input}
            value={form.proxyUrl}
            onChange={(event) => updateField('proxyUrl', event.target.value)}
            placeholder="http://127.0.0.1:7890"
            disabled={mutating}
          />
        </div>

        <div className={styles.fieldRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${formId}-prefix`}>
              {t('providersPage.form.prefix')}
            </label>
            <input
              id={`${formId}-prefix`}
              className={styles.input}
              value={form.prefix}
              onChange={(event) => updateField('prefix', event.target.value)}
              disabled={mutating}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${formId}-priority`}>
              {t('providersPage.form.priority')}
            </label>
            <input
              id={`${formId}-priority`}
              type="number"
              className={styles.input}
              value={form.priority ?? ''}
              onChange={(event) =>
                updateField(
                  'priority',
                  event.target.value === '' ? undefined : Number(event.target.value)
                )
              }
              disabled={mutating}
            />
          </div>
        </div>

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            className={styles.checkboxBox}
            checked={form.disabled}
            disabled={mutating}
            onChange={(event) => updateField('disabled', event.target.checked)}
          />
          <span className={styles.checkboxText}>
            <span>{t('providersPage.form.disabled')}</span>
            <small>{t('providersPage.form.disabledHint')}</small>
          </span>
        </label>

        <label className={styles.checkboxRow}>
          <input
            type="checkbox"
            className={styles.checkboxBox}
            checked={form.disableCooling ?? false}
            disabled={mutating}
            onChange={(event) => updateField('disableCooling', event.target.checked)}
          />
          <span className={styles.checkboxText}>
            <span>{t('providersPage.form.disableCooling')}</span>
            <small>{t('providersPage.form.disableCoolingHint')}</small>
          </span>
        </label>
      </div>

      {error ? <div className={styles.errorBox}>{error}</div> : null}
    </form>
  );
}
