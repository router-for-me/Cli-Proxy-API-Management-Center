import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronLeft } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { FutureUsage } from './model';
import {
  BURN_WINDOW_HOURS,
  FORECAST_VIEWS,
  FUTURE_USAGE_OPTIONS,
  MAX_PLAN_WEIGHT,
  type ForecastPrefs,
  type ForecastView,
  burnWindowDays,
} from './prefs';
import styles from './ForecastToolbar.module.scss';

export type WeightRow = {
  key: string;
  label: string;
  weight: number;
  defaultWeight: number;
  count: number;
};

export type ForecastToolbarProps = {
  prefs: ForecastPrefs;
  onPrefsChange: (patch: Partial<ForecastPrefs>) => void;
  weightRows: WeightRow[];
  rangeLabel: string;
  isCurrentRange: boolean;
  onShiftRange: (direction: -1 | 1) => void;
  onToday: () => void;
};

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={`${styles.segment} ${option.value === value ? styles.segmentActive : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ForecastToolbar(props: ForecastToolbarProps) {
  const { prefs, onPrefsChange, weightRows, rangeLabel, isCurrentRange, onShiftRange, onToday } =
    props;
  const { t } = useTranslation();
  const burnLabelId = useId();
  const usageLabelId = useId();

  return (
    <div className={styles.toolbar}>
      <div className={styles.controls}>
        <Segmented<ForecastView>
          label={t('quota_forecast.view_label')}
          value={prefs.view}
          options={FORECAST_VIEWS.map((view) => ({
            value: view,
            label: t(`quota_forecast.view_${view}`),
          }))}
          onChange={(view) => onPrefsChange({ view })}
        />

        <div className={styles.field}>
          <span id={burnLabelId} className={styles.fieldLabel}>
            {t('quota_forecast.burn_rate')}
          </span>
          <Segmented<number>
            label={t('quota_forecast.burn_rate')}
            value={prefs.burnWindowHours}
            options={BURN_WINDOW_HOURS.map((hours) => ({
              value: hours,
              label:
                burnWindowDays(hours) === null
                  ? t('quota_forecast.hours_short', { count: hours })
                  : t('quota_forecast.days_short', { count: burnWindowDays(hours) }),
            }))}
            onChange={(burnWindowHours) => onPrefsChange({ burnWindowHours })}
          />
        </div>

        <div className={styles.field}>
          <span id={usageLabelId} className={styles.fieldLabel}>
            {t('quota_forecast.future_usage')}
          </span>
          <Select
            className={styles.usageSelect}
            value={prefs.futureUsage}
            options={FUTURE_USAGE_OPTIONS.map((usage) => ({
              value: usage,
              label: t(`quota_forecast.future_${usage}`),
            }))}
            onChange={(value) => onPrefsChange({ futureUsage: value as FutureUsage })}
            ariaLabelledBy={usageLabelId}
            fullWidth={false}
          />
        </div>

        <AccountsMenu prefs={prefs} onPrefsChange={onPrefsChange} weightRows={weightRows} />
      </div>

      <div className={styles.range}>
        <span className={styles.rangeLabel}>{rangeLabel}</span>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => onShiftRange(-1)}
          aria-label={t('quota_forecast.previous_range')}
          title={t('quota_forecast.previous_range')}
        >
          <IconChevronLeft size={16} />
        </button>
        <button
          type="button"
          className={styles.todayButton}
          onClick={onToday}
          aria-pressed={isCurrentRange}
        >
          {t('quota_forecast.today')}
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={() => onShiftRange(1)}
          aria-label={t('quota_forecast.next_range')}
          title={t('quota_forecast.next_range')}
        >
          <IconChevronLeft size={16} className={styles.flip} />
        </button>
      </div>
    </div>
  );
}

function AccountsMenu({
  prefs,
  onPrefsChange,
  weightRows,
}: {
  prefs: ForecastPrefs;
  onPrefsChange: (patch: Partial<ForecastPrefs>) => void;
  weightRows: WeightRow[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const setWeight = (row: WeightRow, raw: string) => {
    if (raw.trim() === '') return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return;
    const planWeights = { ...prefs.planWeights };
    if (value === row.defaultWeight) delete planWeights[row.key];
    else planWeights[row.key] = Math.min(MAX_PLAN_WEIGHT, value);
    onPrefsChange({ planWeights });
  };

  return (
    <div className={styles.accounts} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.plainButton} ${prefs.showAccounts ? styles.plainButtonActive : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        {t('quota_forecast.accounts')}
      </button>
      {open && (
        <div
          id={panelId}
          className={styles.popover}
          role="dialog"
          aria-label={t('quota_forecast.accounts')}
        >
          <ToggleSwitch
            checked={prefs.showAccounts}
            onChange={(showAccounts) => onPrefsChange({ showAccounts })}
            label={t('quota_forecast.show_breakdown')}
          />
          <div className={styles.popoverSection}>
            <div className={styles.popoverTitle}>{t('quota_forecast.capacity_weights')}</div>
            <p className={styles.popoverHint}>{t('quota_forecast.capacity_weights_hint')}</p>
            {weightRows.length === 0 ? (
              <p className={styles.popoverHint}>{t('quota_forecast.no_accounts')}</p>
            ) : (
              weightRows.map((row) => (
                <label key={row.key} className={styles.weightRow}>
                  <span className={styles.weightLabel}>
                    {row.label}
                    <span className={styles.weightCount}>
                      {t('quota_forecast.accounts_count', { count: row.count })}
                    </span>
                  </span>
                  <input
                    className={styles.weightInput}
                    type="number"
                    min={0}
                    max={MAX_PLAN_WEIGHT}
                    step={0.1}
                    defaultValue={row.weight}
                    onChange={(event) => setWeight(row, event.target.value)}
                  />
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
