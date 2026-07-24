import styles from '@/pages/AuthFilesPage.module.scss';

export type QuotaProgressBarProps = {
  percent: number | null;
  highThreshold: number;
  mediumThreshold: number;
};

export function QuotaProgressBar({
  percent,
  highThreshold,
  mediumThreshold,
}: QuotaProgressBarProps) {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const normalized = percent === null ? null : clamp(percent, 0, 100);
  const fillClass =
    normalized === null
      ? styles.quotaBarFillMedium
      : normalized >= highThreshold
        ? styles.quotaBarFillHigh
        : normalized >= mediumThreshold
          ? styles.quotaBarFillMedium
          : styles.quotaBarFillLow;
  const widthPercent = Math.round((normalized ?? 0) * 100) / 100;

  return (
    <div className={styles.quotaBar}>
      <div
        className={`${styles.quotaBarFill} ${fillClass}`}
        style={{ width: `${widthPercent}%` }}
      />
    </div>
  );
}

export type TimeProgressBarProps = {
  percent: number;
  animationDurationMs?: number;
};

export function TimeProgressBar({ percent, animationDurationMs }: TimeProgressBarProps) {
  const normalized = Math.min(100, Math.max(0, percent));
  const isAnimated = animationDurationMs !== undefined && animationDurationMs > 0;

  return (
    <div className={`${styles.quotaBar} ${styles.quotaTimeBar}`}>
      <div
        className={`${styles.quotaBarFill} ${styles.quotaBarFillTime}`}
        style={{
          width: isAnimated ? '100%' : `${normalized}%`,
          transform: isAnimated ? `scaleX(${normalized / 100})` : undefined,
          transformOrigin: isAnimated ? 'right' : undefined,
          animationDuration: isAnimated ? `${animationDurationMs}ms` : undefined,
        }}
      />
    </div>
  );
}
