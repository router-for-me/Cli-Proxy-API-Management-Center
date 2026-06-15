/**
 * 日志相关 API
 */

import { apiClient } from './client';
import { LOGS_TIMEOUT_MS } from '@/utils/constants';
import { isRecord } from '@/utils/helpers';

export type LogCursor = number | string;
export type LogBackendKind = 'unknown' | 'file' | 'home-db';

export interface LogsQuery {
  after?: LogCursor;
  cursor?: string;
  limit?: number;
  offset?: number;
}

export interface CPALogsResponse {
  lines: string[];
  'line-count': number;
  'latest-timestamp': number;
}

export interface HomeLogRecord {
  id?: number;
  timestamp?: string | number;
  client_ip?: string;
  request_id?: string;
  home_ip?: string;
  level?: string;
  line?: string;
  created_at?: string | number;
}

export interface HomeLogsResponse {
  logs?: HomeLogRecord[];
  total?: number;
  limit?: number;
  offset?: number;
}

export interface LogsResponse {
  lines: string[];
  lineCount: number;
  latestAfter?: LogCursor;
  nextCursor?: string;
  cursorReset?: boolean;
  logBackendKind: LogBackendKind;
  requestLogHomeIpById?: Record<string, string>;
  total?: number;
  limit?: number;
  offset?: number;
}

export interface ErrorLogFile {
  name: string;
  size?: number;
  modified?: number;
}

export interface ErrorLogsResponse {
  files?: ErrorLogFile[];
}

const stringValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const numberValue = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const booleanValue = (value: unknown): boolean =>
  value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');

const positiveNumberValue = (value: unknown): number | undefined => {
  const parsed = numberValue(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
};

const homeRecordsFromPayload = (data: Record<string, unknown>): HomeLogRecord[] =>
  Array.isArray(data.logs)
    ? data.logs.filter((entry): entry is HomeLogRecord => isRecord(entry))
    : [];

const unixSecondsFromValue = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = stringValue(value);
  if (!text) return 0;
  const asNumber = Number(text);
  if (Number.isFinite(asNumber)) return asNumber;
  const asDate = Date.parse(text);
  return Number.isFinite(asDate) ? Math.floor(asDate / 1000) : 0;
};

const homeCursorFromRecord = (record: HomeLogRecord): string => {
  const timestamp = stringValue(record.timestamp);
  if (timestamp) return timestamp;
  const createdAt = stringValue(record.created_at);
  return createdAt;
};

const normalizeCPALogs = (data: Record<string, unknown>): LogsResponse => {
  const lines = Array.isArray(data.lines)
    ? data.lines.filter((line): line is string => typeof line === 'string')
    : [];
  const latestTimestamp = unixSecondsFromValue(data['latest-timestamp']);
  const lineCount = Number(data['line-count']);

  return {
    lines,
    lineCount: Number.isFinite(lineCount) ? lineCount : lines.length,
    latestAfter: latestTimestamp > 0 ? latestTimestamp : undefined,
    nextCursor: stringValue(data['next-cursor']) || undefined,
    cursorReset: booleanValue(data['cursor-reset']),
    logBackendKind: 'file',
  };
};

const normalizeHomeLogs = (data: Record<string, unknown>): LogsResponse => {
  const rawLogs = homeRecordsFromPayload(data);
  const orderedLogs = [...rawLogs].reverse();
  const lines = orderedLogs
    .map((record) => record.line)
    .filter((line): line is string => typeof line === 'string' && line.length > 0);
  const requestLogHomeIpById = orderedLogs.reduce<Record<string, string>>((acc, record) => {
    const requestId = stringValue(record.request_id);
    const homeIp = stringValue(record.home_ip);
    if (requestId && homeIp) {
      acc[requestId] = homeIp;
    }
    return acc;
  }, {});
  const latestCursor = rawLogs.reduce<string | undefined>((latest, record) => {
    const cursor = homeCursorFromRecord(record);
    if (!cursor) return latest;
    if (!latest) return cursor;
    const latestTime = Date.parse(latest);
    const cursorTime = Date.parse(cursor);
    if (!Number.isFinite(latestTime) || !Number.isFinite(cursorTime)) return latest;
    return cursorTime > latestTime ? cursor : latest;
  }, undefined);

  const total = Number(data.total);
  const limit = Number(data.limit);
  const offset = Number(data.offset);

  return {
    lines,
    lineCount: Number.isFinite(total) ? total : lines.length,
    latestAfter: latestCursor,
    logBackendKind: 'home-db',
    requestLogHomeIpById,
    total: Number.isFinite(total) ? total : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
    offset: Number.isFinite(offset) ? offset : undefined,
  };
};

