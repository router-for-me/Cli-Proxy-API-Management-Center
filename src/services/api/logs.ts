/**
 * 日志相关 API
 */

import type { ApiError } from '@/types';
import { apiClient } from './client';
import { parseApiErrorResponse } from './apiError';
import { LOGS_TIMEOUT_MS } from '@/utils/constants';
import { isRecord } from '@/utils/helpers';

export interface LogsQuery {
  after?: number;
  cursor?: string;
  limit?: number;
}

export interface LogsResponse {
  lines: string[];
  latestAfter?: number;
  nextCursor?: string;
  cursorReset?: boolean;
}

export interface ErrorLogFile {
  name: string;
  size?: number;
  modified?: number;
}

export interface ErrorLogsResponse {
  files: ErrorLogFile[];
}

const stringValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const booleanValue = (value: unknown): boolean =>
  value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');

const unixSecondsFromValue = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = stringValue(value);
  if (!text) return 0;
  const asNumber = Number(text);
  if (Number.isFinite(asNumber)) return asNumber;
  const asDate = Date.parse(text);
  return Number.isFinite(asDate) ? Math.floor(asDate / 1000) : 0;
};

const normalizeLogsResponse = (data: unknown): LogsResponse => {
  if (!isRecord(data)) {
    return { lines: [] };
  }

  const lines = Array.isArray(data.lines)
    ? data.lines.filter((line): line is string => typeof line === 'string')
    : [];
  const latestTimestamp = unixSecondsFromValue(data['latest-timestamp']);

  return {
    lines,
    latestAfter: latestTimestamp > 0 ? latestTimestamp : undefined,
    // An explicit empty cursor clears the previous cursor after a reset.
    nextCursor: typeof data['next-cursor'] === 'string' ? data['next-cursor'] : undefined,
    cursorReset: booleanValue(data['cursor-reset']),
  };
};

export interface LogsRequestOptions {
  signal?: AbortSignal;
}

const normalizeErrorLogsResponse = (data: unknown): ErrorLogsResponse => {
  if (!isRecord(data) || !Array.isArray(data.files)) return { files: [] };
  return {
    files: data.files.flatMap((file): ErrorLogFile[] => {
      if (!isRecord(file) || typeof file.name !== 'string' || !file.name.trim()) return [];
      return [
        {
          name: file.name,
          size:
            typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0
              ? file.size
              : undefined,
          modified: unixSecondsFromValue(file.modified) || undefined,
        },
      ];
    }),
  };
};

/** Decode download bodies without interpreting successful log contents as API errors. */
export const responseDataToText = async (data: unknown): Promise<string> => {
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  if (typeof data === 'string') return data;
  if (data === undefined || data === null) return '';
  try {
    return JSON.stringify(data, null, 2) ?? String(data);
  } catch {
    return String(data);
  }
};

const PREVIEW_LIMIT = 2 * 1024 * 1024;
export class LogPreviewTooLargeError extends Error {}

const requestPath = (id: string) => `/observability/logs/requests/${encodeURIComponent(id)}`;
const errorPath = (name: string) => `/observability/logs/errors/${encodeURIComponent(name)}`;

async function readPreview(stream: ReadableStream<Uint8Array>, length?: unknown): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    if (Number(length) > PREVIEW_LIMIT) throw new LogPreviewTooLargeError();
    while (true) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      if (bytes > PREVIEW_LIMIT) throw new LogPreviewTooLargeError();
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

const downloadLog = async (path: string, options: LogsRequestOptions, preview = false) => {
  try {
    return await apiClient.getRaw(path, {
      ...options,
      ...(preview ? { adapter: 'fetch', responseType: 'stream' } : { responseType: 'blob' }),
      timeout: LOGS_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    // The client already emitted unauthorized on 401 and normalized the Axios error.
    // It retains the body in data/details, NOT response.data. Preserve its identity,
    // status, transport code and body while enriching the human-readable error.
    if (error instanceof Error) {
      const apiError = error as ApiError;
      const body = apiError.data ?? apiError.details;
      if (body instanceof Blob || (preview && body instanceof ReadableStream)) {
        try {
          const text = body instanceof Blob ? await body.text() : await readPreview(body);
          const parsed = parseApiErrorResponse(JSON.parse(text), apiError.message);
          apiError.message = parsed.message;
          if (parsed.apiCode !== undefined) apiError.apiCode = parsed.apiCode;
        } catch {
          // Unreadable/non-JSON bodies must not mask the original transport failure.
        }
      }
    }
    throw error;
  }
};

export const logsApi = {
  async fetchLogs(params: LogsQuery = {}, options: LogsRequestOptions = {}): Promise<LogsResponse> {
    const data = await apiClient.get('/observability/logs', {
      ...options,
      params,
      timeout: LOGS_TIMEOUT_MS,
    });
    return normalizeLogsResponse(data);
  },

  clearLogs: (options: LogsRequestOptions = {}) => apiClient.delete('/observability/logs', options),

  async fetchErrorLogs(options: LogsRequestOptions = {}): Promise<ErrorLogsResponse> {
    const data = await apiClient.get('/observability/logs/errors', {
      ...options,
      timeout: LOGS_TIMEOUT_MS,
    });
    return normalizeErrorLogsResponse(data);
  },

  async previewLog(item: ErrorLogFile, requestId: string | undefined, signal: AbortSignal) {
    if ((item.size ?? 0) > PREVIEW_LIMIT) throw new LogPreviewTooLargeError();
    const path = requestId ? requestPath(requestId) : errorPath(item.name);
    const response = await downloadLog(path, { signal }, true);
    return readPreview(response.data, response.headers['content-length']);
  },

  downloadErrorLog: (filename: string, options: LogsRequestOptions = {}) =>
    downloadLog(errorPath(filename), options),

  downloadRequestLogById: (id: string, options: LogsRequestOptions = {}) =>
    downloadLog(requestPath(id), options),
};
