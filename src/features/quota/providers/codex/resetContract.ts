import type { TFunction } from 'i18next';
import type { AuthFileItem } from '@/types';
import { RequestNotSentError } from '@/services/api/client';
import { normalizeAuthIndex } from '@/utils/authIndex';
import {
  CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
  CODEX_REQUEST_HEADERS,
  resolveCodexChatgptAccountId,
} from '@/utils/quota';

/** Persist the exact request, including the original ID, rather than rebuilding on retry. */
export type CodexResetConsumeIntent = Readonly<{
  authIndex: string;
  method: 'POST';
  url: string;
  header: Readonly<Record<string, string>>;
  data: string;
}>;

export type CodexResetConsumeResult =
  | { outcome: 'success'; code: 'reset' | 'already_redeemed' }
  | { outcome: 'terminal'; code: 'no_credit' | 'nothing_to_reset' }
  | { outcome: 'unknown'; message: string };

/** randomUUID is unavailable on ordinary HTTP, which is a supported panel deployment. */
export const createCodexResetRequestId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** Reset identity uses the same sources as quota reads, but never coerces numeric IDs. */
export const getCodexResetAccountId = (file: AuthFileItem): string | null =>
  resolveCodexChatgptAccountId(file, { stringsOnly: true });

export const buildCodexResetConsumeIntent = (
  file: AuthFileItem,
  t: TFunction,
  requestId: string
): CodexResetConsumeIntent => {
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  if (!authIndex) throw new RequestNotSentError(t('codex_quota.missing_auth_index'));
  const accountId = getCodexResetAccountId(file);
  if (!accountId) throw new RequestNotSentError(t('codex_quota.reset_missing_account_id'));
  if (!requestId.trim()) throw new RequestNotSentError('Missing redemption request ID');

  return Object.freeze({
    authIndex,
    method: 'POST',
    url: CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
    header: Object.freeze({ ...CODEX_REQUEST_HEADERS, 'Chatgpt-Account-Id': accountId }),
    data: JSON.stringify({ redeem_request_id: requestId }),
  });
};
