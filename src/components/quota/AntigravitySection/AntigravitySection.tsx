/**
 * Antigravity quota section component.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useQuotaStore, useThemeStore } from '@/stores';
import type { AntigravityQuotaState, AuthFileItem, ResolvedTheme } from '@/types';
import { isAntigravityFile } from '@/utils/quota';
import { useQuotaSection } from '../hooks/useQuotaSection';
import { useAntigravityQuota } from './useAntigravityQuota';
import { AntigravityCard } from './AntigravityCard';
import styles from '@/pages/QuotaPage.module.scss';

interface AntigravitySectionProps {
  files: AuthFileItem[];
  loading: boolean;
  disabled: boolean;
}

export function AntigravitySection({ files, loading, disabled }: AntigravitySectionProps) {
  const { t } = useTranslation();
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setAntigravityQuota = useQuotaStore((state) => state.setAntigravityQuota);

  const antigravityFiles = useMemo(
    () => files.filter((file) => isAntigravityFile(file)),
    [files]
  );

  const {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToPrev,
    goToNext,
    loading: sectionLoading,
    loadingScope,
    setLoading
  } = useQuotaSection({ items: antigravityFiles });

  const { quota, loadQuota } = useAntigravityQuota();

  const handleRefreshPage = useCallback(() => {
    loadQuota(pageItems, 'page', setLoading);
  }, [loadQuota, pageItems, setLoading]);

  const handleRefreshAll = useCallback(() => {
    loadQuota(antigravityFiles, 'all', setLoading);
  }, [loadQuota, antigravityFiles, setLoading]);

  const getQuotaErrorMessage = useCallback(
    (status: number | undefined, fallback: string) => {
      if (status === 404) return t('common.quota_update_required');
      if (status === 403) return t('common.quota_check_credential');
      return fallback;
    },
    [t]
  );

  // Sync quota state when files change
  useEffect(() => {
    if (loading) return;
    if (antigravityFiles.length === 0) {
      setAntigravityQuota({});
      return;
    }
    setAntigravityQuota((prev) => {
      const nextState: Record<string, AntigravityQuotaState> = {};
      antigravityFiles.forEach((file) => {
        const cached = prev[file.name];
        if (cached) {
          nextState[file.name] = cached;
        }
      });
      return nextState;
    });
  }, [antigravityFiles, loading, setAntigravityQuota]);

  return (
    <Card
      title={t('antigravity_quota.title')}
      extra={
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefreshPage}
            disabled={disabled || sectionLoading || pageItems.length === 0}
            loading={sectionLoading && loadingScope === 'page'}
          >
            {t('antigravity_quota.refresh_button')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefreshAll}
            disabled={disabled || sectionLoading || antigravityFiles.length === 0}
            loading={sectionLoading && loadingScope === 'all'}
          >
            {t('antigravity_quota.fetch_all')}
          </Button>
        </div>
      }
    >
      {antigravityFiles.length === 0 ? (
        <EmptyState
          title={t('antigravity_quota.empty_title')}
          description={t('antigravity_quota.empty_desc')}
        />
      ) : (
        <>
          <div className={styles.antigravityControls}>
            <div className={styles.antigravityControl}>
              <label>{t('auth_files.page_size_label')}</label>
              <select
                className={styles.pageSizeSelect}
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value) || 6)}
              >
                <option value={6}>6</option>
                <option value={9}>9</option>
                <option value={12}>12</option>
                <option value={18}>18</option>
                <option value={24}>24</option>
              </select>
            </div>
            <div className={styles.antigravityControl}>
              <label>{t('common.info')}</label>
              <div className={styles.statsInfo}>
                {antigravityFiles.length} {t('auth_files.files_count')}
              </div>
            </div>
          </div>
          <div className={styles.antigravityGrid}>
            {pageItems.map((item) => (
              <AntigravityCard
                key={item.name}
                item={item}
                quota={quota[item.name]}
                resolvedTheme={resolvedTheme}
                getQuotaErrorMessage={getQuotaErrorMessage}
              />
            ))}
          </div>
          {antigravityFiles.length > pageSize && (
            <div className={styles.pagination}>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToPrev}
                disabled={currentPage <= 1}
              >
                {t('auth_files.pagination_prev')}
              </Button>
              <div className={styles.pageInfo}>
                {t('auth_files.pagination_info', {
                  current: currentPage,
                  total: totalPages,
                  count: antigravityFiles.length
                })}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToNext}
                disabled={currentPage >= totalPages}
              >
                {t('auth_files.pagination_next')}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
