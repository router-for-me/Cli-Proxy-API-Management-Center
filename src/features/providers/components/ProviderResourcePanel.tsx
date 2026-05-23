import { useTranslation } from 'react-i18next';
import ampcodeLogo from '@/assets/icons/amp.svg';
import claudeLogo from '@/assets/icons/claude.svg';
import codexLogo from '@/assets/icons/codex.svg';
import geminiLogo from '@/assets/icons/gemini.svg';
import openaiLogo from '@/assets/icons/openai-light.svg';
import vertexLogo from '@/assets/icons/vertex.svg';
import { IconPlus, IconSearch } from '@/components/ui/icons';
import type { ProviderBrand, ProviderGroup, ProviderResource } from '../types';
import { ProviderResourceTable } from './ProviderResourceTable';
import styles from './ProviderResourcePanel.module.scss';

const LOGOS: Record<ProviderBrand, { src: string; invertOnDark?: boolean }> = {
  gemini: { src: geminiLogo },
  claude: { src: claudeLogo },
  codex: { src: codexLogo },
  vertex: { src: vertexLogo },
  openaiCompatibility: { src: openaiLogo, invertOnDark: true },
  ampcode: { src: ampcodeLogo },
};

interface ProviderResourcePanelProps {
  group: ProviderGroup;
  filter: string;
  onFilterChange: (value: string) => void;
  filteredResources: ProviderResource[];
  selectedId: string | null;
  disableMutations?: boolean;
  onView: (resource: ProviderResource) => void;
  onEdit: (resource: ProviderResource) => void;
  onDelete: (resource: ProviderResource) => void;
  onCreate: () => void;
}

export function ProviderResourcePanel({
  group,
  filter,
  onFilterChange,
  filteredResources,
  selectedId,
  disableMutations,
  onView,
  onEdit,
  onDelete,
  onCreate,
}: ProviderResourcePanelProps) {
  const { t } = useTranslation();
  const logo = LOGOS[group.id];

  const realResources = filteredResources.filter((r) => !r.flags.isPlaceholder);

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <div className={styles.titleRow}>
            {logo ? (
              <img
                src={logo.src}
                alt=""
                aria-hidden="true"
                className={`${styles.logo} ${logo.invertOnDark ? styles.logoInvertOnDark : ''}`}
              />
            ) : null}
            <h2 className={styles.title}>
              {t(`providersPage.providerNames.${group.id}`)}
            </h2>
          </div>
          <p className={styles.subtitle}>
            {t('providersPage.table.description', { route: group.path })}
          </p>
        </div>
        {group.id !== 'ampcode' ? (
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon} aria-hidden="true">
              <IconSearch size={14} />
            </span>
            <input
              type="search"
              className={styles.searchInput}
              value={filter}
              onChange={(event) => onFilterChange(event.target.value)}
              placeholder={t('providersPage.table.filterPlaceholder')}
            />
          </div>
        ) : null}
      </div>

      {group.issue ? (
        <div className={styles.issue}>
          <div className={styles.issueTitle}>
            {t('providersPage.table.providerIssue')}
            {group.issue.status ? ` · ${group.issue.status}` : ''}
          </div>
          <div>{group.issue.message}</div>
        </div>
      ) : null}

      {realResources.length === 0 && group.id !== 'ampcode' ? (
        <div className={styles.empty}>
          <div>{t('providersPage.table.empty')}</div>
          <div className={styles.emptyAction}>
            <button
              type="button"
              onClick={onCreate}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)',
                cursor: 'pointer',
                fontSize: 13,
              }}
            >
              <IconPlus size={14} />
              <span>{t('providersPage.actions.new')}</span>
            </button>
          </div>
        </div>
      ) : (
        <ProviderResourceTable
          resources={filteredResources}
          selectedId={selectedId}
          disableMutations={disableMutations}
          onView={onView}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
    </section>
  );
}
