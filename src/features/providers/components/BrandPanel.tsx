import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconExternalLink, IconPlus } from '@/components/ui/icons';
import type { ProviderRecentUsageMap } from '@/components/providers/utils';
import { getKimiAffiliateUrl } from '../kimi';
import { resolveResourceUsage } from '../resourceView';
import { getSponsorProviderDefinition } from '../sponsorDefinitions';
import type { ProviderGroup, ProviderResource, ProviderSortBy, SortDir } from '../types';
import { BrandLogo } from './BrandLogo';
import { ResourceCard } from './ResourceCard';
import { ResourceToolbar } from './ResourceToolbar';
import styles from './BrandPanel.module.scss';

const CASCADE_STEP_MS = 40;
const CASCADE_MAX_MS = 240;
/** Cascade delay budget plus the card entrance duration. */
const CASCADE_SETTLE_MS = CASCADE_MAX_MS + 260;

export interface BrandPanelControls {
  filter: string;
  onFilterChange: (value: string) => void;
  sortBy: ProviderSortBy;
  sortDir: SortDir;
  onSortBy: (value: ProviderSortBy) => void;
  onSortDir: (value: SortDir) => void;
  availableModels: ReadonlyArray<string>;
  selectedModels: ReadonlySet<string>;
  onSelectedModelsChange: (next: Set<string>) => void;
  onClearFilters: () => void;
}

interface BrandPanelProps {
  id: string;
  labelledBy: string;
  group: ProviderGroup;
  resources: ProviderResource[];
  controls: BrandPanelControls;
  selectedId: string | null;
  disableMutations: boolean;
  usageByProvider: ProviderRecentUsageMap;
  onView: (resource: ProviderResource) => void;
  onEdit: (resource: ProviderResource) => void;
  onDelete: (resource: ProviderResource) => void;
  onToggleDisabled: (resource: ProviderResource, disabled: boolean) => void;
  onCreate: () => void;
}

const resolveRegistrationUrl = (group: ProviderGroup, language: string): string | null => {
  if (group.id === 'kimi') return getKimiAffiliateUrl(language);
  if (group.id === 'fennoAI' || group.id === 'qiniuCloud' || group.id === 'aiCodeMirror') {
    return getSponsorProviderDefinition(group.id).affiliateUrl ?? null;
  }
  return null;
};

export function BrandPanel({
  id,
  labelledBy,
  group,
  resources,
  controls,
  selectedId,
  disableMutations,
  usageByProvider,
  onView,
  onEdit,
  onDelete,
  onToggleDisabled,
  onCreate,
}: BrandPanelProps) {
  const { t, i18n } = useTranslation();
  // Cards present on first mount cascade in once; brand switches and filtering never replay it.
  const [cascadeIds, setCascadeIds] = useState<ReadonlySet<string>>(
    () => new Set(resources.map((resource) => resource.id))
  );
  useEffect(() => {
    const timer = window.setTimeout(() => setCascadeIds(new Set()), CASCADE_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, []);
  const providerName = t(`providersPage.providerNames.${group.id}`);
  const registrationUrl = resolveRegistrationUrl(
    group,
    i18n.resolvedLanguage ?? i18n.language ?? ''
  );
  const registrationLabel = t(
    group.id === 'kimi' ? 'providersPage.sponsor.registerNow' : 'providersPage.sponsor.registerLink'
  );
  const hasResources = group.resources.length > 0;
  const filtersActive = controls.filter.trim() !== '' || controls.selectedModels.size > 0;

  const registrationLink = registrationUrl ? (
    <a className={styles.linkPill} href={registrationUrl} target="_blank" rel="noreferrer">
      <span>{registrationLabel}</span>
      <IconExternalLink size={13} aria-hidden="true" />
    </a>
  ) : null;

  return (
    <section id={id} role="tabpanel" aria-labelledby={labelledBy} className={styles.panel}>
      {registrationUrl ? (
        <div className={`${styles.note} ${group.id === 'kimi' ? styles.noteKimi : ''}`}>
          <BrandLogo brand={group.id} size={28} />
          <div className={styles.noteText}>
            <span className={styles.noteTitle}>{providerName}</span>
            {group.id === 'kimi' ? (
              <span className={styles.noteBody}>{t('providersPage.sponsor.kimiPromo')}</span>
            ) : null}
          </div>
          {registrationLink}
        </div>
      ) : null}

      {hasResources ? (
        <ResourceToolbar
          key={group.id}
          filter={controls.filter}
          onFilterChange={controls.onFilterChange}
          sortBy={controls.sortBy}
          sortDir={controls.sortDir}
          onSortBy={controls.onSortBy}
          onSortDir={controls.onSortDir}
          availableModels={controls.availableModels}
          selectedModels={controls.selectedModels}
          onSelectedModelsChange={controls.onSelectedModelsChange}
        />
      ) : null}

      {!hasResources ? (
        <div className={styles.empty}>
          <BrandLogo brand={group.id} size={44} className={styles.emptyLogo} />
          <h2 className={styles.emptyTitle}>
            {t('providersPage.table.emptyBrand', { provider: providerName })}
          </h2>
          <div className={styles.emptyActions}>
            <button
              type="button"
              className={styles.primaryPill}
              onClick={onCreate}
              disabled={disableMutations}
            >
              <IconPlus size={15} />
              {t('providersPage.actions.newFor', { provider: providerName })}
            </button>
          </div>
        </div>
      ) : resources.length === 0 ? (
        <div className={`${styles.empty} ${styles.emptyCompact}`}>
          <h2 className={styles.emptyTitle}>{t('providersPage.table.noMatch')}</h2>
          {filtersActive ? (
            <div className={styles.emptyActions}>
              <button type="button" className={styles.ghostPill} onClick={controls.onClearFilters}>
                {t('providersPage.toolbar.clearFilters')}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={styles.grid}>
          {resources.map((resource, index) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              selected={resource.id === selectedId}
              disableMutations={disableMutations}
              usage={resolveResourceUsage(resource, usageByProvider)}
              enterDelayMs={
                cascadeIds.has(resource.id)
                  ? Math.min(index * CASCADE_STEP_MS, CASCADE_MAX_MS)
                  : undefined
              }
              onView={onView}
              onEdit={onEdit}
              onDelete={onDelete}
              onToggleDisabled={onToggleDisabled}
            />
          ))}
        </div>
      )}
    </section>
  );
}
