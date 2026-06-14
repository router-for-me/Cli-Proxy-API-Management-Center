import { useTranslation } from 'react-i18next';
import { PROVIDER_LOGOS } from '../brandLogos';
import type { ProviderBrand, ProviderGroup } from '../types';
import styles from './ProviderCategoryList.module.scss';

interface ProviderCategoryListProps {
  groups: ProviderGroup[];
  activeBrand: ProviderBrand;
  onSelect: (brand: ProviderBrand) => void;
}

export function ProviderCategoryList({
  groups,
  activeBrand,
  onSelect,
}: ProviderCategoryListProps) {
  const { t } = useTranslation();

  return (
    <aside className={styles.aside}>
      <p className={styles.eyebrow}>{t('providersPage.categories.title')}</p>
      <div className={styles.list}>
        {groups.map((group) => {
          const active = group.id === activeBrand;
          const realResources = group.resources.filter(
            (r) => !r.flags.isPlaceholder
          );
          const total = realResources.length;
          const activeCount = realResources.filter((r) => !r.disabled).length;
          const logo = PROVIDER_LOGOS[group.id];
          const itemClass = `${styles.item} ${active ? styles.active : ''}`;

          return (
            <button
              key={group.id}
              type="button"
              className={itemClass}
              onClick={() => onSelect(group.id)}
              aria-current={active ? 'page' : undefined}
            >
              <span className={styles.itemLeft}>
                {logo ? (
                  <img
                    src={logo.src}
                    alt=""
                    aria-hidden="true"
                    className={`${styles.logo} ${logo.invertOnDark ? styles.logoInvertOnDark : ''}`}
                  />
                ) : null}
                <span className={styles.itemText}>
                  <span className={styles.itemTitle}>
                    {t(`providersPage.providerNames.${group.id}`)}
                  </span>
                  <span className={styles.itemSubtitle}>
                    {t('providersPage.categories.activeCount', {
                      active: activeCount,
                      total,
                    })}
                  </span>
                </span>
              </span>
              <span
                className={`${styles.badge} ${
                  total === 0 ? styles.badgeAmber : ''
                }`}
              >
                {total}
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
