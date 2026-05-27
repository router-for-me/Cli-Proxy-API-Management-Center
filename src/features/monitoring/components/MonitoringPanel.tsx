import type { PropsWithChildren, ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import styles from '@/pages/MonitoringCenterPage.module.scss';

type MonitoringPanelProps = {
  title?: ReactNode;
  subtitle?: ReactNode;
  extra?: ReactNode;
  className?: string;
};

export function MonitoringPanel({
  title,
  subtitle,
  extra,
  className,
  children,
}: PropsWithChildren<MonitoringPanelProps>) {
  const hasHeader = Boolean(title || subtitle || extra);

  return (
    <Card className={[styles.panel, className].filter(Boolean).join(' ')}>
      {hasHeader ? (
        <div className={styles.panelHeader}>
          <div className={styles.panelHeaderCopy}>
            {title ? <h2 className={styles.panelTitle}>{title}</h2> : null}
            {subtitle ? <p className={styles.panelSubtitle}>{subtitle}</p> : null}
          </div>
          {extra ? <div className={styles.panelExtra}>{extra}</div> : null}
        </div>
      ) : null}
      {children}
    </Card>
  );
}
