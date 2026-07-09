import { useTranslation } from 'react-i18next';
import { PROVIDER_LOGOS } from '../brandLogos';
import type { ProviderBrand, ProviderGroup } from '../types';
import styles from './ProviderCategoryList.module.scss';

interface ProviderCategoryListProps {
  groups: ProviderGroup[];
  activeBrand: ProviderBrand;
  onSelect: (brand: ProviderBrand) => void;
}

const QUICK_FILL_BRANDS: ReadonlySet<ProviderBrand> = new Set([
  'code0',
  'fennoAI',
  'qiniuCloud',
  'claudeApi',
]);

export function ProviderCategoryList({ groups, activeBrand, onSelect }: ProviderCategoryListProps) {
  const { t } = useTranslation();

  const quickFillGroups = groups.filter((g) => QUICK_FILL_BRANDS.has(g.id));
  const providerGroups = groups.filter((g) => !QUICK_FILL_BRANDS.has(g.id));

  const renderGroups = (items: ProviderGroup[]) => (
    <div className={styles.list}>
      {items.map((group) => {
        const active = group.id === activeBrand;
        const total = group.resources.length;
        const activeCount = group.resources.filter((r) => !r.disabled).length;
        const logo = PROVIDER_LOGOS[group.id];
        const itemClass = `${styles.item} ${active ? styles.active : ''}`;
        const logoClassName = [
          styles.logo,
          logo?.transparent ? styles.logoTransparent : '',
          logo?.darkSrc ? styles.logoThemeLight : '',
          logo?.invertOnDark ? styles.logoInvertOnDark : '',
        ]
          .filter(Boolean)
          .join(' ');
        const darkLogoClassName = [
          styles.logo,
          logo?.transparent ? styles.logoTransparent : '',
          styles.logoThemeDark,
        ]
          .filter(Boolean)
          .join(' ');

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
                <>
                  <img src={logo.src} alt="" aria-hidden="true" className={logoClassName} />
                  {logo.darkSrc ? (
                    <img
                      src={logo.darkSrc}
                      alt=""
                      aria-hidden="true"
                      className={darkLogoClassName}
                    />
                  ) : null}
                </>
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
            <span className={`${styles.badge} ${total === 0 ? styles.badgeAmber : ''}`}>
              {total}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={styles.stack}>
      <aside className={styles.aside}>
        <p className={styles.eyebrow}>{t('providersPage.categories.title')}</p>
        {renderGroups(providerGroups)}
      </aside>
      {quickFillGroups.length > 0 && (
        <aside className={styles.aside}>
          <p className={styles.eyebrow}>{t('providersPage.categories.quickFill')}</p>
          {renderGroups(quickFillGroups)}
        </aside>
      )}
    </div>
  );
}
