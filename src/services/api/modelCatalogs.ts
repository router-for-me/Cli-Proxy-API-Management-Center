import { isRecord } from '@/utils/helpers';
import { apiClient } from './client';

export type ModelCatalogKind = 'general' | 'codex' | 'devin';

export interface ModelCatalogRefreshStatus {
  kind: ModelCatalogKind;
  source: string;
  state: 'refreshed' | 'skipped' | 'failed';
  skipReason?: 'embedded' | 'disabled';
  error?: string;
}

export interface ModelCatalogRefreshResult {
  outcome: 'success' | 'skipped' | 'partial' | 'error';
  catalogs: ModelCatalogRefreshStatus[];
  changedProviders: string[];
  error?: string;
}

interface RefreshModelCatalogsOptions {
  signal?: AbortSignal;
  isCurrent?: () => boolean;
}

const CATALOG_FIELDS = {
  general: 'catalog',
  codex: 'codex-catalog',
  devin: 'devin-catalog',
} as const;

const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const normalizeRefreshResult = (payload: unknown): ModelCatalogRefreshResult | null => {
  if (!isRecord(payload) || typeof payload.ok !== 'boolean' || !isRecord(payload.catalogs)) {
    return null;
  }

  const catalogs: ModelCatalogRefreshStatus[] = [];
  for (const kind of Object.keys(CATALOG_FIELDS) as ModelCatalogKind[]) {
    const status = payload.catalogs[CATALOG_FIELDS[kind]];
    if (
      !isRecord(status) ||
      typeof status.source !== 'string' ||
      typeof status.refreshed !== 'boolean'
    ) {
      return null;
    }
    const source = status.source;
    const error = readString(status.error) || undefined;
    const state = error
      ? 'failed'
      : status.skipped === true
        ? 'skipped'
        : status.refreshed
          ? 'refreshed'
          : 'failed';
    catalogs.push({
      kind,
      source,
      state,
      skipReason:
        state === 'skipped'
          ? source === 'embed'
            ? 'embedded'
            : source === 'disabled'
              ? 'disabled'
              : undefined
          : undefined,
      error,
    });
  }

  const refreshed = catalogs.some((catalog) => catalog.state === 'refreshed');
  const failed = !payload.ok || catalogs.some((catalog) => catalog.state === 'failed');
  const changedProviders = Array.isArray(payload.changed_providers)
    ? [...new Set(payload.changed_providers.map(readString).filter(Boolean))]
    : [];

  return {
    outcome: failed ? (refreshed ? 'partial' : 'error') : refreshed ? 'success' : 'skipped',
    catalogs,
    changedProviders,
    error: readString(payload.error) || undefined,
  };
};

/** Refresh the current backend's catalogs without changing its configured source policy. */
export const refreshModelCatalogs = async ({
  signal,
  isCurrent,
}: RefreshModelCatalogsOptions = {}): Promise<ModelCatalogRefreshResult> => {
  const client = apiClient.captureConnection(isCurrent);
  let payload: unknown;
  try {
    payload = await client.post<unknown>('/models/refresh', undefined, { signal });
  } catch (error: unknown) {
    // A 502 can contain successful publications alongside individual catalog failures.
    const result =
      isRecord(error) && error.status === 502 ? normalizeRefreshResult(error.details) : null;
    if (!result) throw error;
    return result;
  }

  const result = normalizeRefreshResult(payload);
  if (!result) throw new Error('Invalid model catalog refresh response');
  return result;
};
