import { useEffect, useMemo } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import type { HttpMethod, ParsedLogLine, StatusGroup } from './logTypes';
import { resolveStatusGroup } from './logTypes';

const PATH_FILTER_LIMIT = 12;

interface UseLogFiltersOptions {
  parsedLines: ParsedLogLine[];
}

interface UseLogFiltersReturn {
  methodFilters: HttpMethod[];
  statusFilters: StatusGroup[];
  pathFilters: string[];
  latencyMinMs: string;
  latencyMaxMs: string;
  latencyMinValue?: number;
  latencyMaxValue?: number;
  methodFilterSet: Set<HttpMethod>;
  statusFilterSet: Set<StatusGroup>;
  pathFilterSet: Set<string>;
  hasLatencyFilter: boolean;
  hasStructuredFilters: boolean;
  methodCounts: Partial<Record<HttpMethod, number>>;
  statusCounts: Partial<Record<StatusGroup, number>>;
  pathOptions: Array<{ path: string; count: number }>;
  setLatencyMinMs: (value: string) => void;
  setLatencyMaxMs: (value: string) => void;
  toggleMethodFilter: (method: HttpMethod) => void;
  toggleStatusFilter: (group: StatusGroup) => void;
  togglePathFilter: (path: string) => void;
  clearLatencyFilter: () => void;
  clearStructuredFilters: () => void;
}

const parseLatencyBoundary = (value: string): number | undefined => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

export function useLogFilters(options: UseLogFiltersOptions): UseLogFiltersReturn {
  const { parsedLines } = options;

  const [methodFilters, setMethodFilters] = useLocalStorage<HttpMethod[]>(
    'logsPage.methodFilters',
    []
  );
  const [statusFilters, setStatusFilters] = useLocalStorage<StatusGroup[]>(
    'logsPage.statusFilters',
    []
  );
  const [pathFilters, setPathFilters] = useLocalStorage<string[]>('logsPage.pathFilters', []);
  const [latencyMinMs, setLatencyMinMs] = useLocalStorage('logsPage.latencyMinMs', '');
  const [latencyMaxMs, setLatencyMaxMs] = useLocalStorage('logsPage.latencyMaxMs', '');

  const methodFilterSet = useMemo(() => new Set(methodFilters), [methodFilters]);
  const statusFilterSet = useMemo(() => new Set(statusFilters), [statusFilters]);
  const pathFilterSet = useMemo(() => new Set(pathFilters), [pathFilters]);
  const latencyMinValue = useMemo(() => parseLatencyBoundary(latencyMinMs), [latencyMinMs]);
  const latencyMaxValue = useMemo(() => parseLatencyBoundary(latencyMaxMs), [latencyMaxMs]);
  const hasLatencyFilter = latencyMinValue !== undefined || latencyMaxValue !== undefined;
  const hasStructuredFilters =
    methodFilters.length > 0 || statusFilters.length > 0 || pathFilters.length > 0 || hasLatencyFilter;

  const methodCounts = useMemo(() => {
    const counts: Partial<Record<HttpMethod, number>> = {};
    parsedLines.forEach((line) => {
      if (!line.method) return;
      counts[line.method] = (counts[line.method] ?? 0) + 1;
    });
    return counts;
  }, [parsedLines]);

  const statusCounts = useMemo(() => {
    const counts: Partial<Record<StatusGroup, number>> = {};
    parsedLines.forEach((line) => {
      const statusGroup = resolveStatusGroup(line.statusCode);
      if (!statusGroup) return;
      counts[statusGroup] = (counts[statusGroup] ?? 0) + 1;
    });
    return counts;
  }, [parsedLines]);

  const pathOptions = useMemo(() => {
    const counts = new Map<string, number>();
    parsedLines.forEach((line) => {
      if (!line.path) return;
      counts.set(line.path, (counts.get(line.path) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, PATH_FILTER_LIMIT)
      .map(([path, count]) => ({ path, count }));
  }, [parsedLines]);

  useEffect(() => {
    if (parsedLines.length === 0) return;

    const validPathSet = new Set(pathOptions.map((item) => item.path));
    setPathFilters((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter((path) => validPathSet.has(path));
      return next.length === prev.length ? prev : next;
    });
  }, [parsedLines.length, pathOptions, setPathFilters]);

  const toggleMethodFilter = (method: HttpMethod) => {
    setMethodFilters((prev) =>
      prev.includes(method) ? prev.filter((item) => item !== method) : [...prev, method]
    );
  };

  const toggleStatusFilter = (group: StatusGroup) => {
    setStatusFilters((prev) =>
      prev.includes(group) ? prev.filter((item) => item !== group) : [...prev, group]
    );
  };

  const togglePathFilter = (path: string) => {
    setPathFilters((prev) =>
      prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]
    );
  };

  const clearLatencyFilter = () => {
    setLatencyMinMs('');
    setLatencyMaxMs('');
  };

  const clearStructuredFilters = () => {
    setMethodFilters([]);
    setStatusFilters([]);
    setPathFilters([]);
    clearLatencyFilter();
  };

  return {
    methodFilters,
    statusFilters,
    pathFilters,
    latencyMinMs,
    latencyMaxMs,
    latencyMinValue,
    latencyMaxValue,
    methodFilterSet,
    statusFilterSet,
    pathFilterSet,
    hasLatencyFilter,
    hasStructuredFilters,
    methodCounts,
    statusCounts,
    pathOptions,
    setLatencyMinMs,
    setLatencyMaxMs,
    toggleMethodFilter,
    toggleStatusFilter,
    togglePathFilter,
    clearLatencyFilter,
    clearStructuredFilters,
  };
}
