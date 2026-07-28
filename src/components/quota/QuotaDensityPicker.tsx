/**
 * Columns-per-row picker for the quota grid.
 *
 * The glyph *is* the layout — N rounded bars for N columns — so it reads without
 * a label. The choice is persisted so the page reopens at the user's density.
 */

import { useTranslation } from 'react-i18next';
import styles from '@/pages/QuotaPage.module.scss';
import { QUOTA_DENSITY_OPTIONS, type QuotaDensity } from './quotaDensity';

/** N evenly spaced rounded bars in a 16px box. */
function DensityGlyph({ columns }: { columns: number }) {
  const gap = 2;
  const width = (16 - (columns - 1) * gap) / columns;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {Array.from({ length: columns }, (_, index) => (
        <rect
          key={index}
          x={(width + gap) * index}
          y={0}
          width={width}
          height={16}
          rx={Math.min(1.5, width / 2)}
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

export interface QuotaDensityPickerProps {
  value: QuotaDensity;
  onChange: (value: QuotaDensity) => void;
}

export function QuotaDensityPicker({ value, onChange }: QuotaDensityPickerProps) {
  const { t } = useTranslation();

  return (
    <div
      className={styles.densityPicker}
      role="group"
      aria-label={t('quota_management.density_label', { defaultValue: 'Cards per row' })}
    >
      {QUOTA_DENSITY_OPTIONS.map((columns) => {
        const label = t('quota_management.density_option', {
          count: columns,
          defaultValue: `${columns} per row`,
        });
        return (
          <button
            key={columns}
            type="button"
            aria-pressed={columns === value}
            aria-label={label}
            title={label}
            onClick={() => onChange(columns)}
          >
            <DensityGlyph columns={columns} />
          </button>
        );
      })}
    </div>
  );
}
