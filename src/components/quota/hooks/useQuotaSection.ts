/**
 * Shared hook for quota section pagination and loading state management.
 */

import { useState, useMemo, useCallback } from 'react';

interface UseQuotaSectionOptions<T> {
  items: T[];
  defaultPageSize?: number;
}

interface UseQuotaSectionReturn<T> {
  page: number;
  pageSize: number;
  totalPages: number;
  currentPage: number;
  pageItems: T[];
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  goToPrev: () => void;
  goToNext: () => void;
  loading: boolean;
  loadingScope: 'page' | 'all' | null;
  setLoading: (loading: boolean, scope?: 'page' | 'all' | null) => void;
}

export function useQuotaSection<T>(
  options: UseQuotaSectionOptions<T>
): UseQuotaSectionReturn<T> {
  const { items, defaultPageSize = 6 } = options;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);
  const [loading, setLoadingState] = useState(false);
  const [loadingScope, setLoadingScope] = useState<'page' | 'all' | null>(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(items.length / pageSize)),
    [items.length, pageSize]
  );

  const currentPage = useMemo(
    () => Math.min(page, totalPages),
    [page, totalPages]
  );

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  const handleSetPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setPage(1);
  }, []);

  const goToPrev = useCallback(() => {
    setPage((p) => Math.max(1, p - 1));
  }, []);

  const goToNext = useCallback(() => {
    setPage((p) => Math.min(totalPages, p + 1));
  }, [totalPages]);

  const setLoading = useCallback(
    (isLoading: boolean, scope?: 'page' | 'all' | null) => {
      setLoadingState(isLoading);
      setLoadingScope(isLoading ? (scope ?? null) : null);
    },
    []
  );

  return {
    page,
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPage,
    setPageSize: handleSetPageSize,
    goToPrev,
    goToNext,
    loading,
    loadingScope,
    setLoading
  };
}
