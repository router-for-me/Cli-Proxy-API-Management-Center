import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import iconVertex from '@/assets/icons/vertex.svg';
import type { ProviderKeyConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import { calculateStatusBarData, type KeyStats, type UsageDetail } from '@/utils/usage';
import styles from '@/pages/AiProvidersPage.module.scss';
import { ProviderList } from '../ProviderList';
import { ProviderStatusBar } from '../ProviderStatusBar';
import { getStatsBySource } from '../utils';
import type { VertexFormState } from '../types';
import { VertexModal } from './VertexModal';

interface VertexSectionProps {
  configs: ProviderKeyConfig[];
  keyStats: KeyStats;
  usageDetails: UsageDetail[];
  loading: boolean;
  disableControls: boolean;
  isSaving: boolean;
  isSwitching: boolean;
  isModalOpen: boolean;
  modalIndex: number | null;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onCloseModal: () => void;
  onSave: (data: VertexFormState, index: number | null) => Promise<void>;
}

export function VertexSection({
  configs,
  keyStats,
  usageDetails,
  loading,
  disableControls,
  isSaving,
  isSwitching,
  isModalOpen,
  modalIndex,
  onAdd,
  onEdit,
  onDelete,
  onCloseModal,
  onSave,
}: VertexSectionProps) {
  const { t } = useTranslation();
  const actionsDisabled = disableControls || isSaving || isSwitching;

  const statusBarCache = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof calculateStatusBarData>>();
    const allApiKeys = new Set<string>();
    configs.forEach((config) => config.apiKey && allApiKeys.add(config.apiKey));
    allApiKeys.forEach((apiKey) => {
      cache.set(apiKey, calculateStatusBarData(usageDetails, apiKey));
    });
    return cache;
  }, [configs, usageDetails]);

  const initialData = modalIndex !== null ? configs[modalIndex] : undefined;

  return (
    <>
      <Card
        title={
          <span className={styles.cardTitle}>
            <img src={iconVertex} alt="" className={styles.cardTitleIcon} />
            {t('ai_providers.vertex_title')}
          </span>
        }
        extra={
          <Button size="sm" onClick={onAdd} disabled={actionsDisabled}>
            {t('ai_providers.vertex_add_button')}
          </Button>
        }
      >
        <ProviderList<ProviderKeyConfig>
          items={configs}
          loading={loading}
          keyField={(item) => item.apiKey}
          emptyTitle={t('ai_providers.vertex_empty_title')}
          emptyDescription={t('ai_providers.vertex_empty_desc')}
          onEdit={onEdit}
          onDelete={onDelete}
          actionsDisabled={actionsDisabled}
          renderContent={(item, index) => {
            const stats = getStatsBySource(item.apiKey, keyStats, maskApiKey);
            const headerEntries = Object.entries(item.headers || {});
            const statusData =
              statusBarCache.get(item.apiKey) || calculateStatusBarData([], item.apiKey);

            return (
              <Fragment>
                <div className="item-title">
                  {t('ai_providers.vertex_item_title')} #{index + 1}
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>{t('common.api_key')}:</span>
                  <span className={styles.fieldValue}>{maskApiKey(item.apiKey)}</span>
                </div>
                {item.prefix && (
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>{t('common.prefix')}:</span>
                    <span className={styles.fieldValue}>{item.prefix}</span>
                  </div>
                )}
                {item.baseUrl && (
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>{t('common.base_url')}:</span>
                    <span className={styles.fieldValue}>{item.baseUrl}</span>
                  </div>
                )}
                {item.proxyUrl && (
                  <div className={styles.fieldRow}>
                    <span className={styles.fieldLabel}>{t('common.proxy_url')}:</span>
                    <span className={styles.fieldValue}>{item.proxyUrl}</span>
                  </div>
                )}
                {headerEntries.length > 0 && (
                  <div className={styles.headerBadgeList}>
                    {headerEntries.map(([key, value]) => (
                      <span key={key} className={styles.headerBadge}>
                        <strong>{key}:</strong> {value}
                      </span>
                    ))}
                  </div>
                )}
                {item.models?.length ? (
                  <div className={styles.modelTagList}>
                    <span className={styles.modelCountLabel}>
                      {t('ai_providers.vertex_models_count')}: {item.models.length}
                    </span>
                    {item.models.map((model) => (
                      <span key={`${model.name}-${model.alias || 'default'}`} className={styles.modelTag}>
                        <span className={styles.modelName}>{model.name}</span>
                        {model.alias && (
                          <span className={styles.modelAlias}>{model.alias}</span>
                        )}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className={styles.cardStats}>
                  <span className={`${styles.statPill} ${styles.statSuccess}`}>
                    {t('stats.success')}: {stats.success}
                  </span>
                  <span className={`${styles.statPill} ${styles.statFailure}`}>
                    {t('stats.failure')}: {stats.failure}
                  </span>
                </div>
                <ProviderStatusBar statusData={statusData} />
              </Fragment>
            );
          }}
        />
      </Card>

      <VertexModal
        isOpen={isModalOpen}
        editIndex={modalIndex}
        initialData={initialData}
        onClose={onCloseModal}
        onSave={onSave}
        isSaving={isSaving}
      />
    </>
  );
}
