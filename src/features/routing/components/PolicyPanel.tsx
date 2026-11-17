import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { FieldLabel } from '@/components/ui/FieldLabel';
import { InfoTip } from '@/components/ui/Tooltip';
import { ROUTING_STRATEGIES, type RoutingSettings, type RoutingStrategy } from '@/types/routing';
import styles from '../RoutingPage.module.scss';

const strategyKey = (strategy: RoutingStrategy) => strategy.replace(/-/g, '_');

const RETRY_MAX = 100;
const CREDENTIALS_MAX = 1000;

export interface PolicyPanelProps {
  settings: RoutingSettings;
  disabled?: boolean;
  onChange: (next: RoutingSettings) => void;
}

export function PolicyPanel({ settings, disabled = false, onChange }: PolicyPanelProps) {
  const { t } = useTranslation();
  const id = useId();
  const update = (patch: Partial<RoutingSettings>) => onChange({ ...settings, ...patch });

  const readCount = (value: string, max: number): number => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.min(max, Math.max(0, parsed));
  };

  return (
    <aside
      className={styles.policy}
      aria-labelledby={`${id}-title`}
      // The floating save bar lines up with this column (see RoutingSaveBar).
      data-routing-policy-column=""
    >
      <div className={styles.policyHead}>
        <h2 id={`${id}-title`} className={styles.policyTitle}>
          {t('routing.policy_title')}
        </h2>
        <InfoTip content={t('routing.policy_subtitle')} label={t('routing.policy_title')} />
      </div>

      <section className={styles.policySection}>
        <div className={styles.policyLabelRow}>
          <h3 id={`${id}-strategy`} className={styles.policyLabel}>
            {t('routing.strategy_label')}
          </h3>
          {/* Every strategy explained at once, so they can be compared before choosing. */}
          <InfoTip
            label={t('routing.strategy_label')}
            content={
              <span className={styles.strategyTips}>
                {ROUTING_STRATEGIES.map((strategy) => (
                  <span key={strategy} className={styles.strategyTip}>
                    <strong>{t(`routing.strategy_${strategyKey(strategy)}`)}</strong>{' '}
                    {t(`routing.strategy_${strategyKey(strategy)}_desc`)}
                  </span>
                ))}
              </span>
            }
          />
        </div>
        <Select
          value={settings.strategy}
          options={ROUTING_STRATEGIES.map((strategy) => ({
            value: strategy,
            label: t(`routing.strategy_${strategyKey(strategy)}`),
          }))}
          disabled={disabled}
          ariaLabelledBy={`${id}-strategy`}
          ariaDescribedBy={`${id}-strategy-desc`}
          onChange={(strategy) => update({ strategy: strategy as RoutingStrategy })}
        />
        <p id={`${id}-strategy-desc`} className={styles.policyHint}>
          {t(`routing.strategy_${strategyKey(settings.strategy)}_desc`)}
        </p>
      </section>

      <section className={styles.policyRow}>
        {/* The hidden hint copy describes both the switch and the InfoTip. */}
        <FieldLabel
          id={`${id}-affinity`}
          label={t('routing.affinity_label')}
          hint={t('routing.affinity_desc')}
          hintId={`${id}-affinity-desc`}
          className={styles.policyRowText}
          labelClassName={styles.policyRowLabel}
        />
        <ToggleSwitch
          checked={settings.sessionAffinity}
          disabled={disabled}
          onChange={(sessionAffinity) => update({ sessionAffinity })}
          ariaLabel={t('routing.affinity_label')}
          ariaDescribedBy={`${id}-affinity-desc`}
        />
      </section>

      <section className={styles.policySection}>
        <h3 className={styles.policyLabel}>{t('routing.retry_label')}</h3>
        <div className={styles.numberField}>
          <FieldLabel
            htmlFor={`${id}-retry`}
            label={t('routing.request_retry')}
            hint={t('routing.request_retry_desc')}
            hintId={`${id}-retry-desc`}
            className={styles.policyRowText}
            labelClassName={styles.policyRowLabel}
          />
          <input
            id={`${id}-retry`}
            aria-describedby={`${id}-retry-desc`}
            type="number"
            inputMode="numeric"
            min={0}
            max={RETRY_MAX}
            step={1}
            value={settings.requestRetry}
            disabled={disabled}
            onChange={(event) => update({ requestRetry: readCount(event.target.value, RETRY_MAX) })}
          />
        </div>
        <div className={styles.numberField}>
          <FieldLabel
            htmlFor={`${id}-credentials`}
            label={t('routing.max_retry_credentials')}
            hint={t('routing.max_retry_credentials_desc')}
            hintId={`${id}-credentials-desc`}
            className={styles.policyRowText}
            labelClassName={styles.policyRowLabel}
          />
          <input
            id={`${id}-credentials`}
            aria-describedby={`${id}-credentials-desc`}
            type="number"
            inputMode="numeric"
            min={0}
            max={CREDENTIALS_MAX}
            step={1}
            value={settings.maxRetryCredentials}
            disabled={disabled}
            onChange={(event) =>
              update({ maxRetryCredentials: readCount(event.target.value, CREDENTIALS_MAX) })
            }
          />
        </div>
      </section>
    </aside>
  );
}
