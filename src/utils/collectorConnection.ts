const COLLECTOR_API_PREFIX = '/v0/collector';

export interface CollectorQueryInput {
  page?: number;
  pageSize?: number;
  apiKey?: string;
  model?: string;
  path?: string;
  status?: string;
  startTime?: string;
  endTime?: string;
  search?: string;
}

export type CollectorQueryParams = Record<string, string | number>;

export const normalizeCollectorBase = (input: string): string => {
  let base = (input || '').trim();
  if (!base) return '';

  base = base.replace(/\/?v0\/collector\/?$/i, '');
  base = base.replace(/\/+$/g, '');

  if (!/^https?:\/\//i.test(base)) {
    base = `http://${base}`;
  }

  return base;
};

export const buildCollectorApiUrl = (base: string, path: string): string => {
  const normalizedBase = normalizeCollectorBase(base);
  const normalizedPath = path.trim().replace(/^\/+/, '');
  if (!normalizedBase) {
    return `${COLLECTOR_API_PREFIX}/${normalizedPath}`;
  }
  return `${normalizedBase}${COLLECTOR_API_PREFIX}/${normalizedPath}`;
};

const addStringParam = (
  params: CollectorQueryParams,
  key: string,
  value: string | undefined
) => {
  const trimmed = value?.trim();
  if (trimmed) {
    params[key] = trimmed;
  }
};

export const buildCollectorQuery = (input: CollectorQueryInput): CollectorQueryParams => {
  const params: CollectorQueryParams = {};

  if (Number.isFinite(input.page) && input.page && input.page > 0) {
    params.page = input.page;
  }
  if (Number.isFinite(input.pageSize) && input.pageSize && input.pageSize > 0) {
    params.page_size = input.pageSize;
  }

  addStringParam(params, 'api_key', input.apiKey);
  addStringParam(params, 'model', input.model);
  addStringParam(params, 'path', input.path);
  addStringParam(params, 'status', input.status);
  addStringParam(params, 'start_time', input.startTime);
  addStringParam(params, 'end_time', input.endTime);
  addStringParam(params, 'search', input.search);

  return params;
};
