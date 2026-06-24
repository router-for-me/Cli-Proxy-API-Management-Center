import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import { Select } from '@/components/ui/Select';
import {
  IconAlertTriangle,
  IconChevronDown,
  IconCheckCircle2,
  IconDollarSign,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconLoader2,
  IconPlus,
  IconX,
} from '@/components/ui/icons';
import { hasDisableAllModelsRule } from '@/components/providers/utils';
import { maskApiKey } from '@/utils/format';
import type { ModelInfo } from '@/utils/models';
import {
  APIKEY_FUN_BASE_URL_OPTIONS,
  getApiKeyFunProtocolUrls,
  type ApiKeyFunUsageSummary,
  resolveApiKeyFunBaseUrl,
} from '../../sponsor';
import type {
  ModelEntryInput,
  ProviderBrand,
  ProviderEntryFormInput,
  ProviderResource,
  SponsorKeyEntryInput,
  SponsorProtocol,
  SponsorProviderRaw,
} from '../../types';
import { ModelDiscoveryPanel } from './ModelDiscoveryPanel';
import { useModelDiscovery, type UseModelDiscoveryResult } from './useModelDiscovery';
import { useSponsorUsageCheck, type SponsorUsageMessages } from './useSponsorUsageCheck';
import styles from './sharedForm.module.scss';

interface SponsorProviderFormProps {
  resource: ProviderResource | null;
  mode: 'create' | 'edit';
  mutating: boolean;
  formId: string;
  variant?: 'quickStart';
  onSubmit: (input: ProviderEntryFormInput) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

interface SponsorModelSectionProps {
  label: string;
  description: string;
  models: ModelEntryInput[];
  discovery: UseModelDiscoveryResult;
  mutating: boolean;
  onChange: (next: ModelEntryInput[]) => void;
}

interface SponsorKeyEntryCardProps {
  entry: SponsorKeyEntryInput;
  index: number;
  formId: string;
  mode: 'create' | 'edit';
  usedProtocols: Set<SponsorProtocol>;
  canRemove: boolean;
  mutating: boolean;
  onChange: (entry: SponsorKeyEntryInput) => void;
  onRemove: () => void;
}

const SPONSOR_PROTOCOLS: SponsorProtocol[] = ['codex', 'claude', 'openai'];

const emptyModel = (): ModelEntryInput => ({ name: '', alias: '' });

const emptySponsorKeyEntry = (protocol: SponsorProtocol = 'codex'): SponsorKeyEntryInput => ({
  protocol,
  apiKey: '',
  existingApiKey: '',
  baseUrl: APIKEY_FUN_BASE_URL_OPTIONS[0].baseUrl,
  proxyUrl: '',
  prefix: '',
  disabled: false,
  disableCooling: false,
  priority: undefined,
  models: [emptyModel()],
});

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
  sponsorKeyEntries: [emptySponsorKeyEntry()],
});

const getSponsorRaw = (resource: ProviderResource | null): SponsorProviderRaw | null => {
  if (!resource || resource.brand !== 'apikeyFun') return null;
  return resource.raw as SponsorProviderRaw;
};

const protocolI18nKey = (protocol: SponsorProtocol): 'openai' | 'codexResponses' | 'anthropic' => {
  if (protocol === 'claude') return 'anthropic';
  if (protocol === 'codex') return 'codexResponses';
  return 'openai';
};

const protocolModelI18nKey = (protocol: SponsorProtocol): 'openai' | 'codex' | 'anthropic' => {
  if (protocol === 'claude') return 'anthropic';
  return protocol;
};

const discoveryBrandForProtocol = (protocol: SponsorProtocol): ProviderBrand =>
  protocol === 'openai' ? 'openaiCompatibility' : protocol;

const protocolUrlForEntry = (entry: SponsorKeyEntryInput): string => {
  const urls = getApiKeyFunProtocolUrls(entry.baseUrl);
  if (entry.protocol === 'claude') return urls.anthropic;
  if (entry.protocol === 'codex') return urls.codex;
  return urls.openai;
};

const formatUsageAmount = (
  value: ApiKeyFunUsageSummary['remaining'],
  locale: string
): string => {
  if (value === null) return '--';
  if (typeof value === 'number') {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: 6,
    }).format(value);
  }
  return value;
};

