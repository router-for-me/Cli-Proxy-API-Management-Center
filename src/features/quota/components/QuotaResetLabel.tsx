/**
 * `08-13 14:30 · in 11 days` — the absolute instant plus its countdown.
 *
 * Shared by every provider body so the two halves can never drift apart in
 * markup or spacing. The separator lives in CSS (`.quotaResetRelative::before`)
 * rather than here, so the relative half stays independently styleable.
 */

import type { ResetDisplay } from '@/utils/quota';
import type { QuotaClassMap } from '../types';

export interface QuotaResetLabelProps {
  display: ResetDisplay;
  classes: QuotaClassMap;
}

export function QuotaResetLabel({ display, classes }: QuotaResetLabelProps) {
  return (
    <>
      <span className={classes.quotaReset}>{display.absolute}</span>
      {display.relative && <span className={classes.quotaResetRelative}>{display.relative}</span>}
    </>
  );
}
