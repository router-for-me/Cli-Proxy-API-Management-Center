import { memo } from 'react';
import styles from '@/pages/UsagePage.module.scss';

export interface UsageSectionIntroProps {
  title: string;
  description: string;
}

export const UsageSectionIntro = memo(function UsageSectionIntro({
  title,
  description,
}: UsageSectionIntroProps) {
  return (
    <div className={styles.sectionHeader}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <p className={styles.sectionDescription}>{description}</p>
    </div>
  );
});

UsageSectionIntro.displayName = 'UsageSectionIntro';