const isHealthyUsageSummary = (summary: ApiKeyFunUsageSummary): boolean => {
  const normalizedStatus = (summary.status ?? '').trim().toLowerCase();
  return summary.isValid && (!normalizedStatus || normalizedStatus === 'active');
};

const modelsFromConfig = (
  models:
    | Array<{ name?: string; alias?: string; priority?: number; testModel?: string }>
    | undefined
): ModelEntryInput[] =>
  models?.length
    ? models.map((model) => ({
        name: model.name ?? '',
        alias: model.alias ?? '',
        priority: model.priority,
        testModel: model.testModel,
      }))
    : [emptyModel()];

const sponsorEntryFromProviderKey = (
  protocol: 'codex' | 'claude',
  config: SponsorProviderRaw[typeof protocol][number]['config']
): SponsorKeyEntryInput => ({
  ...emptySponsorKeyEntry(protocol),
  existingApiKey: config.apiKey ?? '',
  baseUrl: resolveApiKeyFunBaseUrl(config.baseUrl),
  proxyUrl: config.proxyUrl ?? '',
  prefix: config.prefix ?? '',
  disabled: hasDisableAllModelsRule(config.excludedModels),
  disableCooling: config.disableCooling === true,
  priority: config.priority,
  models: modelsFromConfig(config.models),
});

const sponsorEntryFromOpenAI = (
  config: SponsorProviderRaw['openai'][number]['config']
): SponsorKeyEntryInput => {
  const firstEntry = config.apiKeyEntries?.find((entry) => entry.apiKey?.trim());
  return {
    ...emptySponsorKeyEntry('openai'),
    existingApiKey: firstEntry?.apiKey ?? '',
    baseUrl: resolveApiKeyFunBaseUrl(config.baseUrl),
    proxyUrl: firstEntry?.proxyUrl ?? '',
    prefix: config.prefix ?? '',
    disabled: config.disabled === true,
    disableCooling: config.disableCooling === true,
    priority: config.priority,
    models: modelsFromConfig(config.models),
  };
};

const sponsorKeyEntriesFromRaw = (raw: SponsorProviderRaw | null): SponsorKeyEntryInput[] => {
  if (!raw) return [emptySponsorKeyEntry()];
  const entries: SponsorKeyEntryInput[] = [];
  const codex = raw.codex[0]?.config;
  const claude = raw.claude[0]?.config;
  const openai = raw.openai[0]?.config;
  if (codex) entries.push(sponsorEntryFromProviderKey('codex', codex));
  if (claude) entries.push(sponsorEntryFromProviderKey('claude', claude));
  if (openai) entries.push(sponsorEntryFromOpenAI(openai));
  return entries.length ? entries : [emptySponsorKeyEntry()];
};

const applyDiscoveredModels = (
  currentModels: ModelEntryInput[],
  incoming: ModelInfo[]
): ModelEntryInput[] => {
  if (!incoming.length) return currentModels;
  const seen = new Set<string>();
  const next: ModelEntryInput[] = [];
  currentModels.forEach((entry) => {
    const trimmed = (entry.name ?? '').trim();
    if (trimmed) {
      if (seen.has(trimmed)) return;
      seen.add(trimmed);
    }
    next.push(entry);
  });
  const placeholderIdx = next.findIndex(
    (entry) => !(entry.name ?? '').trim() && !(entry.alias ?? '').trim()
  );
  if (placeholderIdx !== -1) {
    next.splice(placeholderIdx, 1);
  }
  incoming.forEach((info) => {
    const trimmed = info.name.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    next.push({
      name: trimmed,
      alias: (info.alias ?? '').trim(),
    });
  });
  return next.length ? next : [emptyModel()];
};

