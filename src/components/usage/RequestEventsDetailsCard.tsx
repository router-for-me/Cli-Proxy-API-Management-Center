import { type CSSProperties, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import { authFilesApi } from '@/services/api/authFiles';
import { useAuthStore } from '@/stores';
import type { GeminiKeyConfig, ProviderKeyConfig, OpenAIProviderConfig } from '@/types';
import type { AuthFileItem } from '@/types/authFile';
import type { CredentialInfo } from '@/types/sourceInfo';
import { buildSourceInfoMap, resolveSourceDisplay } from '@/utils/sourceResolver';
import { parseTimestampMs } from '@/utils/timestamp';
import {
  collectUsageDetails,
  extractLatencyMs,
  extractTotalTokens,
  formatDurationMs,
  LATENCY_SOURCE_FIELD,
  normalizeAuthIndex,
} from '@/utils/usage';
import { downloadBlob } from '@/utils/download';
import { useLiveUsageRefresh } from './hooks/useLiveUsageRefresh';
import styles from '@/pages/UsagePage.module.scss';

const ALL_FILTER = '__all__';
const MAX_RENDERED_EVENTS = 500;
const EMPTY_AUTH_FILE_MAP = new Map<string, CredentialInfo>();

type RequestEventRow = {
  id: string;
  timestamp: string;
  timestampMs: number;
  timestampLabel: string;
  model: string;
  sourceKey: string;
  sourceRaw: string;
  source: string;
  sourceType: string;
  authIndex: string;
  failed: boolean;
  latencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
};

type RequestEventBaseRow = Omit<RequestEventRow, 'id'> & {
  eventFingerprint: string;
};

export interface RequestEventsDetailsCardProps {
  usage: unknown;
  loading: boolean;
  geminiKeys: GeminiKeyConfig[];
  claudeConfigs: ProviderKeyConfig[];
  codexConfigs: ProviderKeyConfig[];
  vertexConfigs: ProviderKeyConfig[];
  openaiProviders: OpenAIProviderConfig[];
  compact?: boolean;
  maxRows?: number;
  liveRefresh?: boolean;
  cardClassName?: string;
}

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const encodeCsv = (value: string | number): string => {
  const text = String(value ?? '');
  const trimmedLeft = text.replace(/^\s+/, '');
  const safeText = trimmedLeft && /^[=+\-@]/.test(trimmedLeft) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
};

const buildRequestEventFingerprint = (parts: Array<string | number | boolean | null>) =>
  JSON.stringify(parts);

type RequestEventIdentitySnapshot = {
  scopeKey: string;
  nextInstanceId: number;
  idsByFingerprint: Map<string, string[]>;
};

const createRequestEventIdentitySnapshot = (scopeKey: string): RequestEventIdentitySnapshot => ({
  scopeKey,
  nextInstanceId: 0,
  idsByFingerprint: new Map<string, string[]>(),
});
const requestEventIdentitySnapshotCache = new Map<string, RequestEventIdentitySnapshot>();

const buildStableRequestEventRows = (
  baseRows: RequestEventBaseRow[],
  snapshot: RequestEventIdentitySnapshot,
  scopeKey: string
) => {
  const activeSnapshot =
    snapshot.scopeKey === scopeKey ? snapshot : createRequestEventIdentitySnapshot(scopeKey);
  const previousQueues = new Map(
    Array.from(activeSnapshot.idsByFingerprint.entries(), ([fingerprint, ids]) => [
      fingerprint,
      [...ids],
    ])
  );
  const previousCounts = new Map(
    Array.from(activeSnapshot.idsByFingerprint.entries(), ([fingerprint, ids]) => [
      fingerprint,
      ids.length,
    ])
  );
  const nextCounts = new Map<string, number>();

  baseRows.forEach((row) => {
    nextCounts.set(row.eventFingerprint, (nextCounts.get(row.eventFingerprint) ?? 0) + 1);
  });

  let nextInstanceId = activeSnapshot.nextInstanceId;
  const assignedCounts = new Map<string, number>();
  const nextIdsByFingerprint = new Map<string, string[]>();

  const rows: RequestEventRow[] = baseRows.map(({ eventFingerprint, ...row }) => {
    const assignedCount = assignedCounts.get(eventFingerprint) ?? 0;
    const previousCount = previousCounts.get(eventFingerprint) ?? 0;
    const nextCount = nextCounts.get(eventFingerprint) ?? 0;
    const leadingNewCount = Math.max(0, nextCount - previousCount);

    let id: string | undefined;
    if (assignedCount < leadingNewCount) {
      id = `usage-event:${nextInstanceId}`;
      nextInstanceId += 1;
    } else {
      id = previousQueues.get(eventFingerprint)?.shift();
    }

    if (!id) {
      id = `usage-event:${nextInstanceId}`;
      nextInstanceId += 1;
    }

    assignedCounts.set(eventFingerprint, assignedCount + 1);

    const ids = nextIdsByFingerprint.get(eventFingerprint) ?? [];
    ids.push(id);
    nextIdsByFingerprint.set(eventFingerprint, ids);

    return {
      ...row,
      id,
    };
  });

  return {
    rows,
    snapshot: {
      scopeKey,
      nextInstanceId,
      idsByFingerprint: nextIdsByFingerprint,
    },
  };
};

export function RequestEventsDetailsCard({
  usage,
  loading,
  geminiKeys,
  claudeConfigs,
  codexConfigs,
  vertexConfigs,
  openaiProviders,
  compact = false,
  maxRows = 5,
  liveRefresh = false,
  cardClassName,
}: RequestEventsDetailsCardProps) {
  const { t, i18n } = useTranslation();
  const authScopeKey = useAuthStore((state) => `${state.apiBase}::${state.managementKey}`);
  const requestEventsInstanceId = useId();
  const latencyHint = t('usage_stats.latency_unit_hint', {
    field: LATENCY_SOURCE_FIELD,
    unit: t('usage_stats.duration_unit_ms'),
  });
  const rowIdentityCacheKey = `${authScopeKey}::${requestEventsInstanceId}`;
  const committedRowIdentitySnapshot =
    requestEventIdentitySnapshotCache.get(rowIdentityCacheKey) ??
    createRequestEventIdentitySnapshot(authScopeKey);

  const [modelFilter, setModelFilter] = useState(ALL_FILTER);
  const [sourceFilter, setSourceFilter] = useState(ALL_FILTER);
  const [authIndexFilter, setAuthIndexFilter] = useState(ALL_FILTER);
  const [authFileMapState, setAuthFileMapState] = useState(() => ({
    scopeKey: authScopeKey,
    map: new Map<string, CredentialInfo>(),
  }));

  useEffect(() => {
    let cancelled = false;
    authFilesApi
      .list()
      .then((res) => {
        if (cancelled) return;
        const files = Array.isArray(res) ? res : (res as { files?: AuthFileItem[] })?.files;
        if (!Array.isArray(files)) return;
        const map = new Map<string, CredentialInfo>();
        files.forEach((file) => {
          const key = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
          if (!key) return;
          map.set(key, {
            name: file.name || key,
            type: (file.type || file.provider || '').toString(),
          });
        });
        setAuthFileMapState({
          scopeKey: authScopeKey,
          map,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authScopeKey]);

  const authFileMap = useMemo(
    () => (authFileMapState.scopeKey === authScopeKey ? authFileMapState.map : EMPTY_AUTH_FILE_MAP),
    [authFileMapState, authScopeKey]
  );

  const sourceInfoMap = useMemo(
    () =>
      buildSourceInfoMap({
        geminiApiKeys: geminiKeys,
        claudeApiKeys: claudeConfigs,
        codexApiKeys: codexConfigs,
        vertexApiKeys: vertexConfigs,
        openaiCompatibility: openaiProviders,
      }),
    [claudeConfigs, codexConfigs, geminiKeys, openaiProviders, vertexConfigs]
  );

  const baseRows = useMemo<RequestEventBaseRow[]>(() => {
    const details = collectUsageDetails(usage);

    const mappedRows: RequestEventBaseRow[] = details.map((detail) => {
      const timestamp = detail.timestamp;
      const timestampMs =
        typeof detail.__timestampMs === 'number' && detail.__timestampMs > 0
          ? detail.__timestampMs
          : parseTimestampMs(timestamp);
      const date = Number.isNaN(timestampMs) ? null : new Date(timestampMs);
      const sourceRaw = String(detail.source ?? '').trim();
      const authIndexRaw = detail.auth_index as unknown;
      const authIndex =
        authIndexRaw === null || authIndexRaw === undefined || authIndexRaw === ''
          ? '-'
          : String(authIndexRaw);
      const sourceInfo = resolveSourceDisplay(sourceRaw, authIndexRaw, sourceInfoMap, authFileMap);
      const source = sourceInfo.displayName;
      const sourceKey = sourceInfo.identityKey ?? `source:${sourceRaw || source}`;
      const sourceType = sourceInfo.type;
      const model = String(detail.__modelName ?? '').trim() || '-';
      const inputTokens = Math.max(toNumber(detail.tokens?.input_tokens), 0);
      const outputTokens = Math.max(toNumber(detail.tokens?.output_tokens), 0);
      const reasoningTokens = Math.max(toNumber(detail.tokens?.reasoning_tokens), 0);
      const cachedTokens = Math.max(
        Math.max(toNumber(detail.tokens?.cached_tokens), 0),
        Math.max(toNumber(detail.tokens?.cache_tokens), 0)
      );
      const totalTokens = Math.max(
        toNumber(detail.tokens?.total_tokens),
        extractTotalTokens(detail)
      );
      const latencyMs = extractLatencyMs(detail);
      const eventFingerprint = buildRequestEventFingerprint([
        Number.isNaN(timestampMs) ? 0 : timestampMs,
        timestamp || '',
        model,
        sourceRaw || '-',
        authIndex,
        detail.failed === true,
        latencyMs ?? '',
        inputTokens,
        outputTokens,
        reasoningTokens,
        cachedTokens,
        totalTokens,
      ]);

      return {
        timestamp,
        timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        timestampLabel: date ? date.toLocaleString(i18n.language) : timestamp || '-',
        model,
        sourceKey,
        sourceRaw: sourceRaw || '-',
        source,
        sourceType,
        authIndex,
        failed: detail.failed === true,
        latencyMs,
        inputTokens,
        outputTokens,
        reasoningTokens,
        cachedTokens,
        totalTokens,
        eventFingerprint,
      };
    });

    const sourceLabelKeyMap = new Map<string, Set<string>>();
    mappedRows.forEach((row) => {
      const keys = sourceLabelKeyMap.get(row.source) ?? new Set<string>();
      keys.add(row.sourceKey);
      sourceLabelKeyMap.set(row.source, keys);
    });

    const buildDisambiguatedSourceLabel = (row: RequestEventBaseRow) => {
      const labelKeyCount = sourceLabelKeyMap.get(row.source)?.size ?? 0;
      if (labelKeyCount <= 1) {
        return row.source;
      }

      if (row.authIndex !== '-') {
        return `${row.source} · ${row.authIndex}`;
      }

      if (row.sourceRaw !== '-' && row.sourceRaw !== row.source) {
        return `${row.source} · ${row.sourceRaw}`;
      }

      if (row.sourceType) {
        return `${row.source} · ${row.sourceType}`;
      }

      return `${row.source} · ${row.sourceKey}`;
    };

    return mappedRows
      .map((row) => ({
        ...row,
        source: buildDisambiguatedSourceLabel(row),
      }))
      .sort((a, b) => {
        if (b.timestampMs !== a.timestampMs) return b.timestampMs - a.timestampMs;
        if (a.timestamp !== b.timestamp) return b.timestamp.localeCompare(a.timestamp);
        if (a.model !== b.model) return a.model.localeCompare(b.model);
        if (a.sourceRaw !== b.sourceRaw) return a.sourceRaw.localeCompare(b.sourceRaw);
        if (a.authIndex !== b.authIndex) return a.authIndex.localeCompare(b.authIndex);
        if (a.failed !== b.failed) return Number(a.failed) - Number(b.failed);
        if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
        return a.eventFingerprint.localeCompare(b.eventFingerprint);
      });
  }, [authFileMap, i18n.language, sourceInfoMap, usage]);

  const rowIdentityDraft = useMemo(
    () => buildStableRequestEventRows(baseRows, committedRowIdentitySnapshot, authScopeKey),
    [authScopeKey, baseRows, committedRowIdentitySnapshot]
  );

  useEffect(() => {
    requestEventIdentitySnapshotCache.set(rowIdentityCacheKey, rowIdentityDraft.snapshot);

    return () => {
      requestEventIdentitySnapshotCache.delete(rowIdentityCacheKey);
    };
  }, [rowIdentityCacheKey, rowIdentityDraft.snapshot]);

  const rows = rowIdentityDraft.rows;

  const hasLatencyData = useMemo(() => rows.some((row) => row.latencyMs !== null), [rows]);

  const modelOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(new Set(rows.map((row) => row.model))).map((model) => ({
        value: model,
        label: model,
      })),
    ],
    [rows, t]
  );

  const sourceOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    rows.forEach((row) => {
      if (!optionMap.has(row.sourceKey)) {
        optionMap.set(row.sourceKey, row.source);
      }
    });

    return [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(optionMap.entries()).map(([value, label]) => ({
        value,
        label,
      })),
    ];
  }, [rows, t]);

  const authIndexOptions = useMemo(
    () => [
      { value: ALL_FILTER, label: t('usage_stats.filter_all') },
      ...Array.from(new Set(rows.map((row) => row.authIndex))).map((authIndex) => ({
        value: authIndex,
        label: authIndex,
      })),
    ],
    [rows, t]
  );

  const modelOptionSet = useMemo(
    () => new Set(modelOptions.map((option) => option.value)),
    [modelOptions]
  );
  const sourceOptionSet = useMemo(
    () => new Set(sourceOptions.map((option) => option.value)),
    [sourceOptions]
  );
  const authIndexOptionSet = useMemo(
    () => new Set(authIndexOptions.map((option) => option.value)),
    [authIndexOptions]
  );

  const effectiveModelFilter = modelOptionSet.has(modelFilter) ? modelFilter : ALL_FILTER;
  const effectiveSourceFilter = sourceOptionSet.has(sourceFilter) ? sourceFilter : ALL_FILTER;
  const effectiveAuthIndexFilter = authIndexOptionSet.has(authIndexFilter)
    ? authIndexFilter
    : ALL_FILTER;

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const modelMatched =
          effectiveModelFilter === ALL_FILTER || row.model === effectiveModelFilter;
        const sourceMatched =
          effectiveSourceFilter === ALL_FILTER || row.sourceKey === effectiveSourceFilter;
        const authIndexMatched =
          effectiveAuthIndexFilter === ALL_FILTER || row.authIndex === effectiveAuthIndexFilter;
        return modelMatched && sourceMatched && authIndexMatched;
      }),
    [effectiveAuthIndexFilter, effectiveModelFilter, effectiveSourceFilter, rows]
  );

  const renderLimit = compact ? Math.max(1, maxRows) : MAX_RENDERED_EVENTS;
  const renderedRows = useMemo(
    () => filteredRows.slice(0, renderLimit),
    [filteredRows, renderLimit]
  );

  const liveRefreshRows = useMemo(
    () =>
      rows.map((row) => ({
        id: row.id,
        authIndex: row.authIndex,
        timestampMs: row.timestampMs,
      })),
    [rows]
  );

  const { highlightedIds } = useLiveUsageRefresh({
    enabled: liveRefresh,
    rows: liveRefreshRows,
  });

  const hasActiveFilters =
    effectiveModelFilter !== ALL_FILTER ||
    effectiveSourceFilter !== ALL_FILTER ||
    effectiveAuthIndexFilter !== ALL_FILTER;

  const handleClearFilters = () => {
    setModelFilter(ALL_FILTER);
    setSourceFilter(ALL_FILTER);
    setAuthIndexFilter(ALL_FILTER);
  };

  const handleExportCsv = () => {
    if (!filteredRows.length) return;

    const csvHeader = [
      'timestamp',
      'model',
      'source',
      'source_raw',
      'auth_index',
      'result',
      ...(hasLatencyData ? ['latency_ms'] : []),
      'input_tokens',
      'output_tokens',
      'reasoning_tokens',
      'cached_tokens',
      'total_tokens',
    ];

    const csvRows = filteredRows.map((row) =>
      [
        row.timestamp,
        row.model,
        row.source,
        row.sourceRaw,
        row.authIndex,
        row.failed ? 'failed' : 'success',
        ...(hasLatencyData ? [row.latencyMs ?? ''] : []),
        row.inputTokens,
        row.outputTokens,
        row.reasoningTokens,
        row.cachedTokens,
        row.totalTokens,
      ]
        .map((value) => encodeCsv(value))
        .join(',')
    );

    const content = [csvHeader.join(','), ...csvRows].join('\n');
    const fileTime = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob({
      filename: `usage-events-${fileTime}.csv`,
      blob: new Blob([content], { type: 'text/csv;charset=utf-8' }),
    });
  };

  const handleExportJson = () => {
    if (!filteredRows.length) return;

    const payload = filteredRows.map((row) => ({
      timestamp: row.timestamp,
      model: row.model,
      source: row.source,
      source_raw: row.sourceRaw,
      auth_index: row.authIndex,
      failed: row.failed,
      ...(hasLatencyData && row.latencyMs !== null ? { latency_ms: row.latencyMs } : {}),
      tokens: {
        input_tokens: row.inputTokens,
        output_tokens: row.outputTokens,
        reasoning_tokens: row.reasoningTokens,
        cached_tokens: row.cachedTokens,
        total_tokens: row.totalTokens,
      },
    }));

    const content = JSON.stringify(payload, null, 2);
    const fileTime = new Date().toISOString().replace(/[:.]/g, '-');
    downloadBlob({
      filename: `usage-events-${fileTime}.json`,
      blob: new Blob([content], { type: 'application/json;charset=utf-8' }),
    });
  };

  const baseRowStyle: CSSProperties = {
    backgroundColor: 'transparent',
    boxShadow: 'inset 0 0 0 rgba(34, 197, 94, 0)',
    transition: 'background-color 420ms ease, box-shadow 420ms ease',
  };

  const highlightedRowStyle: CSSProperties = {
    ...baseRowStyle,
    backgroundColor: 'rgba(34, 197, 94, 0.14)',
    boxShadow: 'inset 3px 0 0 rgba(34, 197, 94, 0.82)',
  };

  const compactCellBaseStyle: CSSProperties | undefined = compact
    ? {
        padding: '5px 8px',
        fontSize: '12px',
        lineHeight: 1.25,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }
    : undefined;

  const getCompactColumnStyle = (index: number): CSSProperties | undefined => {
    if (!compact) {
      return undefined;
    }

    switch (index) {
      case 0:
        return { width: '112px', minWidth: '112px', maxWidth: '112px' };
      case 1:
        return { width: '84px', minWidth: '84px', maxWidth: '84px' };
      case 2:
        return { width: '340px', minWidth: '340px', maxWidth: '340px' };
      case 3:
        return { width: '120px', minWidth: '120px', maxWidth: '120px' };
      case 4:
        return { width: '80px', minWidth: '80px', maxWidth: '80px' };
      default:
        return { width: '72px', minWidth: '72px', maxWidth: '72px' };
    }
  };

  return (
    <Card
      title={t('usage_stats.request_events_title')}
      className={cardClassName}
      extra={
        !compact ? (
          <div className={styles.requestEventsActions}>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearFilters}
              disabled={!hasActiveFilters}
            >
              {t('usage_stats.clear_filters')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportCsv}
              disabled={filteredRows.length === 0}
            >
              {t('usage_stats.export_csv')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportJson}
              disabled={filteredRows.length === 0}
            >
              {t('usage_stats.export_json')}
            </Button>
          </div>
        ) : undefined
      }
    >
      {!compact && (
        <div className={styles.requestEventsToolbar}>
          <div className={styles.requestEventsFilterItem}>
            <span className={styles.requestEventsFilterLabel}>
              {t('usage_stats.request_events_filter_model')}
            </span>
            <Select
              value={effectiveModelFilter}
              options={modelOptions}
              onChange={setModelFilter}
              className={styles.requestEventsSelect}
              ariaLabel={t('usage_stats.request_events_filter_model')}
              fullWidth={false}
            />
          </div>
          <div className={styles.requestEventsFilterItem}>
            <span className={styles.requestEventsFilterLabel}>
              {t('usage_stats.request_events_filter_source')}
            </span>
            <Select
              value={effectiveSourceFilter}
              options={sourceOptions}
              onChange={setSourceFilter}
              className={styles.requestEventsSelect}
              ariaLabel={t('usage_stats.request_events_filter_source')}
              fullWidth={false}
            />
          </div>
          <div className={styles.requestEventsFilterItem}>
            <span className={styles.requestEventsFilterLabel}>
              {t('usage_stats.request_events_filter_auth_index')}
            </span>
            <Select
              value={effectiveAuthIndexFilter}
              options={authIndexOptions}
              onChange={setAuthIndexFilter}
              className={styles.requestEventsSelect}
              ariaLabel={t('usage_stats.request_events_filter_auth_index')}
              fullWidth={false}
            />
          </div>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('usage_stats.request_events_empty_title')}
          description={t('usage_stats.request_events_empty_desc')}
        />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          title={t('usage_stats.request_events_no_result_title')}
          description={t('usage_stats.request_events_no_result_desc')}
        />
      ) : (
        <>
          {!compact && (
            <div className={styles.requestEventsMeta}>
              <span>{t('usage_stats.request_events_count', { count: filteredRows.length })}</span>
              {hasLatencyData && (
                <span className={styles.requestEventsLimitHint}>{latencyHint}</span>
              )}
              {filteredRows.length > MAX_RENDERED_EVENTS && (
                <span className={styles.requestEventsLimitHint}>
                  {t('usage_stats.request_events_limit_hint', {
                    shown: MAX_RENDERED_EVENTS,
                    total: filteredRows.length,
                  })}
                </span>
              )}
            </div>
          )}

          <div
            className={styles.requestEventsTableWrapper}
            style={
              compact
                ? {
                    overflow: 'hidden',
                    maxHeight: 'none',
                  }
                : undefined
            }
          >
            <table
              className={styles.table}
              style={
                compact
                  ? {
                      width: '100%',
                      tableLayout: 'fixed',
                      borderCollapse: 'collapse',
                    }
                  : undefined
              }
            >
              <thead>
                <tr>
                  <th style={{ ...compactCellBaseStyle, ...getCompactColumnStyle(0) }}>
                    {t('usage_stats.request_events_timestamp')}
                  </th>
                  <th style={{ ...compactCellBaseStyle, ...getCompactColumnStyle(1) }}>
                    {t('usage_stats.model_name')}
                  </th>
                  <th style={{ ...compactCellBaseStyle, ...getCompactColumnStyle(2) }}>
                    {t('usage_stats.request_events_source')}
                  </th>
                  <th style={{ ...compactCellBaseStyle, ...getCompactColumnStyle(3) }}>
                    {t('usage_stats.request_events_auth_index')}
                  </th>
                  <th style={{ ...compactCellBaseStyle, ...getCompactColumnStyle(4) }}>
                    {t('usage_stats.request_events_result')}
                  </th>
                  {hasLatencyData && (
                    <th
                      title={latencyHint}
                      style={{ ...compactCellBaseStyle, ...getCompactColumnStyle(5) }}
                    >
                      {t('usage_stats.time')}
                    </th>
                  )}
                  <th
                    style={{
                      ...compactCellBaseStyle,
                      ...getCompactColumnStyle(hasLatencyData ? 6 : 5),
                    }}
                  >
                    {t('usage_stats.input_tokens')}
                  </th>
                  <th
                    style={{
                      ...compactCellBaseStyle,
                      ...getCompactColumnStyle(hasLatencyData ? 7 : 6),
                    }}
                  >
                    {t('usage_stats.output_tokens')}
                  </th>
                  <th
                    style={{
                      ...compactCellBaseStyle,
                      ...getCompactColumnStyle(hasLatencyData ? 8 : 7),
                    }}
                  >
                    {t('usage_stats.reasoning_tokens')}
                  </th>
                  <th
                    style={{
                      ...compactCellBaseStyle,
                      ...getCompactColumnStyle(hasLatencyData ? 9 : 8),
                    }}
                  >
                    {t('usage_stats.cached_tokens')}
                  </th>
                  <th
                    style={{
                      ...compactCellBaseStyle,
                      ...getCompactColumnStyle(hasLatencyData ? 10 : 9),
                    }}
                  >
                    {t('usage_stats.total_tokens')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {renderedRows.map((row) => (
                  <tr
                    key={row.id}
                    style={highlightedIds.has(row.id) ? highlightedRowStyle : baseRowStyle}
                  >
                    <td
                      title={row.timestamp}
                      className={styles.requestEventsTimestamp}
                      style={{ ...compactCellBaseStyle, ...getCompactColumnStyle(0) }}
                    >
                      {row.timestampLabel}
                    </td>
                    <td
                      className={styles.modelCell}
                      style={{ ...compactCellBaseStyle, ...getCompactColumnStyle(1) }}
                    >
                      {row.model}
                    </td>
                    <td
                      className={
                        compact
                          ? `${styles.requestEventsSourceCell} ${styles.requestEventsCompactSourceCell}`
                          : styles.requestEventsSourceCell
                      }
                      title={row.source}
                      style={
                        compact
                          ? {
                              ...compactCellBaseStyle,
                              ...getCompactColumnStyle(2),
                              minWidth: 0,
                            }
                          : undefined
                      }
                    >
                      {compact ? (
                        <div className={styles.requestEventsCompactSourceContent}>
                          <span className={styles.requestEventsCompactSourceText}>
                            {row.source}
                          </span>
                          {row.sourceType && (
                            <span
                              className={styles.credentialType}
                              style={{ flexShrink: 0, marginLeft: 0 }}
                            >
                              {row.sourceType}
                            </span>
                          )}
                        </div>
                      ) : (
                        <>
                          <span>{row.source}</span>
                          {row.sourceType && (
                            <span className={styles.credentialType}>{row.sourceType}</span>
                          )}
                        </>
                      )}
                    </td>
                    <td
                      className={
                        compact
                          ? `${styles.requestEventsAuthIndex} ${styles.requestEventsCompactAuthIndex}`
                          : styles.requestEventsAuthIndex
                      }
                      title={row.authIndex}
                      style={{ ...compactCellBaseStyle, ...getCompactColumnStyle(3) }}
                    >
                      {row.authIndex}
                    </td>
                    <td style={{ ...compactCellBaseStyle, ...getCompactColumnStyle(4) }}>
                      <span
                        className={
                          row.failed
                            ? styles.requestEventsResultFailed
                            : styles.requestEventsResultSuccess
                        }
                      >
                        {row.failed ? t('stats.failure') : t('stats.success')}
                      </span>
                    </td>
                    {hasLatencyData && (
                      <td
                        className={styles.durationCell}
                        style={{ ...compactCellBaseStyle, ...getCompactColumnStyle(5) }}
                      >
                        {formatDurationMs(row.latencyMs)}
                      </td>
                    )}
                    <td
                      style={{
                        ...compactCellBaseStyle,
                        ...getCompactColumnStyle(hasLatencyData ? 6 : 5),
                      }}
                    >
                      {row.inputTokens.toLocaleString()}
                    </td>
                    <td
                      style={{
                        ...compactCellBaseStyle,
                        ...getCompactColumnStyle(hasLatencyData ? 7 : 6),
                      }}
                    >
                      {row.outputTokens.toLocaleString()}
                    </td>
                    <td
                      style={{
                        ...compactCellBaseStyle,
                        ...getCompactColumnStyle(hasLatencyData ? 8 : 7),
                      }}
                    >
                      {row.reasoningTokens.toLocaleString()}
                    </td>
                    <td
                      style={{
                        ...compactCellBaseStyle,
                        ...getCompactColumnStyle(hasLatencyData ? 9 : 8),
                      }}
                    >
                      {row.cachedTokens.toLocaleString()}
                    </td>
                    <td
                      style={{
                        ...compactCellBaseStyle,
                        ...getCompactColumnStyle(hasLatencyData ? 10 : 9),
                      }}
                    >
                      {row.totalTokens.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
