/**
 * Columns-per-row preference for the quota grid.
 *
 * Kept apart from the picker component so the module exports only values —
 * mixing component and non-component exports breaks React Fast Refresh.
 */

export const QUOTA_DENSITY_OPTIONS = [2, 3, 4, 5] as const;
export type QuotaDensity = (typeof QUOTA_DENSITY_OPTIONS)[number];

export const QUOTA_DENSITY_STORAGE_KEY = 'cpamc.quotaColumns';
export const QUOTA_DENSITY_DEFAULT: QuotaDensity = 4;

/** Read a persisted density, falling back to the default when absent/invalid. */
export function readStoredDensity(): QuotaDensity {
  try {
    const raw = Number(window.localStorage.getItem(QUOTA_DENSITY_STORAGE_KEY));
    return (QUOTA_DENSITY_OPTIONS as readonly number[]).includes(raw)
      ? (raw as QuotaDensity)
      : QUOTA_DENSITY_DEFAULT;
  } catch {
    return QUOTA_DENSITY_DEFAULT;
  }
}

export function storeDensity(value: QuotaDensity): void {
  try {
    window.localStorage.setItem(QUOTA_DENSITY_STORAGE_KEY, String(value));
  } catch {
    /* storage unavailable (private mode, disabled) — density just won't persist */
  }
}
