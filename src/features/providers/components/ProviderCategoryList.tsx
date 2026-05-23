import { useTranslation } from 'react-i18next';
import ampcodeLogo from '@/assets/icons/amp.svg';
import claudeLogo from '@/assets/icons/claude.svg';
import codexLogo from '@/assets/icons/codex.svg';
import geminiLogo from '@/assets/icons/gemini.svg';
import openaiLogo from '@/assets/icons/openai-light.svg';
import vertexLogo from '@/assets/icons/vertex.svg';
import { IconAlertTriangle } from '@/components/ui/icons';
import type { ProviderBrand, ProviderGroup } from '../types';
import styles from './ProviderCategoryList.module.scss';

const PROVIDER_LOGOS: Record<ProviderBrand, { src: string; invertOnDark?: boolean }> = {
  gemini: { src: geminiLogo },
  claude: { src: claudeLogo },
  codex: { src: codexLogo },
  vertex: { src: vertexLogo },
  openaiCompatibility: { src: openaiLogo, invertOnDark: true },
  ampcode: { src: ampcodeLogo },
};

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
          const total = realResources.length || (group.id === 'ampcode' ? 1 : 0);
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
                    {group.id === 'ampcode'
                      ? t(
                          group.resources[0]?.disabled
                            ? 'providersPage.categories.ampcodeInactive'
                            : 'providersPage.categories.ampcodeActive'
                        )
                      : t('providersPage.categories.activeCount', {
                          active: activeCount,
                          total,
                        })}
                  </span>
                </span>
              </span>
              {group.issue ? (
                <IconAlertTriangle
                  size={16}
                  style={{ color: 'var(--amber-text)', flexShrink: 0 }}
                />
              ) : (
                <span
                  className={`${styles.badge} ${
                    group.id !== 'ampcode' && total === 0 ? styles.badgeAmber : ''
                  }`}
                >
                  {group.id === 'ampcode' ? (group.resources[0]?.disabled ? '—' : '1') : total}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
