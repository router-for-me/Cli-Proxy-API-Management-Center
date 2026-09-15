import type { AuthFileItem, MetaQuotaData } from '@/types';
import type { ApiCallRequest, ApiCallResult } from '@/services/api/apiCall';
import { hasMetaQuotaData, parseMetaQuotaPayload } from '@/services/api/metaQuota';
import { normalizeAuthIndex } from '@/utils/authIndex';

export const META_MUSE_QUOTA_URL = 'https://api.meta.ai/muse-code/key';

export type MetaQuotaErrorCode = 'missing_auth_index' | 'empty_data' | 'request_failed';

export class MetaQuotaError extends Error {
  readonly status?: number;

  constructor(
    public readonly code: MetaQuotaErrorCode,
    status?: number
  ) {
    super(code);
    this.name = 'MetaQuotaError';
    this.status = status;
  }
}

interface MetaQuotaDependencies {
  request: (payload: ApiCallRequest) => Promise<ApiCallResult>;
}

/** Build a fetcher around api-call so tests can verify the credential placeholder boundary. */
export function createMetaQuotaFetcher(deps: MetaQuotaDependencies) {
  return async (file: AuthFileItem): Promise<MetaQuotaData> => {
    const authIndex = normalizeAuthIndex(file.authIndex ?? file.auth_index);
    if (!authIndex) throw new MetaQuotaError('missing_auth_index');

    let response: ApiCallResult;
    try {
      response = await deps.request({
        authIndex,
        method: 'POST',
        url: META_MUSE_QUOTA_URL,
        header: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: 'Bearer $TOKEN$',
          'x-api-version': '1.0.0',
        },
        data: '{}',
      });
    } catch (error: unknown) {
      const status =
        error !== null &&
        typeof error === 'object' &&
        typeof (error as { status?: unknown }).status === 'number'
          ? (error as { status: number }).status
          : undefined;
      throw new MetaQuotaError('request_failed', status);
    }

    // Never derive an error message from body/bodyText: the endpoint can echo
    // api_key and other PII even on errors.
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new MetaQuotaError('request_failed', response.statusCode);
    }

    const quota = parseMetaQuotaPayload(response.body ?? response.bodyText);
    if (!hasMetaQuotaData(quota)) throw new MetaQuotaError('empty_data');
    return quota;
  };
}
