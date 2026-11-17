import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { ModelPrice } from '@/types/visualConfig';
import styles from './Blocks.module.scss';

const PREFIX = 'config_management.visual.api_keys.prices';

interface ModelPricesEditorProps {
  value: ModelPrice[];
  disabled?: boolean;
  onChange: (next: ModelPrice[]) => void;
}

const PRICE_FIELDS: Array<keyof Omit<ModelPrice, 'model'>> = [
  'input',
  'output',
  'cachedInput',
  'cacheWrite',
];

/** Edits access.model-prices: USD per one million tokens, used by API key cost limits. */
export function ModelPricesEditor({ value, disabled, onChange }: ModelPricesEditorProps) {
  const { t } = useTranslation();
  const update = (index: number, patch: Partial<ModelPrice>) =>
    onChange(value.map((price, i) => (i === index ? { ...price, ...patch } : price)));
  const toPrice = (raw: string) => {
    const num = Number(raw);
    return Number.isFinite(num) && num > 0 ? num : 0;
  };

  return (
    <div className={styles.apiKeys}>
      <div className={styles.apiKeysHeader}>
        <div className={styles.priceHeaderCopy}>
          <span className={styles.apiKeysTitle}>{t(`${PREFIX}.label`)}</span>
          <span className={styles.priceHint}>{t(`${PREFIX}.hint`)}</span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            onChange([...value, { model: '', input: 0, output: 0, cachedInput: 0, cacheWrite: 0 }])
          }
          disabled={disabled}
        >
          {t(`${PREFIX}.add`)}
        </Button>
      </div>
      {value.length === 0 ? (
        <div className={styles.emptyState}>{t(`${PREFIX}.empty`)}</div>
      ) : (
        <div className={styles.priceGrid}>
          <span className={styles.policyLimitsHead}>{t(`${PREFIX}.model`)}</span>
          {PRICE_FIELDS.map((field) => (
            <span key={field} className={styles.policyLimitsHead}>
              {t(`${PREFIX}.${field}`)}
            </span>
          ))}
          <span />
          {value.map((price, index) => (
            <div key={index} className={styles.policyLimitsRow}>
              <input
                className="input"
                value={price.model}
                placeholder="gpt-5*"
                aria-label={t(`${PREFIX}.model`)}
                onChange={(event) => update(index, { model: event.target.value })}
                disabled={disabled}
              />
              {PRICE_FIELDS.map((field) => (
                <input
                  key={field}
                  type="number"
                  min={0}
                  step={0.01}
                  className="input"
                  value={price[field] > 0 ? price[field] : ''}
                  placeholder="0"
                  aria-label={t(`${PREFIX}.${field}`)}
                  onChange={(event) => update(index, { [field]: toPrice(event.target.value) })}
                  disabled={disabled}
                />
              ))}
              <Button
                variant="ghost"
                size="sm"
                className={styles.apiKeyDelete}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                disabled={disabled}
              >
                {t('config_management.visual.common.delete')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
