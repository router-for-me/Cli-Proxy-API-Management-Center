/**
 * Provider filter chips for the quota board.
 *
 * These replace the old per-provider section headers. Because the board is now
 * one continuous grid, filtering is the only thing the headers were still
 * carrying, and a chip row does it without cutting the grid into bands.
 */

import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { TYPE_COLORS } from '@/utils/quota';
import type { ResolvedTheme, ThemeColors } from '@/types';
import type { QuotaProviderKey } from './quotaSummary';
import styles from '@/pages/QuotaPage.module.scss';

export interface QuotaFilterChipsProps {
  /** Providers that actually have credentials, in display order. */
  providers: { key: QuotaProviderKey; count: number }[];
  total: number;
  active: QuotaProviderKey | 'all';
  onSelect: (provider: QuotaProviderKey | 'all') => void;
  resolvedTheme: ResolvedTheme;
  labelFor: (provider: QuotaProviderKey) => string;
}

export function QuotaFilterChips({
  providers,
  total,
  active,
  onSelect,
  resolvedTheme,
  labelFor,
}: QuotaFilterChipsProps) {
  const { t } = useTranslation();

  if (providers.length === 0) return null;

  return (
    <div className={styles.filterChips} role="group" aria-label={t('quota_management.title')}>
      <button
        type="button"
        className={styles.filterChip}
        aria-pressed={active === 'all'}
        onClick={() => onSelect('all')}
      >
        {t('quota_management.filter_all', { defaultValue: 'All credentials' })}
        <span className={styles.countBadge}>{total}</span>
      </button>

      {providers.map(({ key, count }) => {
        const colorSet = TYPE_COLORS[key] || TYPE_COLORS.unknown;
        const color: ThemeColors =
          resolvedTheme === 'dark' && colorSet.dark ? colorSet.dark : colorSet.light;

        return (
          <button
            key={key}
            type="button"
            className={styles.filterChip}
            aria-pressed={active === key}
            style={{ '--provider-accent': color.text } as CSSProperties}
            onClick={() => onSelect(active === key ? 'all' : key)}
          >
            <span className={styles.filterChipDot} aria-hidden="true" />
            {labelFor(key)}
            <span className={styles.countBadge}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