const normalizeLogsResponse = (data: unknown): LogsResponse => {
  if (!isRecord(data)) {
    return { lines: [], lineCount: 0, logBackendKind: 'unknown' };
  }
  if (Array.isArray(data.logs)) return normalizeHomeLogs(data);
  if (Array.isArray(data.lines)) return normalizeCPALogs(data);
  return { lines: [], lineCount: 0, logBackendKind: 'unknown' };
};

const fetchCompleteHomeLogs = async (
  firstPage: Record<string, unknown>,
  params: LogsQuery
): Promise<Record<string, unknown>> => {
  const requestedLimit = positiveNumberValue(params.limit);
  const firstPageLimit = positiveNumberValue(firstPage.limit);
  const pageLimit = firstPageLimit ?? requestedLimit;
  const total = numberValue(firstPage.total);
  const firstOffset = numberValue(firstPage.offset) ?? numberValue(params.offset) ?? 0;
  const records = homeRecordsFromPayload(firstPage);

  if (requestedLimit === undefined || pageLimit === undefined || total === undefined) {
    return firstPage;
  }

  const targetCount = Math.min(requestedLimit, Math.max(total - firstOffset, 0));

  if (records.length >= targetCount) {
    return { ...firstPage, logs: records, limit: records.length, offset: firstOffset };
  }

  const remaining = targetCount - records.length;
  const baseOffset = firstOffset + records.length;
  const pageRequests: Array<{ offset: number; limit: number }> = [];
  let collected = 0;
  while (collected < remaining && baseOffset + collected < total) {
    const pageSize = Math.min(pageLimit, remaining - collected);
    pageRequests.push({ offset: baseOffset + collected, limit: pageSize });
    collected += pageSize;
  }

  const pages = await Promise.all(
    pageRequests.map(async ({ offset, limit }) => {
      const data = await apiClient.get('/logs', {
        params: { ...params, limit, offset },
        timeout: LOGS_TIMEOUT_MS,
      });
      if (!isRecord(data) || !Array.isArray(data.logs)) return [];
      return homeRecordsFromPayload(data);
    })
  );

  pages.forEach((pageRecords) => records.push(...pageRecords));

  return { ...firstPage, logs: records, limit: records.length, offset: firstOffset };
};

export const logsApi = {
  async fetchLogs(params: LogsQuery = {}): Promise<LogsResponse> {
    const data = await apiClient.get('/logs', { params, timeout: LOGS_TIMEOUT_MS });
    if (isRecord(data) && Array.isArray(data.logs)) {
      return normalizeLogsResponse(await fetchCompleteHomeLogs(data, params));
    }
    return normalizeLogsResponse(data);
  },

  clearLogs: () => apiClient.delete('/logs'),

  fetchErrorLogs: (): Promise<ErrorLogsResponse> =>
    apiClient.get('/request-error-logs', { timeout: LOGS_TIMEOUT_MS }),

  downloadErrorLog: (filename: string) =>
    apiClient.getRaw(`/request-error-logs/${encodeURIComponent(filename)}`, {
      responseType: 'blob',
      timeout: LOGS_TIMEOUT_MS
    }),

  downloadRequestLogById: (id: string, homeIp?: string) =>
    apiClient.getRaw(`/request-log-by-id/${encodeURIComponent(id)}`, {
      params: homeIp ? { home_ip: homeIp } : undefined,
      responseType: 'blob',
      timeout: LOGS_TIMEOUT_MS
    }),
};
