import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconAlertTriangle,
  IconCheckCircle2,
  IconLoader2,
  IconPlus,
  IconX,
} from '@/components/ui/icons';
import { Collapsible } from '@/components/ui/Collapsible';
import { hasDisableAllModelsRule } from '@/components/providers/utils';
import type {
  GeminiKeyConfig,
  OpenAIProviderConfig,
  ProviderKeyConfig,
} from '@/types';
import { PROVIDER_DESCRIPTORS } from '../../descriptors';
import type {
  ApiKeyEntryInput,
  ModelEntryInput,
  ProviderBrand,
  ProviderEntryFormInput,
  ProviderResource,
} from '../../types';
import {
  useConnectivityTest,
  type ConnectivityErrorMessages,
  type ConnectivityState,
} from './useConnectivityTest';
import styles from './sharedForm.module.scss';

export interface BaseProviderFormHandle {
  submit: () => Promise<void>;
}

interface BaseProviderFormProps {
  brand: Exclude<ProviderBrand, 'ampcode'>;
  resource: ProviderResource | null;
  mode: 'create' | 'edit';
  mutating: boolean;
  formId: string;
  onSubmit: (input: ProviderEntryFormInput) => Promise<void>;
}

const emptyHeader = () => ({ key: '', value: '' });
const emptyModel = (): ModelEntryInput => ({ name: '', alias: '' });
const emptyApiKeyEntry = (): ApiKeyEntryInput => ({
  apiKey: '',
  proxyUrl: '',
  headersText: '',
});

const headersObjectToText = (headers?: Record<string, string>): string =>
  Object.entries(headers ?? {})
    .filter(([k]) => k.trim())
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

const stripDisableAllRule = (list?: string[]): string[] =>
  (list ?? []).filter((s) => s.trim() !== '*');

function buildInitialForm(
  brand: Exclude<ProviderBrand, 'ampcode'>,
  resource: ProviderResource | null,
  mode: 'create' | 'edit'
): ProviderEntryFormInput {
  if (mode === 'create' || !resource) {
    return {
      apiKey: '',
      name: '',
      baseUrl: '',
      proxyUrl: '',
      prefix: '',
      disabled: false,
      priority: undefined,
      models: [emptyModel()],
      headers: [emptyHeader()],
      excludedModelsText: '',
      websockets: brand === 'codex' ? false : undefined,
      cloak:
        brand === 'claude'
          ? { mode: '', strictMode: false, sensitiveWordsText: '' }
          : undefined,
      testModel:
        brand === 'openaiCompatibility' || brand === 'claude' ? '' : undefined,
      apiKeyEntries:
        brand === 'openaiCompatibility' ? [emptyApiKeyEntry()] : undefined,
    };
  }

  const raw = resource.raw;
  if (brand === 'openaiCompatibility') {
    const cfg = raw as OpenAIProviderConfig;
    return {
      apiKey: '',
      name: cfg.name ?? '',
      baseUrl: cfg.baseUrl ?? '',
      proxyUrl: '',
      prefix: cfg.prefix ?? '',
      disabled: cfg.disabled === true,
      priority: cfg.priority,
      models: cfg.models?.length
        ? cfg.models.map((m) => ({
            name: m.name,
            alias: m.alias ?? '',
            priority: m.priority,
            testModel: m.testModel,
          }))
        : [emptyModel()],
      headers: cfg.headers
        ? Object.entries(cfg.headers).map(([k, v]) => ({ key: k, value: String(v) }))
        : [emptyHeader()],
      excludedModelsText: '',
      testModel: cfg.testModel ?? '',
      apiKeyEntries: cfg.apiKeyEntries?.length
        ? cfg.apiKeyEntries.map((entry) => ({
            apiKey: entry.apiKey,
            proxyUrl: entry.proxyUrl ?? '',
            headersText: headersObjectToText(entry.headers),
          }))
        : [emptyApiKeyEntry()],
    };
  }

  const cfg = raw as GeminiKeyConfig & ProviderKeyConfig;
  const disabled = hasDisableAllModelsRule(cfg.excludedModels);
  const excludedList = stripDisableAllRule(cfg.excludedModels);
  return {
    apiKey: '',
    name: '',
    baseUrl: cfg.baseUrl ?? '',
    proxyUrl: cfg.proxyUrl ?? '',
    prefix: cfg.prefix ?? '',
    disabled,
    priority: cfg.priority,
    models: cfg.models?.length
      ? cfg.models.map((m) => ({
          name: m.name,
          alias: m.alias ?? '',
          priority: m.priority,
          testModel: m.testModel,
        }))
      : [emptyModel()],
    headers: cfg.headers
      ? Object.entries(cfg.headers).map(([k, v]) => ({ key: k, value: String(v) }))
      : [emptyHeader()],
    excludedModelsText: excludedList.join('\n'),
    websockets:
      brand === 'codex' ? (cfg as ProviderKeyConfig).websockets === true : undefined,
    cloak:
      brand === 'claude'
        ? {
            mode: (cfg as ProviderKeyConfig).cloak?.mode ?? '',
            strictMode: (cfg as ProviderKeyConfig).cloak?.strictMode === true,
            sensitiveWordsText:
              (cfg as ProviderKeyConfig).cloak?.sensitiveWords?.join('\n') ?? '',
          }
        : undefined,
    testModel: brand === 'claude' ? '' : undefined,
  };
}

