/**
 * Plan badge (prototype for the plan-tier color redesign).
 *
 * Tier is a cross-provider ladder, not a per-provider class choice:
 * - standard → plain text, identical weight to other chip values
 * - premium  → monochrome enamel glaze, no wire
 * - flagship → cloisonné: deep jewel glaze, fine gilt wire, an inlaid diamond
 *
 * A palette is one enamel hue (+ an inlay hue), selected by an ancestor's
 * `data-plan-palette` (default: jilan / sacrificial blue).
 *
 * The badge never loops. Motion happens at two moments only:
 * 1. `arrive`: a single sheen sweeps across once when data first lands.
 * 2. Hover (fine pointers only): a soft highlight follows the pointer 1:1.
 */

import type { CSSProperties, PointerEvent } from 'react';
import styles from './PlanBadge.module.scss';

export type PlanBadgeTier = 'standard' | 'premium' | 'flagship';

export const PLAN_BADGE_PALETTES = ['jilan', 'songshi', 'yanzhi', 'qiepi'] as const;
export type PlanBadgePalette = (typeof PLAN_BADGE_PALETTES)[number];

export interface PlanBadgeProps {
  tier: PlanBadgeTier;
  label: string;
  /** Play the one-shot arrival sheen on mount. Pass only on first data arrival. */
  arrive?: boolean;
  /** Delay before the sheen so it lands after the card entrance settles. */
  arriveDelayMs?: number;
  className?: string;
}

const TIER_CLASS: Record<Exclude<PlanBadgeTier, 'standard'>, string> = {
  premium: styles.premium,
  flagship: styles.flagship,
};

const trackPointer = (event: PointerEvent<HTMLSpanElement>) => {
  if (event.pointerType !== 'mouse') return;
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width === 0) return;
  const x = ((event.clientX - rect.left) / rect.width) * 100;
  // Leaf element with only a text node: setting the variable here is cheap.
  event.currentTarget.style.setProperty('--pb-x', `${Math.max(0, Math.min(100, x))}%`);
};

export function PlanBadge({
  tier,
  label,
  arrive = false,
  arriveDelayMs = 0,
  className,
}: PlanBadgeProps) {
  if (tier === 'standard') {
    return (
      <span className={[styles.badge, styles.standard, className].filter(Boolean).join(' ')}>
        {label}
      </span>
    );
  }

  const classes = [styles.badge, styles.chip, TIER_CLASS[tier], arrive && styles.arrive, className]
    .filter(Boolean)
    .join(' ');
  const style = arrive ? ({ '--pb-delay': `${arriveDelayMs}ms` } as CSSProperties) : undefined;

  return (
    <span className={classes} style={style} onPointerMove={trackPointer} data-tier={tier}>
      {tier === 'flagship' && (
        <svg className={styles.mark} viewBox="0 0 8 8" aria-hidden="true" focusable="false">
          <path d="M4 0 8 4 4 8 0 4Z" />
        </svg>
      )}
      <span className={styles.label}>{label}</span>
    </span>
  );
}
