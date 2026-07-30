import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, type SelectOption } from '@/components/ui/Select';
import { IconX } from '@/components/ui/icons';
import { authFilesApi } from '@/services/api';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import {
  isModelExcludedByWildcard,
  parseExcludedModelRules,
  replaceCustomExcludedModelRules,
  splitExcludedModelRules,
  toggleExcludedModel,
} from '@/features/authFiles/excludedModelSelection';
import styles from './AuthFileDetailsSheet.module.scss';

interface AuthFileExcludedModelsFieldProps {
  fileName: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

const modelOptionLabel = (model: AuthFileModelItem): string => {
  const displayName = model.display_name?.trim();
  return displayName && displayName !== model.id ? `${model.id} — ${displayName}` : model.id;
};

export function AuthFileExcludedModelsField({
  fileName,
  value,
  disabled,
  onChange,
}: AuthFileExcludedModelsFieldProps) {
  const { t } = useTranslation();
  const latestValueRef = useRef(value);
  const [models, setModels] = useState<AuthFileModelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    let cancelled = false;
    setModels([]);
    setLoading(true);
    setLoadFailed(false);

    void authFilesApi
      .getModelsForAuthFile(fileName)
      .then((items) => {
        if (cancelled) return;
        const byId = new Map<string, AuthFileModelItem>();
        items.forEach((item) => {
          const id = item.id?.trim();
          if (id) byId.set(id.toLowerCase(), { ...item, id });
        });
        parseExcludedModelRules(latestValueRef.current).forEach((rule) => {
          if (!rule.includes('*') && !byId.has(rule.toLowerCase())) {
            byId.set(rule.toLowerCase(), { id: rule });
          }
        });
        setModels(
          [...byId.values()].sort((left, right) =>
            left.id.localeCompare(right.id, undefined, { sensitivity: 'base' })
          )
        );
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fileName]);

  const rules = useMemo(() => parseExcludedModelRules(value), [value]);
  const candidateIds = useMemo(() => models.map((model) => model.id), [models]);
  const { selectedIds, customRules } = useMemo(
    () => splitExcludedModelRules(rules, candidateIds),
    [candidateIds, rules]
  );
  const selectedKeys = useMemo(
    () => new Set(selectedIds.map((id) => id.toLowerCase())),
    [selectedIds]
  );
  const availableOptions = useMemo<SelectOption[]>(
    () =>
      models
        .filter(
          (model) =>
            !selectedKeys.has(model.id.toLowerCase()) &&
            !isModelExcludedByWildcard(customRules, model.id)
        )
        .map((model) => ({ value: model.id, label: modelOptionLabel(model) })),
    [customRules, models, selectedKeys]
  );

  const commitRules = (nextRules: string[]) => onChange(nextRules.join('\n'));

  return (
    <div className="form-group">
      <label>{t('auth_files.excluded_models_label')}</label>
      <Select
        value=""
        options={availableOptions}
        onChange={(modelId) => commitRules(toggleExcludedModel(rules, modelId, true))}
        placeholder={
          loading
            ? t('auth_files.excluded_models_loading')
            : t('auth_files.excluded_models_select', { count: selectedIds.length })
        }
        ariaLabel={t('auth_files.excluded_models_select_label')}
        disabled={disabled || loading || availableOptions.length === 0}
      />

      {selectedIds.length > 0 ? (
        <div className={styles.excludedModelChips}>
          {selectedIds.map((modelId) => (
            <span key={modelId.toLowerCase()} className={styles.excludedModelChip}>
              <span>{modelId}</span>
              <button
                type="button"
                onClick={() => commitRules(toggleExcludedModel(rules, modelId, false))}
                disabled={disabled}
                aria-label={t('auth_files.excluded_models_remove', { model: modelId })}
              >
                <IconX size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <label className={styles.excludedRulesLabel}>
        {t('auth_files.excluded_models_custom_label')}
      </label>
      <textarea
        className="input"
        value={customRules.join('\n')}
        placeholder={t('auth_files.excluded_models_custom_placeholder')}
        rows={3}
        disabled={disabled}
        onChange={(event) =>
          commitRules(replaceCustomExcludedModelRules(rules, candidateIds, event.target.value))
        }
      />
      <div className="hint">
        {loadFailed
          ? t('auth_files.excluded_models_load_failed')
          : t('auth_files.excluded_models_hint')}
      </div>
    </div>
  );
}
