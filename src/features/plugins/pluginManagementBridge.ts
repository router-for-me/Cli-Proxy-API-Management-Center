import type { AxiosRequestConfig } from 'axios';
import { apiClient } from '@/services/api/client';
import { isRecord } from '@/utils/helpers';

export const PLUGIN_MANAGEMENT_BRIDGE_VERSION = 1;
export const PLUGIN_MANAGEMENT_REQUEST_TYPE = 'cliproxy:plugin-management-request';
export const PLUGIN_MANAGEMENT_RESPONSE_TYPE = 'cliproxy:plugin-management-response';

const PLUGIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ALLOWED_HEADERS = new Set(['accept', 'content-type', 'if-match', 'if-none-match']);
const MAX_PATH_LENGTH = 4096;
const MAX_HEADER_VALUE_LENGTH = 8192;
const MAX_BODY_BYTES = 1024 * 1024;

export interface PluginManagementBridgeContext {
  origin: string;
  pluginID: string;
}

export interface PluginManagementBridgeRequest {
  requestID: string;
  method: string;
  apiPath: string;
  headers: Record<string, string>;
  body?: string;
}

export interface PluginManagementBridgeResponse {
  type: typeof PLUGIN_MANAGEMENT_RESPONSE_TYPE;
  version: typeof PLUGIN_MANAGEMENT_BRIDGE_VERSION;
  requestId: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');

const isPluginScopedPath = (pathname: string, pluginID: string) => {
  const prefix = `/v0/management/plugins/${pluginID}`;
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
};

export const resolvePluginManagementBridgeContext = (
  pluginID: string,
  resourceURL: string,
  apiBase: string
): PluginManagementBridgeContext | null => {
  if (!PLUGIN_ID_PATTERN.test(pluginID) || !resourceURL.trim() || !apiBase.trim()) return null;

  try {
    const documentURL = typeof window === 'undefined' ? 'http://localhost/' : window.location.href;
    const apiURL = new URL(apiBase, documentURL);
    const resource = new URL(resourceURL, apiURL.origin);
    const resourcePrefix = `/v0/resource/plugins/${pluginID}`;
    if (
      resource.origin !== apiURL.origin ||
      (resource.pathname !== resourcePrefix && !resource.pathname.startsWith(`${resourcePrefix}/`))
    ) {
      return null;
    }
    return { origin: resource.origin, pluginID };
  } catch {
    return null;
  }
};

export const normalizePluginManagementBridgeRequest = (
  value: unknown,
  pluginID: string
): PluginManagementBridgeRequest | null => {
  if (!isRecord(value) || !PLUGIN_ID_PATTERN.test(pluginID)) return null;
  if (
    value.type !== PLUGIN_MANAGEMENT_REQUEST_TYPE ||
    value.version !== PLUGIN_MANAGEMENT_BRIDGE_VERSION
  ) {
    return null;
  }

  const requestID = asString(value.requestId).trim();
  const method = asString(value.method).trim().toUpperCase();
  const path = asString(value.path).trim();
  if (
    !REQUEST_ID_PATTERN.test(requestID) ||
    !ALLOWED_METHODS.has(method) ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.length > MAX_PATH_LENGTH ||
    /[\r\n]/.test(path) ||
    /%(?:2e|2f|5c)/i.test(path)
  ) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(path, 'https://plugin-management.invalid');
  } catch {
    return null;
  }
  if (parsed.origin !== 'https://plugin-management.invalid' || parsed.hash) return null;
  if (!isPluginScopedPath(parsed.pathname, pluginID)) return null;

  const headers: Record<string, string> = {};
  if (value.headers !== undefined) {
    if (!isRecord(value.headers)) return null;
    for (const [rawName, rawValue] of Object.entries(value.headers)) {
      const name = rawName.trim().toLowerCase();
      if (
        !ALLOWED_HEADERS.has(name) ||
        typeof rawValue !== 'string' ||
        rawValue.length > MAX_HEADER_VALUE_LENGTH ||
        /[\r\n]/.test(rawValue)
      ) {
        return null;
      }
      headers[name] = rawValue;
    }
  }

  const body = value.body;
  if (body !== undefined && body !== null) {
    if (
      typeof body !== 'string' ||
      new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES ||
      method === 'GET'
    ) {
      return null;
    }
  }

  return {
    requestID,
    method,
    apiPath: `${parsed.pathname.replace(/^\/v0\/management/, '')}${parsed.search}`,
    headers,
    ...(typeof body === 'string' ? { body } : {}),
  };
};

const readResponseHeader = (headers: unknown, name: string): string => {
  if (!headers || typeof headers !== 'object') return '';
  const getter = (headers as { get?: (headerName: string) => unknown }).get;
  const value =
    typeof getter === 'function'
      ? getter.call(headers, name)
      : ((headers as Record<string, unknown>)[name] ??
        (headers as Record<string, unknown>)[name.toLowerCase()]);
  return value === undefined || value === null ? '' : String(value);
};

export const executePluginManagementBridgeRequest = async (
  request: PluginManagementBridgeRequest
): Promise<PluginManagementBridgeResponse> => {
  const config: AxiosRequestConfig = {
    url: request.apiPath,
    method: request.method,
    headers: request.headers,
    data: request.body,
    responseType: 'text',
    transformResponse: [(value) => value],
    validateStatus: () => true,
  };
  const response = await apiClient.requestRaw<string>(config);
  const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  const contentType = readResponseHeader(response.headers, 'content-type');

  return {
    type: PLUGIN_MANAGEMENT_RESPONSE_TYPE,
    version: PLUGIN_MANAGEMENT_BRIDGE_VERSION,
    requestId: request.requestID,
    status: response.status,
    headers: contentType ? { 'content-type': contentType } : {},
    body,
  };
};

export const pluginManagementBridgeFailure = (
  requestID: string
): PluginManagementBridgeResponse => ({
  type: PLUGIN_MANAGEMENT_RESPONSE_TYPE,
  version: PLUGIN_MANAGEMENT_BRIDGE_VERSION,
  requestId: requestID,
  status: 502,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ error: 'plugin_management_request_failed' }),
});
