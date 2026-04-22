import { memo, type ReactNode } from 'react';
import styles from '@/pages/UsagePage.module.scss';

export interface UsageSectionIntroProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export const UsageSectionIntro = memo(function UsageSectionIntro({
  title,
  description,
  action,
}: UsageSectionIntroProps) {
  return (
    <div className={styles.sectionHeader}>
      <div className={styles.sectionHeaderRow}>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {action ? <div className={styles.sectionHeaderAction}>{action}</div> : null}
      </div>
      <p className={styles.sectionDescription}>{description}</p>
    </div>
  );
});

UsageSectionIntro.displayName = 'UsageSectionIntro';
