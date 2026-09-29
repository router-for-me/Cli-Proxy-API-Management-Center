/**
 * `08-13 14:30 · in 11 days` — the absolute instant plus its countdown.
 *
 * Shared by every provider body so the two halves can never drift apart in
 * markup or spacing. The separator lives in CSS (`.quotaReset + .quotaResetRelative::before`)
 * rather than here, so the relative half stays independently styleable and a
 * relative-only row has no leading ·.
 */

import type { ResetDisplay } from '@/utils/quota';
import type { QuotaClassMap } from '../types';

export interface QuotaResetLabelProps {
  display: ResetDisplay;
  classes: QuotaClassMap;
  /** True on the row that recovers first for this credential. */
  soon?: boolean;
  /** When false, only the countdown is shown. */
  showAbsolute?: boolean;
}

export function QuotaResetLabel({
  display,
  classes,
  soon = false,
  showAbsolute = true,
}: QuotaResetLabelProps) {
  return (
    <>
      {showAbsolute && <span className={classes.quotaReset}>{display.absolute}</span>}
      {display.relative && (
        <span
          className={
            soon
              ? `${classes.quotaResetRelative} ${classes.quotaResetRelativeSoon}`
              : classes.quotaResetRelative
          }
        >
          {display.relative}
        </span>
      )}
    </>
  );
}
