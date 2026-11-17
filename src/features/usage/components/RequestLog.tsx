import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import type { ApiKeyRequestEntry } from '@/services/api/apiKeyPolicyUsage';
import { formatCompactNumber, maskApiKey } from '@/utils/format';
import { filterRequests, tokensPerSecond } from '../requestLogModel';
import styles from './RequestLog.module.scss';

const PREFIX = 'usage_page';
const ALL = '__all__';
const PAGE_SIZES = [25, 50, 100];

interface RequestLogProps {
  entries: ApiKeyRequestEntry[];
  /** Restricts the log to one client key (the page's key filter); empty shows all. */
  scopeKey: string;
  /** False when the backend has no request log endpoint. */
  available: boolean;
}

const formatMs = (ms: number) =>
  ms <= 0
    ? '—'
    : ms < 1000
      ? `${Math.round(ms)}ms`
      : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;

const formatCost = (value: number) =>
  value <= 0 ? '—' : `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;

export function RequestLog({ entries, scopeKey, available }: RequestLogProps) {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');
  const [model, setModel] = useState(ALL);
  const [account, setAccount] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0]);
  const [page, setPage] = useState(0);

  const scoped = useMemo(
    () => (scopeKey ? entries.filter((entry) => entry.key === scopeKey) : entries),
    [entries, scopeKey]
  );
  const modelOptions = useMemo(
    () => [
      { value: ALL, label: t(`${PREFIX}.log_all_models`) },
      ...[...new Set(scoped.map((e) => e.model))].sort().map((m) => ({ value: m, label: m })),
    ],
    [scoped, t]
  );
  const accountOptions = useMemo(() => {
    const names = new Map<string, string>();
    scoped.forEach((e) => e.authId && names.set(e.authId, e.accountName || e.authId));
    return [
      { value: ALL, label: t(`${PREFIX}.log_all_accounts`) },
      ...[...names.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [scoped, t]);
  const statusOptions = [
    { value: ALL, label: t(`${PREFIX}.log_all_statuses`) },
    { value: 'ok', label: t(`${PREFIX}.log_status_ok`) },
    { value: 'error', label: t(`${PREFIX}.log_status_error`) },
  ];

  const rows = useMemo(
    () =>
      filterRequests(scoped, {
        key: '',
        model: model === ALL ? '' : model,
        account: account === ALL ? '' : account,
        status: status === ALL ? '' : status,
        search,
      }),
    [scoped, model, account, status, search]
  );
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * pageSize, (current + 1) * pageSize);
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    [i18n.resolvedLanguage]
  );
  const change =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(0);
    };

  if (!available) return <p className={styles.empty}>{t(`${PREFIX}.log_unavailable`)}</p>;

  return (
    <div className={styles.wrap}>
      <div className={styles.filters}>
        <input
          type="search"
          className={styles.search}
          value={search}
          placeholder={t(`${PREFIX}.log_search`)}
          aria-label={t(`${PREFIX}.log_search`)}
          onChange={(event) => change(setSearch)(event.target.value)}
        />
        <div className={styles.select}>
          <Select
            value={account}
            options={accountOptions}
            onChange={change(setAccount)}
            ariaLabel={t(`${PREFIX}.log_col_account`)}
            size="sm"
          />
        </div>
        <div className={styles.select}>
          <Select
            value={model}
            options={modelOptions}
            onChange={change(setModel)}
            ariaLabel={t(`${PREFIX}.col_model`)}
            size="sm"
          />
        </div>
        <div className={styles.selectNarrow}>
          <Select
            value={status}
            options={statusOptions}
            onChange={change(setStatus)}
            ariaLabel={t(`${PREFIX}.log_col_status`)}
            size="sm"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty}>
          {scoped.length === 0 ? t(`${PREFIX}.log_empty`) : t(`${PREFIX}.log_no_match`)}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(`${PREFIX}.log_col_time`)}</TableHead>
              <TableHead>{t(`${PREFIX}.log_col_account`)}</TableHead>
              <TableHead>{t(`${PREFIX}.log_col_key`)}</TableHead>
              <TableHead>{t(`${PREFIX}.col_model`)}</TableHead>
              <TableHead>{t(`${PREFIX}.col_effort`)}</TableHead>
              <TableHead>{t(`${PREFIX}.log_col_transport`)}</TableHead>
              <TableHead>{t(`${PREFIX}.log_col_status`)}</TableHead>
              <TableHead alignRight>TTFT</TableHead>
              <TableHead alignRight>{t(`${PREFIX}.log_col_duration`)}</TableHead>
              <TableHead alignRight>TPS</TableHead>
              <TableHead alignRight>{t(`${PREFIX}.metric_tokens`)}</TableHead>
              <TableHead alignRight>{t(`${PREFIX}.col_cost`)}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((entry, index) => {
              const tps = tokensPerSecond(entry);
              return (
                <TableRow key={`${entry.time}-${entry.requestId}-${index}`}>
                  <TableCell className={styles.nowrap} title={entry.requestId || undefined}>
                    {timeFormat.format(new Date(entry.time))}
                  </TableCell>
                  <TableCell>
                    <div className={styles.account} title={entry.accountName}>
                      {entry.accountName || '—'}
                    </div>
                    {entry.plan && <div className={styles.sub}>{entry.plan}</div>}
                  </TableCell>
                  <TableCell className={styles.nowrap}>
                    {entry.keyName || (entry.key ? maskApiKey(entry.key) : '—')}
                  </TableCell>
                  <TableCell className={styles.mono}>{entry.model}</TableCell>
                  <TableCell className={styles.nowrap}>
                    {entry.effort === 'default' ? (
                      <span className={styles.sub}>{t(`${PREFIX}.dim_default`)}</span>
                    ) : (
                      entry.effort || '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={styles.pill}>{entry.stream ? 'SSE' : 'HTTP'}</span>
                  </TableCell>
                  <TableCell>
                    <span className={entry.failed ? styles.pillBad : styles.pillOk}>
                      {entry.failed
                        ? entry.statusCode || t(`${PREFIX}.log_status_error`)
                        : t(`${PREFIX}.log_status_ok`)}
                    </span>
                  </TableCell>
                  <TableCell alignRight className={styles.num}>
                    {formatMs(entry.ttftMs)}
                  </TableCell>
                  <TableCell alignRight className={styles.num}>
                    {formatMs(entry.latencyMs)}
                  </TableCell>
                  <TableCell alignRight className={styles.num}>
                    {tps > 0 ? tps.toFixed(tps < 10 ? 1 : 0) : '—'}
                  </TableCell>
                  <TableCell alignRight className={styles.num}>
                    <div title={entry.tokens.toLocaleString()}>
                      {entry.tokens > 0 ? formatCompactNumber(entry.tokens) : '0'}
                    </div>
                    {entry.cachedTokens > 0 && (
                      <div className={styles.sub}>
                        {t(`${PREFIX}.log_cached`, {
                          value: formatCompactNumber(entry.cachedTokens),
                        })}
                      </div>
                    )}
                  </TableCell>
                  <TableCell alignRight className={styles.num}>
                    {formatCost(entry.cost)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <div className={styles.pager}>
        <span>
          {t(`${PREFIX}.log_range`, {
            from: rows.length === 0 ? 0 : current * pageSize + 1,
            to: Math.min((current + 1) * pageSize, rows.length),
            total: rows.length,
          })}
        </span>
        <div className={styles.selectTiny}>
          <Select
            value={String(pageSize)}
            options={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
            onChange={(value) => change(setPageSize)(Number(value))}
            ariaLabel={t(`${PREFIX}.log_rows`)}
            size="sm"
          />
        </div>
        <button
          type="button"
          className={styles.pageButton}
          disabled={current === 0}
          onClick={() => setPage(current - 1)}
        >
          {t(`${PREFIX}.log_prev`)}
        </button>
        <button
          type="button"
          className={styles.pageButton}
          disabled={current >= pages - 1}
          onClick={() => setPage(current + 1)}
        >
          {t(`${PREFIX}.log_next`)}
        </button>
      </div>
    </div>
  );
}