function ConnectivityStatusIcon({ state }: { state: ConnectivityState }) {
  if (state === 'loading') {
    return (
      <span className={`${styles.statusIcon} ${styles.statusIconLoading}`}>
        <IconLoader2 size={14} />
      </span>
    );
  }
  if (state === 'success') {
    return (
      <span className={`${styles.statusIcon} ${styles.statusIconSuccess}`}>
        <IconCheckCircle2 size={14} />
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className={`${styles.statusIcon} ${styles.statusIconError}`}>
        <IconAlertTriangle size={14} />
      </span>
    );
  }
  return null;
}

export function BaseProviderForm({
  brand,
  resource,
  mode,
  mutating,
  formId,
  onSubmit,
}: BaseProviderFormProps) {
  const { t } = useTranslation();
  const descriptor = PROVIDER_DESCRIPTORS[brand];
  const fid = useId();
  const [form, setForm] = useState<ProviderEntryFormInput>(() =>
    buildInitialForm(brand, resource, mode)
  );
  const [error, setError] = useState<string | null>(null);

  const fallbackApiKey = useMemo(() => {
    if (brand !== 'claude' || mode !== 'edit' || !resource) return '';
    return (resource.raw as ProviderKeyConfig | undefined)?.apiKey ?? '';
  }, [brand, mode, resource]);

  const connectivityMessages = useMemo<ConnectivityErrorMessages>(
    () => ({
      baseUrlRequired: t('providersPage.connectivity.baseUrlRequired'),
      endpointInvalid: t('providersPage.connectivity.endpointInvalid'),
      apiKeyRequired: t('providersPage.connectivity.apiKeyRequired'),
      modelRequired: t('providersPage.connectivity.modelRequired'),
      timeout: (seconds: number) =>
        t('providersPage.connectivity.timeout', { seconds }),
      requestFailed: t('providersPage.connectivity.requestFailed'),
    }),
    [t]
  );

  const connectivity = useConnectivityTest(
    {
      brand,
      baseUrl: form.baseUrl,
      testModel: form.testModel,
      models: form.models,
      formHeaders: form.headers,
      apiKeyEntries: form.apiKeyEntries,
      apiKey: form.apiKey,
      fallbackApiKey,
    },
    connectivityMessages
  );

  const updateField = <K extends keyof ProviderEntryFormInput>(
    key: K,
    value: ProviderEntryFormInput[K]
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateCloak = <K extends keyof NonNullable<ProviderEntryFormInput['cloak']>>(
    key: K,
    value: NonNullable<ProviderEntryFormInput['cloak']>[K]
  ) => {
    setForm((prev) => ({
      ...prev,
      cloak: {
        ...(prev.cloak ?? { mode: '', strictMode: false, sensitiveWordsText: '' }),
        [key]: value,
      },
    }));
  };

  const validate = (): string | null => {
    if (descriptor.supportsName && !form.name.trim()) {
      return t('providersPage.form.validation.nameRequired');
    }
    if (
      descriptor.supportsApiKey &&
      mode === 'create' &&
      !form.apiKey.trim()
    ) {
      return t('providersPage.form.validation.apiKeyRequired');
    }
    if (descriptor.baseUrlRequired && !form.baseUrl.trim()) {
      return t('providersPage.form.validation.baseUrlRequired');
    }
    if (
      brand === 'openaiCompatibility' &&
      mode === 'create' &&
      !form.apiKeyEntries?.some((e) => e.apiKey.trim())
    ) {
      return t('providersPage.form.validation.apiKeyRequired');
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    try {
      setError(null);
      await onSubmit(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /* ------------------ entries helpers ------------------ */

  const headersList = useMemo(
    () => (form.headers.length ? form.headers : [emptyHeader()]),
    [form.headers]
  );
  const modelsList = useMemo(
    () => (form.models.length ? form.models : [emptyModel()]),
    [form.models]
  );
  const apiKeyEntries = useMemo(
    () =>
      form.apiKeyEntries && form.apiKeyEntries.length
        ? form.apiKeyEntries
        : [emptyApiKeyEntry()],
    [form.apiKeyEntries]
  );

  return (
    <form id={formId} className={styles.form} onSubmit={handleSubmit} noValidate>
      {/* 基础字段 */}
      <div className={styles.section}>
        {descriptor.supportsName ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-name`}>
              {t('providersPage.form.name')}
            </label>
            <input
              id={`${fid}-name`}
              className={styles.input}
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              disabled={mutating}
            />
          </div>
        ) : null}

        {descriptor.supportsApiKey ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-apiKey`}>
              {t('providersPage.form.apiKey')}
            </label>
            <input
              id={`${fid}-apiKey`}
              className={styles.input}
              type="password"
              value={form.apiKey}
              onChange={(e) => updateField('apiKey', e.target.value)}
              placeholder={
                mode === 'edit'
                  ? t('providersPage.form.apiKeyEditPlaceholder')
                  : t('providersPage.form.apiKeyCreatePlaceholder')
              }
              disabled={mutating}
            />
          </div>
        ) : null}

        {descriptor.supportsBaseUrl ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-baseUrl`}>
              {t('providersPage.form.baseUrl')}
              {descriptor.baseUrlRequired ? (
                <span className={styles.labelHint}>
                  {' '}
                  · {t('providersPage.form.baseUrlRequiredHint')}
                </span>
              ) : null}
            </label>
            <input
              id={`${fid}-baseUrl`}
              className={styles.input}
              value={form.baseUrl}
              onChange={(e) => updateField('baseUrl', e.target.value)}
              placeholder="https://api.example.com"
              disabled={mutating}
            />
          </div>
        ) : null}

        {descriptor.supportsProxyUrl ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-proxy`}>
              {t('providersPage.form.proxyUrl')}
            </label>
            <input
              id={`${fid}-proxy`}
              className={styles.input}
              value={form.proxyUrl}
              onChange={(e) => updateField('proxyUrl', e.target.value)}
              placeholder="http://127.0.0.1:7890"
              disabled={mutating}
            />
          </div>
        ) : null}

        {descriptor.supportsPrefix ? (
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${fid}-prefix`}>
                {t('providersPage.form.prefix')}
              </label>
              <input
                id={`${fid}-prefix`}
                className={styles.input}
                value={form.prefix}
                onChange={(e) => updateField('prefix', e.target.value)}
                disabled={mutating}
              />
            </div>
            {descriptor.supportsPriority ? (
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${fid}-prio`}>
                  {t('providersPage.form.priority')}
                </label>
                <input
                  id={`${fid}-prio`}
                  type="number"
                  className={styles.input}
                  value={form.priority ?? ''}
                  onChange={(e) =>
                    updateField(
                      'priority',
                      e.target.value === '' ? undefined : Number(e.target.value)
                    )
                  }
                  disabled={mutating}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {descriptor.supportsTestModel ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${fid}-testModel`}>
              {t('providersPage.form.testModel')}
              {brand === 'claude' ? (
                <span className={styles.labelHint}>
                  {' '}
                  · {t('providersPage.form.testModelClaudeHint')}
                </span>
              ) : null}
            </label>
            <input
              id={`${fid}-testModel`}
              className={styles.input}
              value={form.testModel ?? ''}
              onChange={(e) => updateField('testModel', e.target.value)}
              disabled={mutating}
            />
            {brand === 'claude' ? (
              <div className={styles.connectivityRow}>
                <button
                  type="button"
                  className={styles.connectivityBtn}
                  disabled={mutating || connectivity.isTestingAny}
                  onClick={() => void connectivity.runClaude()}
                >
                  {connectivity.claudeStatus.state === 'loading' ? (
                    <span className={`${styles.statusIcon} ${styles.statusIconLoading}`}>
                      <IconLoader2 size={14} />
                    </span>
                  ) : null}
                  <span>{t('providersPage.connectivity.test')}</span>
                </button>
                <ConnectivityStatusIcon state={connectivity.claudeStatus.state} />
                {connectivity.claudeStatus.state === 'success' ? (
                  <span className={styles.connectivityHintSuccess}>
                    {t('providersPage.connectivity.success')}
                  </span>
                ) : null}
              </div>
            ) : null}
            {brand === 'claude' && connectivity.claudeStatus.state === 'error' ? (
              <div className={styles.connectivityError}>
                {connectivity.claudeStatus.message}
              </div>
            ) : null}
          </div>
        ) : null}

        {descriptor.supportsWebsockets ? (
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              className={styles.checkboxBox}
              checked={form.websockets ?? false}
              disabled={mutating}
              onChange={(e) => updateField('websockets', e.target.checked)}
            />
            <span className={styles.checkboxText}>
              <span>{t('providersPage.form.websockets')}</span>
            </span>
          </label>
        ) : null}

        {descriptor.supportsDisabled ? (
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              className={styles.checkboxBox}
              checked={form.disabled}
              disabled={mutating}
              onChange={(e) => updateField('disabled', e.target.checked)}
            />
            <span className={styles.checkboxText}>
              <span>{t('providersPage.form.disabled')}</span>
              <small>{t('providersPage.form.disabledHint')}</small>
            </span>
          </label>
        ) : null}
      </div>

      {/* 高级折叠区 */}
      {descriptor.supportsApiKeyEntries && form.apiKeyEntries ? (
        <Collapsible
          label={t('providersPage.form.apiKeyEntriesSection')}
          hint={`${apiKeyEntries.filter((e) => e.apiKey.trim()).length}`}
          defaultOpen
        >
          <div className={styles.entriesList}>
            <div className={styles.entriesToolbar}>
              <button
                type="button"
                className={styles.connectivityBtn}
                disabled={mutating || connectivity.isTestingAny}
                onClick={() => void connectivity.runOpenAIAllKeys()}
              >
                {connectivity.isTestingAny ? (
                  <span className={`${styles.statusIcon} ${styles.statusIconLoading}`}>
                    <IconLoader2 size={14} />
                  </span>
                ) : null}
                <span>{t('providersPage.connectivity.testAll')}</span>
              </button>
            </div>
            {apiKeyEntries.map((entry, idx) => {
              const status = connectivity.openaiStatuses[idx] ?? {
                state: 'idle' as ConnectivityState,
                message: '',
              };
              return (
                <div key={idx} className={styles.entryCard}>
                  <div className={styles.entryCardHeader}>
                    <span>
                      {t('providersPage.form.apiKeyEntry', { index: idx + 1 })}
                    </span>
                    <div className={styles.entryCardHeaderRight}>
                      <ConnectivityStatusIcon state={status.state} />
                      <button
                        type="button"
                        className={styles.connectivityBtnGhost}
                        disabled={mutating || status.state === 'loading'}
                        onClick={() => void connectivity.runOpenAIKey(idx)}
                      >
                        {status.state === 'loading' ? (
                          <span className={`${styles.statusIcon} ${styles.statusIconLoading}`}>
                            <IconLoader2 size={14} />
                          </span>
                        ) : null}
                        <span>{t('providersPage.connectivity.test')}</span>
                      </button>
                      <button
                        type="button"
                        className={styles.removeBtn}
                        disabled={mutating || apiKeyEntries.length <= 1}
                        onClick={() =>
                          updateField(
                            'apiKeyEntries',
                            apiKeyEntries.filter((_, i) => i !== idx)
                          )
                        }
                      >
                        <IconX size={12} />
                      </button>
                    </div>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>
                      {t('providersPage.form.apiKey')}
                    </label>
                    <input
                      className={styles.input}
                      type="password"
                      value={entry.apiKey}
                      onChange={(e) =>
                        updateField(
                          'apiKeyEntries',
                          apiKeyEntries.map((it, i) =>
                            i === idx ? { ...it, apiKey: e.target.value } : it
                          )
                        )
                      }
                      disabled={mutating}
                      placeholder={t('providersPage.form.apiKeyCreatePlaceholder')}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>
                      {t('providersPage.form.proxyUrl')}
                    </label>
                    <input
                      className={styles.input}
                      value={entry.proxyUrl}
                      onChange={(e) =>
                        updateField(
                          'apiKeyEntries',
                          apiKeyEntries.map((it, i) =>
                            i === idx ? { ...it, proxyUrl: e.target.value } : it
                          )
                        )
                      }
                      disabled={mutating}
                      placeholder="http://127.0.0.1:7890"
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>
                      {t('providersPage.form.headers')}
                      <span className={styles.labelHint}>
                        {' '}
                        · {t('providersPage.form.headersHint')}
                      </span>
                    </label>
                    <textarea
                      className={styles.textarea}
                      value={entry.headersText}
                      rows={3}
                      onChange={(e) =>
                        updateField(
                          'apiKeyEntries',
                          apiKeyEntries.map((it, i) =>
                            i === idx ? { ...it, headersText: e.target.value } : it
                          )
                        )
                      }
                      disabled={mutating}
                      placeholder="X-Custom-Header: value"
                    />
                  </div>
                  {status.state === 'error' ? (
                    <div className={styles.connectivityError}>
                      {status.message}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <button
              type="button"
              className={styles.addBtn}
              disabled={mutating}
              onClick={() =>
                updateField('apiKeyEntries', [...apiKeyEntries, emptyApiKeyEntry()])
              }
            >
              <IconPlus size={12} />
              <span>{t('providersPage.form.addApiKeyEntry')}</span>
            </button>
          </div>
        </Collapsible>
      ) : null}

      {descriptor.supportsHeaders ? (
        <Collapsible label={t('providersPage.form.headersSection')}>
          <div className={styles.entriesList}>
            {headersList.map((entry, idx) => (
              <div
                key={idx}
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}
              >
                <input
                  className={styles.input}
                  placeholder="X-Custom-Header"
                  value={entry.key}
                  onChange={(e) =>
                    updateField(
                      'headers',
                      headersList.map((it, i) =>
                        i === idx ? { ...it, key: e.target.value } : it
                      )
                    )
                  }
                  disabled={mutating}
                />
                <input
                  className={styles.input}
                  placeholder="value"
                  value={entry.value}
                  onChange={(e) =>
                    updateField(
                      'headers',
                      headersList.map((it, i) =>
                        i === idx ? { ...it, value: e.target.value } : it
                      )
                    )
                  }
                  disabled={mutating}
                />
                <button
                  type="button"
                  className={styles.removeBtn}
                  disabled={mutating || headersList.length <= 1}
                  onClick={() =>
                    updateField(
                      'headers',
                      headersList.filter((_, i) => i !== idx)
                    )
                  }
                >
                  <IconX size={12} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.addBtn}
              disabled={mutating}
              onClick={() => updateField('headers', [...headersList, emptyHeader()])}
            >
              <IconPlus size={12} />
              <span>{t('providersPage.form.addHeader')}</span>
            </button>
          </div>
        </Collapsible>
      ) : null}

      {descriptor.supportsModels ? (
        <Collapsible label={t('providersPage.form.modelsSection')}>
          <div className={styles.entriesList}>
            {modelsList.map((entry, idx) => (
              <div
                key={idx}
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8 }}
              >
                <input
                  className={styles.input}
                  placeholder="model-name"
                  value={entry.name}
                  onChange={(e) =>
                    updateField(
                      'models',
                      modelsList.map((it, i) =>
                        i === idx ? { ...it, name: e.target.value } : it
                      )
                    )
                  }
                  disabled={mutating}
                />
                <input
                  className={styles.input}
                  placeholder="alias (optional)"
                  value={entry.alias ?? ''}
                  onChange={(e) =>
                    updateField(
                      'models',
                      modelsList.map((it, i) =>
                        i === idx ? { ...it, alias: e.target.value } : it
                      )
                    )
                  }
                  disabled={mutating}
                />
                <button
                  type="button"
                  className={styles.removeBtn}
                  disabled={mutating || modelsList.length <= 1}
                  onClick={() =>
                    updateField(
                      'models',
                      modelsList.filter((_, i) => i !== idx)
                    )
                  }
                >
                  <IconX size={12} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={styles.addBtn}
              disabled={mutating}
              onClick={() => updateField('models', [...modelsList, emptyModel()])}
            >
              <IconPlus size={12} />
              <span>{t('providersPage.form.addModel')}</span>
            </button>
          </div>
        </Collapsible>
      ) : null}

      {descriptor.supportsExcludedModels ? (
        <Collapsible label={t('providersPage.form.excludedSection')}>
          <div className={styles.field}>
            <span className={styles.labelHint}>
              {t('providersPage.form.excludedHint')}
            </span>
            <textarea
              className={styles.textarea}
              rows={4}
              value={form.excludedModelsText}
              onChange={(e) => updateField('excludedModelsText', e.target.value)}
              disabled={mutating}
              placeholder="model-1&#10;model-2"
            />
          </div>
        </Collapsible>
      ) : null}

      {descriptor.supportsCloak && form.cloak ? (
        <Collapsible label={t('providersPage.form.cloakSection')}>
          <div className={styles.section}>
            <div className={styles.field}>
              <label className={styles.label}>
                {t('providersPage.form.cloakMode')}
              </label>
              <input
                className={styles.input}
                value={form.cloak.mode}
                onChange={(e) => updateCloak('mode', e.target.value)}
                placeholder="auto / always / never"
                disabled={mutating}
              />
            </div>
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                className={styles.checkboxBox}
                checked={form.cloak.strictMode}
                disabled={mutating}
                onChange={(e) => updateCloak('strictMode', e.target.checked)}
              />
              <span className={styles.checkboxText}>
                <span>{t('providersPage.form.cloakStrict')}</span>
              </span>
            </label>
            <div className={styles.field}>
              <label className={styles.label}>
                {t('providersPage.form.cloakSensitiveWords')}
              </label>
              <textarea
                className={styles.textarea}
                rows={3}
                value={form.cloak.sensitiveWordsText}
                onChange={(e) =>
                  updateCloak('sensitiveWordsText', e.target.value)
                }
                disabled={mutating}
              />
            </div>
          </div>
        </Collapsible>
      ) : null}

      {error ? <div className={styles.errorBox}>{error}</div> : null}
    </form>
  );
}
