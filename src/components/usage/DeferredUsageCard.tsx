import { Card } from '@/components/ui/Card';
import styles from './UsageCharts.module.scss';

export interface DeferredUsageCardProps {
  title: string;
  caption: string;
}

export function DeferredUsageCard({ title, caption }: DeferredUsageCardProps) {
  return (
    <Card title={title} className={styles.deferredCard}>
      <div className={styles.deferredChartShell} aria-hidden="true">
        <div className={styles.deferredLegendRow}>
          <span className={styles.deferredLegendPill} />
          <span className={styles.deferredLegendPill} />
          <span className={`${styles.deferredLegendPill} ${styles.deferredLegendPillWide}`} />
        </div>
        <div className={styles.deferredChartPlaceholder}>
          <span className={styles.deferredChartGlow} />
        </div>
      </div>
      <p className={styles.deferredCaption}>{caption}</p>
    </Card>
  );
}
