import { useTranslation } from 'react-i18next';
import { IconDiamond } from '@/components/ui/icons';
import type { AuthFilePlanBadgeInfo } from '@/features/authFiles/planMetadata';
import styles from '@/pages/AuthFilesPage.module.scss';

type AuthFilePlanBadgeProps = {
  badge: AuthFilePlanBadgeInfo;
};

export function AuthFilePlanBadge(props: AuthFilePlanBadgeProps) {
  const { badge } = props;
  const { t } = useTranslation();

  return (
    <span
      className={`${styles.planBadge} ${
        badge.kind === 'plus' ? styles.planBadgePlus : styles.planBadgePro
      }`}
    >
      {badge.kind === 'plus' && <IconDiamond className={styles.planBadgeIcon} size={12} />}
      <span>{t(badge.labelKey, { defaultValue: badge.fallbackLabel })}</span>
    </span>
  );
}
