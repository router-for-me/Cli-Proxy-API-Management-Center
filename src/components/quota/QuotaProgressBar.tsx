/**
 * Shared quota progress bar.
 *
 * 样式注入型组件：进度条在不同宿主（配额页 / 认证文件卡片）穿不同外衣，
 * 宿主通过 `styles` 传入自己的 CSS Module，需提供 5 个类名：
 * `quotaBar` `quotaBarFill` `quotaBarFillHigh` `quotaBarFillMedium` `quotaBarFillLow`。
 */

export interface QuotaProgressBarProps {
  percent: number | null;
  highThreshold: number;
  mediumThreshold: number;
}

export interface StyledQuotaProgressBarProps extends QuotaProgressBarProps {
  styles: Record<string, string>;
}

export function QuotaProgressBar({
  percent,
  highThreshold,
  mediumThreshold,
  styles,
}: StyledQuotaProgressBarProps) {
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
