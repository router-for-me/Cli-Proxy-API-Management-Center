import type { AuthFileItem, MinimaxQuotaData } from '@/types';
import type { ApiCallRequest, ApiCallResult } from '@/services/api/apiCall';
import { parseMinimaxQuotaPayload } from '@/services/api/minimaxQuota';
import { normalizeAuthIndex } from '@/utils/authIndex';

/**
 * MiniMax serves two regions from different origins, and a token issued by one
 * host is rejected by the other. The backend reports the credential's region so
 * the request is sent to the matching host.
 */
const GLOBAL_QUOTA_URL = 'https://api.minimax.io/v1/token_plan/remains';
const CN_QUOTA_URL = 'https://api.minimaxi.com/v1/token_plan/remains';

const resolveQuotaUrl = (file: AuthFileItem): string => {
  // The provider key is authoritative; the region field mirrors it for
  // credentials that predate the split.
  if (file.provider === 'minimax-cn') return CN_QUOTA_URL;
  if (file.provider === 'minimax') return GLOBAL_QUOTA_URL;
  return file.region === 'cn' ? CN_QUOTA_URL : GLOBAL_QUOTA_URL;
};

export type MinimaxQuotaErrorCode =
  | 'missing_auth_index'
  | 'missing_file'
  | 'request_failed'
  | 'invalid_response'
  | 'stale_request';

export class MinimaxQuotaError extends Error {
  readonly status?: number;

  constructor(
    public readonly code: MinimaxQuotaErrorCode,
    status?: number
  ) {
    super(code);
    this.name = 'MinimaxQuotaError';
    this.status = status;
  }
}

interface MinimaxQuotaDependencies {
  request: (payload: ApiCallRequest) => Promise<ApiCallResult>;
  captureCurrent: (name: string) => () => boolean;
}

/**
 * The backend substitutes the credential for $TOKEN$, so the OAuth access token
 * never reaches the browser.
 */
export function createMinimaxQuotaFetcher(deps: MinimaxQuotaDependencies) {
  return async (file: AuthFileItem): Promise<MinimaxQuotaData> => {
    const authIndex = normalizeAuthIndex(file.authIndex ?? file.auth_index);
    if (!authIndex) throw new MinimaxQuotaError('missing_auth_index');
    if (
      !file.name?.trim() ||
      file.runtimeOnly === true ||
      file.runtime_only === true ||
      file.runtime_only === 'true'
    ) {
      throw new MinimaxQuotaError('missing_file');
    }

    const isCurrent = deps.captureCurrent(file.name);
    const assertCurrent = () => {
      if (!isCurrent()) throw new MinimaxQuotaError('stale_request');
    };
    assertCurrent();

    let response: ApiCallResult;
    try {
      assertCurrent();
      response = await deps.request({
        authIndex,
        method: 'GET',
        url: resolveQuotaUrl(file),
        header: {
          Accept: 'application/json',
          Authorization: 'Bearer $TOKEN$',
        },
      });
    } catch (error: unknown) {
      assertCurrent();
      const status =
        error !== null &&
        typeof error === 'object' &&
        typeof (error as { status?: unknown }).status === 'number'
          ? (error as { status: number }).status
          : undefined;
      throw new MinimaxQuotaError('request_failed', status);
    }
    assertCurrent();

    // Never derive an error message from the body: the endpoint can echo
    // credential material even on failures.
    if (!(response.statusCode >= 200 && response.statusCode < 300)) {
      throw new MinimaxQuotaError('request_failed', response.statusCode);
    }

    const parsed = parseBody(response);
    // MiniMax answers with HTTP 200 even when the token is rejected, signalling
    // the failure in base_resp.status_code. A non-zero code means the response
    // carries no usable windows, which would otherwise surface as a confusing
    // "invalid response" message.
    const statusCode = readBaseRespStatusCode(parsed);
    if (statusCode !== null && statusCode !== 0) {
      throw new MinimaxQuotaError('request_failed', response.statusCode);
    }

    const quota = parseMinimaxQuotaPayload(parsed);
    if (!quota) throw new MinimaxQuotaError('invalid_response');
    return quota;
  };
}

/** Reads base_resp.status_code without surfacing its message, which can echo credentials. */
function readBaseRespStatusCode(parsed: unknown): number | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const baseResp = (parsed as Record<string, unknown>).base_resp;
  if (!baseResp || typeof baseResp !== 'object' || Array.isArray(baseResp)) return null;
  const code = (baseResp as Record<string, unknown>).status_code;
  return typeof code === 'number' && Number.isFinite(code) ? code : null;
}

function parseBody(response: ApiCallResult): unknown {
  const raw = response.body;
  if (raw && typeof raw === 'object') return raw;
  const text = response.bodyText;
  if (typeof text !== 'string' || text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
