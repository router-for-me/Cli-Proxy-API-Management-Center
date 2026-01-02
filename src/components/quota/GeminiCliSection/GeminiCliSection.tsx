/**
 * Gemini CLI quota section component.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useQuotaStore, useThemeStore } from '@/stores';
import type { GeminiCliQuotaState, AuthFileItem, ResolvedTheme } from '@/types';
import { isGeminiCliFile, isRuntimeOnlyAuthFile } from '@/utils/quota';
import { useQuotaSection } from '../hooks/useQuotaSection';
import { useGeminiCliQuota } from './useGeminiCliQuota';
import { GeminiCliCard } from './GeminiCliCard';
import styles from '@/pages/QuotaPage.module.scss';

interface GeminiCliSectionProps {
  files: AuthFileItem[];
  loading: boolean;
  disabled: boolean;
}

export function GeminiCliSection({ files, loading, disabled }: GeminiCliSectionProps) {
  const { t } = useTranslation();
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setGeminiCliQuota = useQuotaStore((state) => state.setGeminiCliQuota);

  const geminiCliFiles = useMemo(
    () => files.filter((file) => isGeminiCliFile(file) && !isRuntimeOnlyAuthFile(file)),
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
  } = useQuotaSection({ items: geminiCliFiles });

  const { quota, loadQuota } = useGeminiCliQuota();

  const handleRefreshPage = useCallback(() => {
    loadQuota(pageItems, 'page', setLoading);
  }, [loadQuota, pageItems, setLoading]);

  const handleRefreshAll = useCallback(() => {
    loadQuota(geminiCliFiles, 'all', setLoading);
  }, [loadQuota, geminiCliFiles, setLoading]);

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
    if (geminiCliFiles.length === 0) {
      setGeminiCliQuota({});
      return;
    }
    setGeminiCliQuota((prev) => {
      const nextState: Record<string, GeminiCliQuotaState> = {};
      geminiCliFiles.forEach((file) => {
        const cached = prev[file.name];
        if (cached) {
          nextState[file.name] = cached;
        }
      });
      return nextState;
    });
  }, [geminiCliFiles, loading, setGeminiCliQuota]);

  return (
    <Card
      title={t('gemini_cli_quota.title')}
      extra={
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefreshPage}
            disabled={disabled || sectionLoading || pageItems.length === 0}
            loading={sectionLoading && loadingScope === 'page'}
          >
            {t('gemini_cli_quota.refresh_button')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefreshAll}
            disabled={disabled || sectionLoading || geminiCliFiles.length === 0}
            loading={sectionLoading && loadingScope === 'all'}
          >
            {t('gemini_cli_quota.fetch_all')}
          </Button>
        </div>
      }
    >
      {geminiCliFiles.length === 0 ? (
        <EmptyState
          title={t('gemini_cli_quota.empty_title')}
          description={t('gemini_cli_quota.empty_desc')}
        />
      ) : (
        <>
          <div className={styles.geminiCliControls}>
            <div className={styles.geminiCliControl}>
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
            <div className={styles.geminiCliControl}>
              <label>{t('common.info')}</label>
              <div className={styles.statsInfo}>
                {geminiCliFiles.length} {t('auth_files.files_count')}
              </div>
            </div>
          </div>
          <div className={styles.geminiCliGrid}>
            {pageItems.map((item) => (
              <GeminiCliCard
                key={item.name}
                item={item}
                quota={quota[item.name]}
                resolvedTheme={resolvedTheme}
                getQuotaErrorMessage={getQuotaErrorMessage}
              />
            ))}
          </div>
          {geminiCliFiles.length > pageSize && (
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
                  count: geminiCliFiles.length
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
