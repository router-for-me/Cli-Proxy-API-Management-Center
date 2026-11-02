import { useId, useMemo, useState, type ClipboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconKey, IconX } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import type { ProviderBrand, ProviderEntryFormInput } from '../../types';
import {
  applySmartConfigCandidate,
  MAX_SMART_MODELS,
  maskApiKey,
  parseSmartConfig,
  type SmartConfigApplySummary,
  type SmartConfigCandidate,
  type SmartConfigFormat,
  type SmartConfigWarningCode,
} from '../../smartConfig';
import styles from './SmartConfigPanel.module.scss';

const FORMAT_KEYS: Record<SmartConfigFormat, string> = {
  'cc-switch': 'ccSwitch',
  'new-api': 'newApi',
  'claude-code': 'claudeCode',
  openai: 'openai',
  curl: 'curl',
  json: 'json',
  'key-value': 'keyValue',
  text: 'text',
};

interface SmartConfigPanelProps {
  brand: ProviderBrand;
  form: ProviderEntryFormInput;
  mutating: boolean;
  onApply: (next: ProviderEntryFormInput) => void;
}

export function SmartConfigPanel({ brand, form, mutating, onApply }: SmartConfigPanelProps) {
  const { t } = useTranslation();
  const fid = useId();
  const [text, setText] = useState('');
  const [selected, setSelected] = useState(0);
  const [summary, setSummary] = useState<SmartConfigApplySummary | null>(null);

  const result = useMemo(() => parseSmartConfig(text), [text]);
  const candidates = result?.candidates ?? [];
  const activeIndex = Math.min(selected, Math.max(0, candidates.length - 1));
  const candidate = candidates[activeIndex] ?? null;

  const formatLabel = result
    ? t(`providersPage.smartConfig.format.${FORMAT_KEYS[result.format]}`)
    : '';

  const applyCandidate = (target: SmartConfigCandidate) => {
    const applied = applySmartConfigCandidate(brand, form, target);
    onApply(applied.next);
    setSummary(applied.summary);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (mutating) return;
    const pasted = event.clipboardData?.getData('text') ?? '';
    if (!pasted.trim()) return;
    // Auto-fill only when the paste contains exactly one unambiguous config.
    // Exports with several providers stay manual so the wrong one is not applied.
    const parsed = parseSmartConfig(pasted);
    if (!parsed || parsed.candidates.length !== 1) return;
    const only = parsed.candidates[0];
    if (!only.baseUrl && only.apiKeys.length === 0) return;
    applyCandidate(only);
  };

  const handleClear = () => {
    setText('');
    setSelected(0);
    setSummary(null);
  };

  const warningText = (code: SmartConfigWarningCode): string => {
    if (code === 'modelsTruncated') {
      return t('providersPage.smartConfig.warnings.modelsTruncated', { count: MAX_SMART_MODELS });
    }
    return t(`providersPage.smartConfig.warnings.${code}`);
  };

  const candidateLabel = (item: SmartConfigCandidate, index: number): string => {
    if (item.name) return item.name;
    if (item.baseUrl) return item.baseUrl;
    return t('providersPage.smartConfig.candidate', { index: index + 1 });
  };

  const appliedCount = summary
    ? (summary.baseUrl ? 1 : 0) +
      summary.apiKeys +
      summary.models +
      (summary.name ? 1 : 0) +
      (summary.prefix ? 1 : 0)
    : 0;

  return (
    <div className={styles.panel}>
      <p className={styles.description}>{t('providersPage.smartConfig.description')}</p>

      <label className={styles.label} htmlFor={`${fid}-text`}>
        {t('providersPage.smartConfig.inputLabel')}
      </label>
      <textarea
        id={`${fid}-text`}
        className={styles.textarea}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setSummary(null);
          setSelected(0);
        }}
        onPaste={handlePaste}
        placeholder={t('providersPage.smartConfig.placeholder')}
        spellCheck={false}
        disabled={mutating}
      />

      {candidates.length > 1 ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${fid}-candidate`}>
            {t('providersPage.smartConfig.multiple', { count: candidates.length })}
          </label>
          <Select
            id={`${fid}-candidate`}
            value={String(activeIndex)}
            options={candidates.map((item, index) => ({
              value: String(index),
              label: candidateLabel(item, index),
            }))}
            onChange={(value) => {
              setSelected(Number(value));
              setSummary(null);
            }}
            disabled={mutating}
            ariaLabel={t('providersPage.smartConfig.candidateSelect')}
          />
        </div>
      ) : null}

      {candidate ? (
        <div className={styles.preview}>
          <div className={styles.previewHeader}>
            <IconKey size={14} />
            <span className={styles.formatBadge}>{formatLabel}</span>
          </div>
          <dl className={styles.previewList}>
            <div className={styles.previewRow}>
              <dt>{t('providersPage.smartConfig.baseUrl')}</dt>
              <dd className={styles.previewValue}>
                {candidate.baseUrl ?? t('providersPage.smartConfig.notFound')}
              </dd>
            </div>
            <div className={styles.previewRow}>
              <dt>{t('providersPage.smartConfig.apiKey')}</dt>
              <dd className={styles.previewValue}>
                {candidate.apiKeys.length
                  ? candidate.apiKeys.map((key) => maskApiKey(key)).join('  ')
                  : t('providersPage.smartConfig.notFound')}
              </dd>
            </div>
            {candidate.models.length ? (
              <div className={styles.previewRow}>
                <dt>{t('providersPage.smartConfig.models')}</dt>
                <dd className={styles.previewValue}>
                  {t('providersPage.smartConfig.modelsDetected', { count: candidate.models.length })}
                  <span className={styles.previewMuted}>
                    {' · '}
                    {candidate.models.slice(0, 3).join(', ')}
                    {candidate.models.length > 3 ? ' …' : ''}
                  </span>
                </dd>
              </div>
            ) : null}
            {candidate.name ? (
              <div className={styles.previewRow}>
                <dt>{t('providersPage.smartConfig.name')}</dt>
                <dd className={styles.previewValue}>{candidate.name}</dd>
              </div>
            ) : null}
            {candidate.prefix ? (
              <div className={styles.previewRow}>
                <dt>{t('providersPage.smartConfig.prefix')}</dt>
                <dd className={styles.previewValue}>{candidate.prefix}</dd>
              </div>
            ) : null}
          </dl>
          {candidate.warnings.map((code) => (
            <p key={code} className={styles.warning}>
              {warningText(code)}
            </p>
          ))}
        </div>
      ) : text.trim() ? (
        <p className={styles.warning}>{t('providersPage.smartConfig.noMatch')}</p>
      ) : null}

      {summary ? (
        <p className={styles.success}>
          <IconCheck size={14} />
          <span>{t('providersPage.smartConfig.applied', { count: appliedCount })}</span>
        </p>
      ) : null}
      {summary && summary.extraApiKeys > 0 ? (
        <p className={styles.warning}>
          {t('providersPage.smartConfig.extraKeysIgnored', { count: summary.extraApiKeys })}
        </p>
      ) : null}
      {summary && summary.models === 0 && candidate && candidate.models.length ? (
        <p className={styles.hint}>{t('providersPage.smartConfig.modelsKept')}</p>
      ) : null}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.applyBtn}
          onClick={() => candidate && applyCandidate(candidate)}
          disabled={mutating || !candidate}
        >
          <IconKey size={14} />
          <span>{t('providersPage.smartConfig.apply')}</span>
        </button>
        <button
          type="button"
          className={styles.clearBtn}
          onClick={handleClear}
          disabled={mutating || !text}
        >
          <IconX size={12} />
          <span>{t('providersPage.smartConfig.clear')}</span>
        </button>
      </div>
    </div>
  );
}
