import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import iconQoder from '@/assets/icons/qoder.svg';
import type { OpenAIProviderConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import styles from '@/pages/AiProvidersPage.module.scss';
import { ProviderList } from '../ProviderList';
import { ProviderStatusBar } from '../ProviderStatusBar';
import {
  getOpenAIProviderKey,
  getOpenAIProviderRecentStatusData,
  getOpenAIProviderTotalStats,
  type ProviderRecentUsageMap,
} from '../utils';

interface QoderSectionProps {
  configs: OpenAIProviderConfig[];
  usageByProvider: ProviderRecentUsageMap;
  loading: boolean;
  disableControls: boolean;
  isSwitching: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
}

export function QoderSection({
  configs,
  usageByProvider,
  loading,
  disableControls,
  isSwitching,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
}: QoderSectionProps) {
  const { t } = useTranslation();
  const actionsDisabled = disableControls || loading || isSwitching;
  const toggleDisabled = disableControls || loading || isSwitching;

  const statusBarCache = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof getOpenAIProviderRecentStatusData>>();

    configs.forEach((config, index) => {
      cache.set(
        getOpenAIProviderKey(config, index),
        getOpenAIProviderRecentStatusData(config, usageByProvider)
      );
    });

    return cache;
  }, [configs, usageByProvider]);

  return (
    <Card
      title={
        <span className={styles.cardTitle}>
          <img src={iconQoder} alt="" className={styles.cardTitleIcon} />
          {t('ai_providers.qoder_title')}
        </span>
      }
      extra={
        <Button size="sm" onClick={onAdd} disabled={actionsDisabled}>
          {t('ai_providers.qoder_add_button')}
        </Button>
      }
    >
      <ProviderList<OpenAIProviderConfig>
        items={configs}
        loading={loading}
        keyField={(item, index) => getOpenAIProviderKey(item, index)}
        emptyTitle={t('ai_providers.qoder_empty_title')}
        emptyDescription={t('ai_providers.qoder_empty_desc')}
        onEdit={(_, index) => onEdit(index)}
        onDelete={(_, index) => onDelete(index)}
        actionsDisabled={actionsDisabled}
        getRowDisabled={(item) => Boolean(item.disabled)}
        renderExtraActions={(item, index) => (
          <ToggleSwitch
            label={t('ai_providers.config_toggle_label')}
            checked={!item.disabled}
            disabled={toggleDisabled}
            onChange={(value) => void onToggle(index, value)}
          />
        )}
        renderContent={(item, index) => {
          const primaryKey = item.apiKeyEntries?.[0];
          const stats = getOpenAIProviderTotalStats(item, usageByProvider);
          const headerEntries = Object.entries(item.headers || {});
          const statusData =
            statusBarCache.get(getOpenAIProviderKey(item, index)) ||
            getOpenAIProviderRecentStatusData(item, usageByProvider);

          return (
            <Fragment>
              <div className="item-title">
                {t('ai_providers.qoder_item_title')} #{index + 1}
              </div>
              {primaryKey?.apiKey && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>{t('common.api_key')}:</span>
                  <span className={styles.fieldValue}>{maskApiKey(primaryKey.apiKey)}</span>
                </div>
              )}
              {item.priority !== undefined && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>{t('common.priority')}:</span>
                  <span className={styles.fieldValue}>{item.priority}</span>
                </div>
              )}
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
              {primaryKey?.proxyUrl && (
                <div className={styles.fieldRow}>
                  <span className={styles.fieldLabel}>{t('common.proxy_url')}:</span>
                  <span className={styles.fieldValue}>{primaryKey.proxyUrl}</span>
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
              {item.disabled && (
                <div className="status-badge warning" style={{ marginTop: 8, marginBottom: 0 }}>
                  {t('ai_providers.config_disabled_badge')}
                </div>
              )}
              {item.models?.length ? (
                <div className={styles.modelTagList}>
                  <span className={styles.modelCountLabel}>
                    {t('ai_providers.qoder_models_count')}: {item.models.length}
                  </span>
                  {item.models.map((model) => (
                    <span key={model.name} className={styles.modelTag}>
                      <span className={styles.modelName}>{model.name}</span>
                      {model.alias && model.alias !== model.name && (
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
  );
}
