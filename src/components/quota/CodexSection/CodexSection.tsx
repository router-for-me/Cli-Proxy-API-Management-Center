/**
 * Codex quota section component.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useQuotaStore, useThemeStore } from '@/stores';
import type { CodexQuotaState, AuthFileItem, ResolvedTheme } from '@/types';
import { isCodexFile } from '@/utils/quota';
import { useQuotaSection } from '../hooks/useQuotaSection';
import { useCodexQuota } from './useCodexQuota';
import { CodexCard } from './CodexCard';
import styles from '@/pages/QuotaPage.module.scss';

interface CodexSectionProps {
  files: AuthFileItem[];
  loading: boolean;
  disabled: boolean;
}

export function CodexSection({ files, loading, disabled }: CodexSectionProps) {
  const { t } = useTranslation();
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setCodexQuota = useQuotaStore((state) => state.setCodexQuota);

  const codexFiles = useMemo(
    () => files.filter((file) => isCodexFile(file)),
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
  } = useQuotaSection({ items: codexFiles });

  const { quota, loadQuota } = useCodexQuota();

  const handleRefreshPage = useCallback(() => {
    loadQuota(pageItems, 'page', setLoading);
  }, [loadQuota, pageItems, setLoading]);

  const handleRefreshAll = useCallback(() => {
    loadQuota(codexFiles, 'all', setLoading);
  }, [loadQuota, codexFiles, setLoading]);

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
    if (codexFiles.length === 0) {
      setCodexQuota({});
      return;
    }
    setCodexQuota((prev) => {
      const nextState: Record<string, CodexQuotaState> = {};
      codexFiles.forEach((file) => {
        const cached = prev[file.name];
        if (cached) {
          nextState[file.name] = cached;
        }
      });
      return nextState;
    });
  }, [codexFiles, loading, setCodexQuota]);

  return (
    <Card
      title={t('codex_quota.title')}
      extra={
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefreshPage}
            disabled={disabled || sectionLoading || pageItems.length === 0}
            loading={sectionLoading && loadingScope === 'page'}
          >
            {t('codex_quota.refresh_button')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefreshAll}
            disabled={disabled || sectionLoading || codexFiles.length === 0}
            loading={sectionLoading && loadingScope === 'all'}
          >
            {t('codex_quota.fetch_all')}
          </Button>
        </div>
      }
    >
      {codexFiles.length === 0 ? (
        <EmptyState
          title={t('codex_quota.empty_title')}
          description={t('codex_quota.empty_desc')}
        />
      ) : (
        <>
          <div className={styles.codexControls}>
            <div className={styles.codexControl}>
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
            <div className={styles.codexControl}>
              <label>{t('common.info')}</label>
              <div className={styles.statsInfo}>
                {codexFiles.length} {t('auth_files.files_count')}
              </div>
            </div>
          </div>
          <div className={styles.codexGrid}>
            {pageItems.map((item) => (
              <CodexCard
                key={item.name}
                item={item}
                quota={quota[item.name]}
                resolvedTheme={resolvedTheme}
                getQuotaErrorMessage={getQuotaErrorMessage}
              />
            ))}
          </div>
          {codexFiles.length > pageSize && (
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
                  count: codexFiles.length
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
