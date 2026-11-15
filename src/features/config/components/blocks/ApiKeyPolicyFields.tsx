import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiKeyLimits } from '@/types/visualConfig';
import type { ApiKeyPolicyUsage, ApiKeyUsageWindow } from '@/services/api/apiKeyPolicyUsage';
import { daysUntilExpiry } from '../../apiKeyPolicies';
import styles from './Blocks.module.scss';

const PREFIX = 'config_management.visual.api_keys.policy';

const WINDOW_ROWS: Array<{
  window: ApiKeyUsageWindow;
  tokens: keyof ApiKeyLimits;
  cost: keyof ApiKeyLimits;
}> = [
  { window: 'day', tokens: 'tokensPerDay', cost: 'costPerDay' },
  { window: 'week', tokens: 'tokensPerWeek', cost: 'costPerWeek' },
  { window: 'month', tokens: 'tokensPerMonth', cost: 'costPerMonth' },
];

export function ExpiryBadgeText({ expiresAt }: { expiresAt: string }) {
  const { t } = useTranslation();
  const days = daysUntilExpiry(expiresAt);
  if (days === null) return null;
  if (days < 0) return <>{t(`${PREFIX}.expired`)}</>;
  return <>{t(`${PREFIX}.days_left`, { count: days })}</>;
}

function UsageBar({
  used,
  limit,
  format,
}: {
  used: number;
  limit: number;
  format: (n: number) => string;
}) {
  const { t } = useTranslation();
  if (limit <= 0) {
    return <span className={styles.policyUsageText}>{format(used)}</span>;
  }
  const ratio = Math.min(1, used / limit);
  const level = ratio >= 1 ? 'full' : ratio >= 0.8 ? 'high' : 'ok';
  return (
    <span className={styles.policyUsage}>
      <span
        className={styles.policyUsageTrack}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-label={t(`${PREFIX}.usage_label`)}
      >
        <span
          className={`${styles.policyUsageFill} ${styles[`policyUsage_${level}`] ?? ''}`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </span>
      <span className={styles.policyUsageText}>
        {format(used)} / {format(limit)}
      </span>
    </span>
  );
}

interface ApiKeyPolicyFieldsProps {
  expiresAtDate: string;
  modelsText: string;
  limits: ApiKeyLimits;
  usage?: ApiKeyPolicyUsage;
  disabled?: boolean;
  onExpiresAtDateChange: (value: string) => void;
  onModelsTextChange: (value: string) => void;
  onLimitsChange: (value: ApiKeyLimits) => void;
}

export function ApiKeyPolicyFields({
  expiresAtDate,
  modelsText,
  limits,
  usage,
  disabled,
  onExpiresAtDateChange,
  onModelsTextChange,
  onLimitsChange,
}: ApiKeyPolicyFieldsProps) {
  const { t, i18n } = useTranslation();
  const expiryId = useId();
  const modelsId = useId();
  const tokenFormat = (n: number) => new Intl.NumberFormat(i18n.language).format(Math.round(n));
  const costFormat = (n: number) =>
    new Intl.NumberFormat(i18n.language, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: n < 1 ? 4 : 2,
    }).format(n);
  const setLimit = (field: keyof ApiKeyLimits, raw: string) => {
    const value = Number(raw);
    onLimitsChange({ ...limits, [field]: Number.isFinite(value) && value > 0 ? value : 0 });
  };
  const days = daysUntilExpiry(expiresAtDate);

  return (
    <>
      <div className="form-group">
        <label htmlFor={expiryId}>{t(`${PREFIX}.expires_label`)}</label>
        <div className={styles.policyInlineRow}>
          <input
            id={expiryId}
            type="date"
            className="input"
            value={expiresAtDate}
            onChange={(event) => onExpiresAtDateChange(event.target.value)}
            disabled={disabled}
          />
          {expiresAtDate && (
            <span
              className={`${styles.policyBadge} ${
                days !== null && days < 0
                  ? styles.policyState_disabled
                  : days !== null && days <= 7
                    ? styles.policyState_cooldown
                    : ''
              }`}
            >
              <ExpiryBadgeText expiresAt={expiresAtDate} />
            </span>
          )}
        </div>
        <div className="hint">{t(`${PREFIX}.expires_hint`)}</div>
      </div>
      <div className="form-group">
        <label htmlFor={modelsId}>{t(`${PREFIX}.models_label`)}</label>
        <textarea
          id={modelsId}
          className="input"
          rows={3}
          value={modelsText}
          onChange={(event) => onModelsTextChange(event.target.value)}
          placeholder={'gpt-5*\nclaude-sonnet-*'}
          disabled={disabled}
        />
        <div className="hint">{t(`${PREFIX}.models_hint`)}</div>
      </div>
      <div className="form-group">
        <label>{t(`${PREFIX}.limits_label`)}</label>
        <div className={styles.policyLimitsGrid}>
          <span />
          <span className={styles.policyLimitsHead}>{t(`${PREFIX}.limit_tokens`)}</span>
          <span className={styles.policyLimitsHead}>{t(`${PREFIX}.limit_cost`)}</span>
          {WINDOW_ROWS.map(({ window, tokens, cost }) => (
            <div key={window} className={styles.policyLimitsRow}>
              <span className={styles.policyLimitsWindow}>{t(`${PREFIX}.window_${window}`)}</span>
              <span className={styles.policyLimitsCell}>
                <input
                  type="number"
                  min={0}
                  step={1000}
                  className="input"
                  value={limits[tokens] > 0 ? limits[tokens] : ''}
                  placeholder={t(`${PREFIX}.unlimited`)}
                  aria-label={`${t(`${PREFIX}.window_${window}`)} ${t(`${PREFIX}.limit_tokens`)}`}
                  onChange={(event) => setLimit(tokens, event.target.value)}
                  disabled={disabled}
                />
                {usage && (
                  <UsageBar
                    used={usage.usage[window].tokens}
                    limit={limits[tokens]}
                    format={tokenFormat}
                  />
                )}
              </span>
              <span className={styles.policyLimitsCell}>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  className="input"
                  value={limits[cost] > 0 ? limits[cost] : ''}
                  placeholder={t(`${PREFIX}.unlimited`)}
                  aria-label={`${t(`${PREFIX}.window_${window}`)} ${t(`${PREFIX}.limit_cost`)}`}
                  onChange={(event) => setLimit(cost, event.target.value)}
                  disabled={disabled}
                />
                {usage && (
                  <UsageBar
                    used={usage.usage[window].cost}
                    limit={limits[cost]}
                    format={costFormat}
                  />
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="hint">{t(`${PREFIX}.limits_hint`)}</div>
      </div>
    </>
  );
}
