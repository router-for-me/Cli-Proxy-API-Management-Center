import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Collapsible } from '@/components/ui/Collapsible';
import type { RuntimePolicyDraft } from '../../runtimePolicy';
import { ErrorRulesEditor } from './ErrorRulesEditor';
import styles from './sharedForm.module.scss';

export interface RuntimePolicyEditorProps {
  value: RuntimePolicyDraft;
  onChange: (value: RuntimePolicyDraft) => void;
  disabled: boolean;
  supportsErrors?: boolean;
}

export function RuntimePolicyEditor({
  value,
  onChange,
  disabled,
  supportsErrors = true,
}: RuntimePolicyEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const key = 'providersPage.runtimePolicy';

  return (
    <Collapsible label={t(`${key}.title`)} aria-describedby={`${id}-description`}>
      <div className={styles.section}>
        <p id={`${id}-description`} className={styles.sectionDesc}>
          {t(`${key}.description`)}
        </p>
        <div className={styles.field}>
          <label htmlFor={`${id}-cooling`} className={styles.label}>
            {t(`${key}.cooling`)}
          </label>
          <select
            id={`${id}-cooling`}
            className={styles.input}
            value={value.cooling}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, cooling: event.target.value as RuntimePolicyDraft['cooling'] })
            }
          >
            <option value="inherit">{t(`${key}.inherit`)}</option>
            <option value="enabled">{t(`${key}.coolingEnabled`)}</option>
            <option value="disabled">{t(`${key}.coolingDisabled`)}</option>
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-retry`} className={styles.label}>
            {t(`${key}.retry`)}
          </label>
          <input
            id={`${id}-retry`}
            className={styles.input}
            type="text"
            value={value.retry}
            disabled={disabled}
            placeholder={t(`${key}.inherit`)}
            aria-describedby={`${id}-retry-hint`}
            onChange={(event) => onChange({ ...value, retry: event.target.value })}
          />
          <span id={`${id}-retry-hint`} className={styles.labelHint}>
            {t(`${key}.retryHint`)}
          </span>
        </div>
        {supportsErrors && (
          <>
            <div className={styles.field}>
              <label htmlFor={`${id}-errors-mode`} className={styles.label}>
                {t(`${key}.errorsMode`)}
              </label>
              <select
                id={`${id}-errors-mode`}
                className={styles.input}
                value={value.errorsMode}
                disabled={disabled}
                aria-describedby={`${id}-errors-hint`}
                onChange={(event) =>
                  onChange({
                    ...value,
                    errorsMode: event.target.value as RuntimePolicyDraft['errorsMode'],
                  })
                }
              >
                <option value="inherit">{t(`${key}.inherit`)}</option>
                <option value="override">{t(`${key}.override`)}</option>
              </select>
              <span id={`${id}-errors-hint`} className={styles.labelHint}>
                {t(`${key}.errorsHint`)}
              </span>
            </div>
            {value.errorsMode === 'override' && (
              <ErrorRulesEditor
                rules={value.errorRules}
                onChange={(errorRules) => onChange({ ...value, errorRules })}
                disabled={disabled}
              />
            )}
          </>
        )}
      </div>
    </Collapsible>
  );
}