function SponsorModelSection({
  label,
  description,
  models,
  discovery,
  mutating,
  onChange,
}: SponsorModelSectionProps) {
  const { t } = useTranslation();
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const modelsList = useMemo(() => (models.length ? models : [emptyModel()]), [models]);
  const existingModelNames = useMemo(() => {
    const set = new Set<string>();
    modelsList.forEach((model) => {
      const name = (model.name ?? '').trim();
      if (name) set.add(name);
    });
    return set;
  }, [modelsList]);

  const openDiscovery = () => {
    setDiscoveryOpen(true);
    if (!discovery.loading && !discovery.hasFetched) {
      void discovery.fetch();
    }
  };

  const updateModelEntry = (modelIndex: number, patch: Partial<ModelEntryInput>) => {
    onChange(
      modelsList.map((item, itemIndex) => (itemIndex === modelIndex ? { ...item, ...patch } : item))
    );
  };

  const removeModelEntry = (modelIndex: number) => {
    const next = modelsList.filter((_, itemIndex) => itemIndex !== modelIndex);
    onChange(next.length ? next : [emptyModel()]);
  };

  return (
    <Collapsible label={label}>
      <div className={styles.entriesList}>
        <p className={styles.sectionDesc}>{description}</p>
        <div className={styles.entriesToolbar}>
          <button
            type="button"
            className={styles.connectivityBtn}
            onClick={openDiscovery}
            disabled={mutating}
          >
            <IconDownload size={14} />
            <span>{t('providersPage.discovery.openButton')}</span>
          </button>
        </div>
        {discoveryOpen ? (
          <ModelDiscoveryPanel
            loading={discovery.loading}
            error={discovery.error}
            models={discovery.models}
            hasFetched={discovery.hasFetched}
            existingNames={existingModelNames}
            mutating={mutating}
            onApply={(picked) => onChange(applyDiscoveredModels(modelsList, picked))}
            onReload={() => void discovery.fetch()}
            onClose={() => setDiscoveryOpen(false)}
          />
        ) : null}
        {modelsList.map((entry, modelIndex) => (
          <div key={modelIndex} className={styles.modelAliasRow}>
            <input
              className={styles.input}
              placeholder="model-name"
              value={entry.name}
              onChange={(event) => updateModelEntry(modelIndex, { name: event.target.value })}
              disabled={mutating}
            />
            <input
              className={styles.input}
              placeholder="alias (optional)"
              value={entry.alias ?? ''}
              onChange={(event) => updateModelEntry(modelIndex, { alias: event.target.value })}
              disabled={mutating}
            />
            <button
              type="button"
              className={styles.removeBtn}
              disabled={mutating || modelsList.length <= 1}
              onClick={() => removeModelEntry(modelIndex)}
            >
              <IconX size={12} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className={styles.addBtn}
          disabled={mutating}
          onClick={() => onChange([...modelsList, emptyModel()])}
        >
          <IconPlus size={12} />
          <span>{t('providersPage.form.addModel')}</span>
        </button>
      </div>
    </Collapsible>
  );
}

function SponsorKeyEntryCard({
  entry,
  index,
  formId,
  mode,
  usedProtocols,
  canRemove,
  mutating,
  onChange,
  onRemove,
}: SponsorKeyEntryCardProps) {
  const { t, i18n } = useTranslation();
  const [showApiKey, setShowApiKey] = useState(false);
  const [expanded, setExpanded] = useState(
    () => mode === 'create' || !entry.existingApiKey?.trim()
  );
  const endpointUrl = protocolUrlForEntry(entry);
  const protocolLabel = t(`providersPage.sponsor.protocols.${protocolI18nKey(entry.protocol)}`);
  const titleLabel = t('providersPage.sponsor.groupedKey', { index: index + 1 });
  const summaryKey = entry.apiKey.trim() || entry.existingApiKey?.trim() || '';
  const summaryKeyLabel = summaryKey
    ? maskApiKey(summaryKey)
    : t('providersPage.status.notConfigured');
  const modelKey = protocolModelI18nKey(entry.protocol);
  const usageMessages = useMemo<SponsorUsageMessages>(
    () => ({
      apiKeyRequired: t('providersPage.sponsor.usageApiKeyRequired'),
      emptyResponse: t('providersPage.sponsor.usageEmpty'),
      requestFailed: t('providersPage.connectivity.requestFailed'),
    }),
    [t]
  );
  const usageCheck = useSponsorUsageCheck(
    {
      baseUrl: entry.baseUrl,
      apiKey: entry.apiKey,
      fallbackApiKey: entry.existingApiKey,
    },
    usageMessages
  );
  const usageSummary = usageCheck.status.summary;
  const usageHealthy = usageSummary ? isHealthyUsageSummary(usageSummary) : true;
  const usageRemaining =
    usageSummary !== null ? formatUsageAmount(usageSummary.remaining, i18n.language) : '';
  const usageUsed =
    usageSummary !== null ? formatUsageAmount(usageSummary.used, i18n.language) : '';
  const usageLimit =
    usageSummary !== null ? formatUsageAmount(usageSummary.limit, i18n.language) : '';
  const discoveryHeaders = useMemo<Array<{ key: string; value: string }>>(() => [], []);
  const openaiDiscoveryEntries = useMemo(
    () => [
      {
        apiKey: entry.apiKey,
        existingApiKey: entry.existingApiKey,
        proxyUrl: entry.proxyUrl,
      },
    ],
    [entry.apiKey, entry.existingApiKey, entry.proxyUrl]
  );
  const discovery = useModelDiscovery({
    brand: discoveryBrandForProtocol(entry.protocol),
    baseUrl: endpointUrl,
    formHeaders: discoveryHeaders,
    apiKey: entry.apiKey,
    fallbackApiKey: entry.existingApiKey,
    apiKeyEntries: entry.protocol === 'openai' ? openaiDiscoveryEntries : undefined,
  });
  const protocolOptions = SPONSOR_PROTOCOLS.filter(
    (protocol) => protocol === entry.protocol || !usedProtocols.has(protocol)
  ).map((protocol) => ({
    value: protocol,
    label: t(`providersPage.sponsor.protocols.${protocolI18nKey(protocol)}`),
  }));

  const updateEntry = (patch: Partial<SponsorKeyEntryInput>) => {
    onChange({ ...entry, ...patch });
  };

  return (
    <div className={styles.entryCard}>
      <div className={styles.entryCardHeader}>
        <button
          type="button"
          className={styles.entryCardToggle}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className={styles.sponsorGroupTitle}>
            <span>{titleLabel}</span>
            <strong>{protocolLabel}</strong>
          </span>
          <span className={styles.sponsorGroupSummary}>
            <span className={styles.sponsorSummaryKey}>{summaryKeyLabel}</span>
            <span className={styles.sponsorSummaryUrl}>{endpointUrl}</span>
          </span>
        </button>
        <div className={styles.entryCardHeaderRight}>
          <button
            type="button"
            className={styles.entryCardIconBtn}
            onClick={() => setExpanded((value) => !value)}
            title={expanded ? t('common.collapse') : t('common.expand')}
            aria-label={expanded ? t('common.collapse') : t('common.expand')}
          >
            <IconChevronDown
              className={[
                styles.entryCardChevron,
                expanded ? styles.entryCardChevronOpen : '',
              ]
                .filter(Boolean)
                .join(' ')}
              size={14}
            />
          </button>
          <button
            type="button"
            className={styles.removeBtn}
            onClick={onRemove}
            disabled={mutating || !canRemove}
            title={t('providersPage.sponsor.removeGroupedKey')}
            aria-label={t('providersPage.sponsor.removeGroupedKey')}
          >
            <IconX size={12} />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className={styles.entryCardBody}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${formId}-group-${index}-protocol`}>
              {t('providersPage.sponsor.protocol')}
            </label>
            <Select
              id={`${formId}-group-${index}-protocol`}
              value={entry.protocol}
              options={protocolOptions}
              onChange={(value) =>
                updateEntry({ protocol: value as SponsorProtocol, models: [emptyModel()] })
              }
              disabled={mutating}
              ariaLabel={t('providersPage.sponsor.protocol')}
            />
            <span className={styles.labelHint}>{t('providersPage.sponsor.protocolHint')}</span>
          </div>

          <div className={styles.field}>
            <span className={styles.label}>{t('providersPage.sponsor.urlMode')}</span>
            <div className={styles.sponsorUrlOptions} role="radiogroup">
              {APIKEY_FUN_BASE_URL_OPTIONS.map((option) => {
                const checked = resolveApiKeyFunBaseUrl(entry.baseUrl) === option.baseUrl;
                const className = [
                  styles.sponsorUrlOption,
                  checked ? styles.sponsorUrlOptionActive : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <label key={option.id} className={className}>
                    <input
                      type="radio"
                      name={`${formId}-group-${index}-base-url`}
                      value={option.baseUrl}
                      checked={checked}
                      onChange={() => updateEntry({ baseUrl: option.baseUrl })}
                      disabled={mutating}
                    />
                    <span className={styles.sponsorUrlOptionText}>
                      <span>{t(`providersPage.sponsor.urlOptions.${option.id}`)}</span>
                      <small>{option.baseUrl}</small>
                    </span>
                  </label>
                );
              })}
            </div>
            <span className={styles.labelHint}>{t('providersPage.sponsor.urlHint')}</span>
          </div>

          <div className={styles.sponsorProtocolCard}>
            <span className={styles.sponsorProtocolName}>
              {t('providersPage.sponsor.protocolEndpoint')}
            </span>
            <span className={styles.sponsorProtocolUrl}>{endpointUrl}</span>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${formId}-group-${index}-api-key`}>
              {t('providersPage.form.apiKey')}
            </label>
            <div className={styles.passwordField}>
              <input
                id={`${formId}-group-${index}-api-key`}
                className={styles.passwordInput}
                type={showApiKey ? 'text' : 'password'}
                value={entry.apiKey}
                onChange={(event) => updateEntry({ apiKey: event.target.value })}
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

          <div className={styles.sponsorUsageSection}>
            <button
              type="button"
              className={styles.connectivityBtn}
              onClick={() => void usageCheck.run()}
              disabled={mutating || usageCheck.isLoading}
            >
              {usageCheck.isLoading ? (
                <IconLoader2 className={styles.statusIconLoading} size={14} />
              ) : (
                <IconDollarSign size={14} />
              )}
              <span>
                {usageCheck.isLoading
                  ? t('providersPage.sponsor.usageChecking')
                  : t('providersPage.sponsor.usageCheck')}
              </span>
            </button>
            {usageCheck.status.state === 'success' && usageSummary ? (
              <div
                className={[
                  styles.sponsorUsageResult,
                  usageHealthy ? '' : styles.sponsorUsageResultWarning,
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className={styles.sponsorUsageMain}>
                  {usageHealthy ? (
                    <IconCheckCircle2
                      className={`${styles.statusIcon} ${styles.statusIconSuccess}`}
                      size={14}
                    />
                  ) : (
                    <IconAlertTriangle
                      className={`${styles.statusIcon} ${styles.statusIconError}`}
                      size={14}
                    />
                  )}
                  <span>
                    {t('providersPage.sponsor.usageRemaining', {
                      amount: usageRemaining,
                      unit: usageSummary.unit,
                    })}
                  </span>
                </div>
                {usageSummary.used !== null || usageSummary.limit !== null ? (
                  <span className={styles.sponsorUsageMeta}>
                    {t('providersPage.sponsor.usageBreakdown', {
                      used: usageUsed,
                      limit: usageLimit,
                    })}
                  </span>
                ) : null}
                {!usageHealthy ? (
                  <span className={styles.sponsorUsageMeta}>
                    {t('providersPage.sponsor.usageStatus', {
                      status: usageSummary.status || t('providersPage.sponsor.usageInvalid'),
                    })}
                  </span>
                ) : null}
              </div>
            ) : null}
            {usageCheck.status.state === 'error' ? (
              <div className={styles.connectivityError}>{usageCheck.status.message}</div>
            ) : null}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${formId}-group-${index}-proxy`}>
              {t('providersPage.form.proxyUrl')}
            </label>
            <input
              id={`${formId}-group-${index}-proxy`}
              className={styles.input}
              value={entry.proxyUrl}
              onChange={(event) => updateEntry({ proxyUrl: event.target.value })}
              placeholder="http://127.0.0.1:7890"
              disabled={mutating}
            />
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${formId}-group-${index}-prefix`}>
                {t('providersPage.form.prefix')}
              </label>
              <input
                id={`${formId}-group-${index}-prefix`}
                className={styles.input}
                value={entry.prefix}
                onChange={(event) => updateEntry({ prefix: event.target.value })}
                disabled={mutating}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${formId}-group-${index}-priority`}>
                {t('providersPage.form.priority')}
              </label>
              <input
                id={`${formId}-group-${index}-priority`}
                type="number"
                className={styles.input}
                value={entry.priority ?? ''}
                onChange={(event) =>
                  updateEntry({
                    priority: event.target.value === '' ? undefined : Number(event.target.value),
                  })
                }
                disabled={mutating}
              />
            </div>
          </div>

          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              className={styles.checkboxBox}
              checked={entry.disabled}
              disabled={mutating}
              onChange={(event) => updateEntry({ disabled: event.target.checked })}
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
              checked={entry.disableCooling ?? false}
              disabled={mutating}
              onChange={(event) => updateEntry({ disableCooling: event.target.checked })}
            />
            <span className={styles.checkboxText}>
              <span>{t('providersPage.form.disableCooling')}</span>
              <small>{t('providersPage.form.disableCoolingHint')}</small>
            </span>
          </label>

          <SponsorModelSection
            label={t(`providersPage.sponsor.protocolModels.${modelKey}`)}
            description={t(`providersPage.sponsor.protocolModelHints.${modelKey}`)}
            models={entry.models}
            discovery={discovery}
            mutating={mutating}
            onChange={(models) => updateEntry({ models })}
          />
        </div>
      ) : null}
    </div>
  );
}

const buildInitialForm = (
  resource: ProviderResource | null,
  mode: 'create' | 'edit'
): ProviderEntryFormInput => {
  if (mode === 'create') return emptySponsorForm();
  const raw = getSponsorRaw(resource);
  return {
    ...emptySponsorForm(),
    sponsorKeyEntries: sponsorKeyEntriesFromRaw(raw),
  };
};

export function SponsorProviderForm({
  resource,
  mode,
  mutating,
  formId,
  variant,
  onSubmit,
  onDirtyChange,
}: SponsorProviderFormProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ProviderEntryFormInput>(() => buildInitialForm(resource, mode));
  const [initialFormSignature] = useState<string>(() =>
    JSON.stringify(buildInitialForm(resource, mode))
  );
  const [error, setError] = useState<string | null>(null);
  const entries = useMemo(
    () => form.sponsorKeyEntries ?? [emptySponsorKeyEntry()],
    [form.sponsorKeyEntries]
  );
  const usedProtocols = useMemo(() => new Set(entries.map((entry) => entry.protocol)), [entries]);
  const missingProtocols = useMemo(
    () => SPONSOR_PROTOCOLS.filter((protocol) => !usedProtocols.has(protocol)),
    [usedProtocols]
  );

  const isDirty = useMemo(
    () => JSON.stringify({ ...form, sponsorKeyEntries: entries }) !== initialFormSignature,
    [entries, form, initialFormSignature]
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const updateEntries = (nextEntries: SponsorKeyEntryInput[]) => {
    setForm((prev) => ({ ...prev, sponsorKeyEntries: nextEntries }));
  };

  const updateEntry = (entryIndex: number, nextEntry: SponsorKeyEntryInput) => {
    updateEntries(entries.map((entry, index) => (index === entryIndex ? nextEntry : entry)));
  };

  const removeEntry = (entryIndex: number) => {
    const nextEntries = entries.filter((_, index) => index !== entryIndex);
    updateEntries(nextEntries.length || mode === 'edit' ? nextEntries : [emptySponsorKeyEntry()]);
  };

  const addEntry = () => {
    const protocol = missingProtocols[0];
    if (!protocol) return;
    updateEntries([...entries, emptySponsorKeyEntry(protocol)]);
  };

  const validateEntries = (): string | null => {
    if (!entries.length) {
      return mode === 'edit' ? null : t('providersPage.sponsor.validation.keyRequired');
    }
    const missingKey = entries.some(
      (entry) => !entry.apiKey.trim() && !entry.existingApiKey?.trim()
    );
    if (missingKey) return t('providersPage.sponsor.validation.keyRequired');
    const protocolSet = new Set(entries.map((entry) => entry.protocol));
    if (protocolSet.size !== entries.length) {
      return t('providersPage.sponsor.validation.protocolDuplicate');
    }
    return null;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = validateEntries();
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      setError(null);
      await onSubmit({ ...form, sponsorKeyEntries: entries });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const formClassName = [styles.form, variant === 'quickStart' ? styles.quickStartForm : '']
    .filter(Boolean)
    .join(' ');

  return (
    <form id={formId} className={formClassName} onSubmit={handleSubmit} noValidate>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t('providersPage.sponsor.groupedKeysTitle')}</h3>
        {entries.map((entry, index) => (
          <SponsorKeyEntryCard
            key={`${entry.protocol}-${index}`}
            entry={entry}
            index={index}
            formId={formId}
            mode={mode}
            usedProtocols={usedProtocols}
            canRemove={mode === 'edit' || entries.length > 1}
            mutating={mutating}
            onChange={(nextEntry) => updateEntry(index, nextEntry)}
            onRemove={() => removeEntry(index)}
          />
        ))}
        <button
          type="button"
          className={styles.addBtn}
          disabled={mutating || !missingProtocols.length}
          onClick={addEntry}
        >
          <IconPlus size={12} />
          <span>{t('providersPage.sponsor.addGroupedKey')}</span>
        </button>
      </div>

      {error ? <div className={styles.errorBox}>{error}</div> : null}
    </form>
  );
}
