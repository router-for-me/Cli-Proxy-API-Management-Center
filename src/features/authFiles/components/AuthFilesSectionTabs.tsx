import { useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconFileText, IconSettings } from '@/components/ui/icons';
import styles from './AuthFilesSectionTabs.module.scss';

export type AuthFilesSectionTab = 'credentials' | 'oauth';

type AuthFilesSectionTabsProps = {
  active: AuthFilesSectionTab;
  credentialCount: number;
  onChange: (tab: AuthFilesSectionTab) => void;
};

const TAB_IDS: AuthFilesSectionTab[] = ['credentials', 'oauth'];

export function AuthFilesSectionTabs({
  active,
  credentialCount,
  onChange,
}: AuthFilesSectionTabsProps) {
  const { t } = useTranslation();
  const buttonRefs = useRef<Partial<Record<AuthFilesSectionTab, HTMLButtonElement | null>>>({});

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = TAB_IDS.indexOf(active);
    let nextIndex = -1;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TAB_IDS.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TAB_IDS.length) % TAB_IDS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TAB_IDS.length - 1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextTab = TAB_IDS[nextIndex];
    onChange(nextTab);
    buttonRefs.current[nextTab]?.focus();
  };

  const tabs = [
    {
      id: 'credentials' as const,
      label: t('auth_files.tab_credentials'),
      count: credentialCount,
      Icon: IconFileText,
    },
    {
      id: 'oauth' as const,
      label: t('auth_files.tab_oauth_config'),
      count: null,
      Icon: IconSettings,
    },
  ];

  return (
    <div className={styles.tabs} role="tablist" aria-label={t('auth_files.title_section')}>
      {tabs.map(({ id, label, count, Icon }) => {
        const isActive = active === id;
        return (
          <button
            key={id}
            ref={(node) => {
              buttonRefs.current[id] = node;
            }}
            type="button"
            role="tab"
            id={`auth-files-tab-${id}`}
            aria-selected={isActive}
            aria-controls={`auth-files-panel-${id}`}
            tabIndex={isActive ? 0 : -1}
            className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
            onClick={() => onChange(id)}
            onKeyDown={handleKeyDown}
          >
            <Icon size={16} className={styles.icon} />
            <span>{label}</span>
            {count !== null && <span className={styles.count}>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
